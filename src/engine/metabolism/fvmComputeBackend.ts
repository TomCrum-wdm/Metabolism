// Unified CPU / WebGPU Compute FVM Backend for 《Metabolism》
// Architecture:
// - Shares an identical topological grid descriptor & numeric hypergraph tables across CPU & GPU.
// - Supports up to 6 chemical species (statePing: [c0,c1,c2,E] + state2Ping: [c3,c4,c5,0]) and 6 reactions.
// - Fixed simulation sequence: Boundary Ports -> 6-Neighbor Symmetric Flux -> In-Cell Reaction -> Scalar Audit.
// - WebGPU path uses Ping-Pong StorageBuffers + two-pass TSL compute shaders up to 128^3 (2,097,152 voxels)
//   with zero-readback GPU shader visualization and non-blocking 80-byte atomic reduction readback.

import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  atomicAdd,
  atomicStore,
  clamp as tslClamp,
  color,
  dot,
  exp,
  float,
  floor,
  int,
  instanceIndex,
  length,
  log,
  max,
  min,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import { EulerianFvmGrid, FvmStepTelemetry, MatterPhase, classifyMatterPhase } from './eulerianFvm';
import {
  CompiledReactionHypergraph,
  GAS_CONSTANT_R,
  evaluateArrheniusRateConstant,
  evaluateTpWindowGate,
} from './reactionHypergraph';

export type FvmComputeBackendKind = 'cpu' | 'webgpu';
export type FvmResolutionCells = 24 | 64 | 96 | 128;

export interface FvmResolutionSpec {
  readonly cellsPerAxis: FvmResolutionCells;
  readonly chunksPerAxis: 3 | 8 | 12 | 16;
  readonly totalVoxels: number;
  readonly label: string;
  readonly recommendedBackend: FvmComputeBackendKind;
}

export const FVM_RESOLUTION_PRESETS: Record<FvmResolutionCells, FvmResolutionSpec> = {
  24: {
    cellsPerAxis: 24,
    chunksPerAxis: 3,
    totalVoxels: 24 * 24 * 24, // 13,824
    label: '24³ (1.38万体素 · 基准)',
    recommendedBackend: 'cpu',
  },
  64: {
    cellsPerAxis: 64,
    chunksPerAxis: 8,
    totalVoxels: 64 * 64 * 64, // 262,144
    label: '64³ (26.2万体素 · GPU)',
    recommendedBackend: 'webgpu',
  },
  96: {
    cellsPerAxis: 96,
    chunksPerAxis: 12,
    totalVoxels: 96 * 96 * 96, // 884,736
    label: '96³ (88.5万体素 · GPU)',
    recommendedBackend: 'webgpu',
  },
  128: {
    cellsPerAxis: 128,
    chunksPerAxis: 16,
    totalVoxels: 128 * 128 * 128, // 2,097,152
    label: '128³ (209.7万体素 · GPU)',
    recommendedBackend: 'webgpu',
  },
};

export const MAX_GPU_SPECIES = 6;
export const MAX_GPU_REACTIONS = 6;

// Packed kinetic storage layout: 66 vec4 slots (264 floats), zero formula string parsing.
//  0..1  : molar masses [M0..M3], [M4, M5, 0, 0]
//  2..3  : effective diffusivities [D0..D3], [D4, D5, 0, 0]
//  4..5  : specific heats [Cp0..Cp3], [Cp4, Cp5, 1800, 0]
//  6..11 : species colors [r, g, b, roleCode] for S0..S5
// 12..17 : stoich A [nu0..nu3] for R0..R5
// 18..23 : stoich B [nu4, nu5, 0, 0] for R0..R5
// 24..29 : fwd order A [o0..o3] for R0..R5
// 30..35 : fwd order B [o4, o5, 0, 0] for R0..R5
// 36..41 : rev order A [o0..o3] for R0..R5
// 42..47 : rev order B [o4, o5, 0, 0] for R0..R5
// 48..53 : forward Arrhenius + enthalpy [calA, calEa, beta, deltaH] for R0..R5
// 54..59 : reverse Arrhenius + T bounds [revA, revEa, minT, maxT] for R0..R5
// 60..65 : P bounds + flags [minP, maxP, isReversible, activeFlag] for R0..R5
export const PACKED_KINETICS_VEC4_COUNT = 66;

export interface FvmGridDescriptor {
  readonly cellsPerAxis: number;
  readonly chunksPerAxis: number;
  readonly totalCells: number;
  readonly worldHalf: number;
  readonly voxelSize: number;
  readonly cellVolumeM3: number;
  readonly baseRadius: number;
  readonly numSpecies: number;
  readonly numReactions: number;
  readonly packedKineticsVec4: Float32Array;
}

export function packHypergraphKineticsVec4(
  hypergraph: CompiledReactionHypergraph,
  outBuffer: Float32Array = new Float32Array(PACKED_KINETICS_VEC4_COUNT * 4),
): Float32Array {
  outBuffer.fill(0);
  const S = Math.min(MAX_GPU_SPECIES, hypergraph.numSpecies);
  const R = Math.min(MAX_GPU_REACTIONS, hypergraph.numReactions);

  for (let s = 0; s < S; s++) {
    const slotOff = s < 4 ? 0 : 1;
    const comp = s < 4 ? s : s - 4;
    outBuffer[(0 + slotOff) * 4 + comp] = hypergraph.molarMasses[s];
    outBuffer[(2 + slotOff) * 4 + comp] =
      hypergraph.diffusivities[s] * hypergraph.calibratedDiffusivityScale[s];
    outBuffer[(4 + slotOff) * 4 + comp] = hypergraph.species[s].specificHeatJPerMolK;

    const col = hypergraph.species[s].colorRgb;
    outBuffer[(6 + s) * 4 + 0] = col[0];
    outBuffer[(6 + s) * 4 + 1] = col[1];
    outBuffer[(6 + s) * 4 + 2] = col[2];
    outBuffer[(6 + s) * 4 + 3] = 1.0;
  }
  outBuffer[5 * 4 + 2] = 1800.0; // Baseline rock/solvent Cp

  for (let r = 0; r < R; r++) {
    const rxn = hypergraph.reactions[r];
    const rowOff = r * hypergraph.numSpecies;
    for (let s = 0; s < S; s++) {
      if (s < 4) {
        outBuffer[(12 + r) * 4 + s] = hypergraph.stoichMatrix[rowOff + s];
        outBuffer[(24 + r) * 4 + s] = hypergraph.reactantOrderMatrix[rowOff + s];
        outBuffer[(36 + r) * 4 + s] = hypergraph.productOrderMatrix[rowOff + s];
      } else {
        const sub = s - 4;
        outBuffer[(18 + r) * 4 + sub] = hypergraph.stoichMatrix[rowOff + s];
        outBuffer[(30 + r) * 4 + sub] = hypergraph.reactantOrderMatrix[rowOff + s];
        outBuffer[(42 + r) * 4 + sub] = hypergraph.productOrderMatrix[rowOff + s];
      }
    }
    outBuffer[(48 + r) * 4 + 0] = hypergraph.calibratedForwardA[r];
    outBuffer[(48 + r) * 4 + 1] = hypergraph.calibratedForwardEaJ[r];
    outBuffer[(48 + r) * 4 + 2] = rxn.tempExponentBeta ?? 0;
    outBuffer[(48 + r) * 4 + 3] = rxn.enthalpyChangeJ;

    outBuffer[(54 + r) * 4 + 0] = rxn.reverseA ?? 0;
    outBuffer[(54 + r) * 4 + 1] = rxn.reverseEaJ ?? rxn.forwardEaJ;
    outBuffer[(54 + r) * 4 + 2] = rxn.minTempK;
    outBuffer[(54 + r) * 4 + 3] = rxn.maxTempK;

    outBuffer[(60 + r) * 4 + 0] = rxn.minPressureAtm;
    outBuffer[(60 + r) * 4 + 1] = rxn.maxPressureAtm;
    outBuffer[(60 + r) * 4 + 2] = rxn.isReversible ? 1.0 : 0.0;
    outBuffer[(60 + r) * 4 + 3] = 1.0;
  }

  return outBuffer;
}

export function buildFvmGridDescriptor(grid: EulerianFvmGrid): FvmGridDescriptor {
  return {
    cellsPerAxis: grid.cellsPerAxis,
    chunksPerAxis: grid.chunksPerAxis,
    totalCells: grid.totalCells,
    worldHalf: grid.worldHalf,
    voxelSize: grid.voxelSize,
    cellVolumeM3: grid.cellVolumeM3,
    baseRadius: grid.baseRadius,
    numSpecies: grid.hypergraph.numSpecies,
    numReactions: grid.hypergraph.numReactions,
    packedKineticsVec4: packHypergraphKineticsVec4(grid.hypergraph),
  };
}

export interface GpuStepParams {
  dtSec: number;
  boundaryMode: 'closed' | 'open';
  feedRatePerSec: number;
  exhaustRatePerSec: number;
  feedConcentrationMolM3: number;
  ambientTempK: number;
}

export interface MacroFeedbackBin {
  readonly binIndex: number;
  readonly worldPos: [number, number, number];
  readonly meanTempK: number;
  readonly meanAutocatalystX: number;
  readonly mineralAccum: number;
  readonly entropyProdRate: number;
  readonly activeCount: number;
}

/**
 * Pure TypeScript reference implementation of the exact two-pass symmetric Ping-Pong
 * GPU Flux + Reaction stencil algorithm (supporting 1..6 species & 1..6 reactions).
 */
export function evaluateSymmetricFluxReactionStepCpuReference(
  desc: FvmGridDescriptor,
  hypergraph: CompiledReactionHypergraph,
  statePingVec4: Float32Array,
  statePongVec4: Float32Array,
  auxPingVec4: Float32Array,
  auxPongVec4: Float32Array,
  velPorVec4: Float32Array,
  metaVec4: Float32Array,
  diagVec4: Float32Array,
  params: GpuStepParams,
  state2PingVec4?: Float32Array,
  state2PongVec4?: Float32Array,
): {
  totalMassPreKg: number;
  boundaryFeedMassKg: number;
  boundaryExhaustMassKg: number;
  totalMassPostFluxKg: number;
  totalMassPostReactKg: number;
  relativeError: number;
  meanConcentrations: number[];
  totalEntropyProdRate: number;
  meanTempK: number;
  activeCellCount: number;
} {
  const n = desc.cellsPerAxis;
  const nSq = n * n;
  const total = desc.totalCells;
  const invH = 1.0 / desc.voxelSize;
  const dt = Math.max(1e-4, Math.min(0.25, params.dtSec));
  const dtOverH = dt * invH;
  const vol = desc.cellVolumeM3;
  const isOpen = params.boundaryMode === 'open';
  const S = Math.min(MAX_GPU_SPECIES, hypergraph.numSpecies);
  const R = Math.min(MAX_GPU_REACTIONS, hypergraph.numReactions);

  const masses = [
    hypergraph.molarMasses[0] ?? 0.05,
    hypergraph.molarMasses[1] ?? 0.05,
    hypergraph.molarMasses[2] ?? 0.05,
    hypergraph.molarMasses[3] ?? 0.05,
    hypergraph.molarMasses[4] ?? 0.05,
    hypergraph.molarMasses[5] ?? 0.05,
  ];
  const diffs = [
    (hypergraph.diffusivities[0] ?? 0.1) * (hypergraph.calibratedDiffusivityScale[0] ?? 1),
    (hypergraph.diffusivities[1] ?? 0.05) * (hypergraph.calibratedDiffusivityScale[1] ?? 1),
    (hypergraph.diffusivities[2] ?? 0.1) * (hypergraph.calibratedDiffusivityScale[2] ?? 1),
    (hypergraph.diffusivities[3] ?? 0.05) * (hypergraph.calibratedDiffusivityScale[3] ?? 1),
    (hypergraph.diffusivities[4] ?? 0.1) * (hypergraph.calibratedDiffusivityScale[4] ?? 1),
    (hypergraph.diffusivities[5] ?? 0.1) * (hypergraph.calibratedDiffusivityScale[5] ?? 1),
  ];
  const cps = [
    hypergraph.species[0]?.specificHeatJPerMolK ?? 40,
    hypergraph.species[1]?.specificHeatJPerMolK ?? 40,
    hypergraph.species[2]?.specificHeatJPerMolK ?? 40,
    hypergraph.species[3]?.specificHeatJPerMolK ?? 40,
    hypergraph.species[4]?.specificHeatJPerMolK ?? 40,
    hypergraph.species[5]?.specificHeatJPerMolK ?? 40,
  ];

  const readC = (ping1: Float32Array, ping2: Float32Array | undefined, idx: number, s: number): number => {
    if (s < 3) return Math.max(0, ping1[idx * 4 + s]);
    return ping2 ? Math.max(0, ping2[idx * 4 + (s - 3)]) : 0;
  };

  let massPre = 0;
  let feedMass = 0;
  let exhaustMass = 0;
  let massPostFlux = 0;
  let massPostReact = 0;
  const sumSpecies = [0, 0, 0, 0, 0, 0];
  let sumT = 0;
  let sumEntropy = 0;
  let activeCount = 0;

  const limitFlux = (rawF: number, cDonorL: number, cDonorR: number): number => {
    if (rawF > 0) {
      const cap = (cDonorL * 0.14) / dtOverH;
      return rawF > cap ? cap : rawF;
    } else if (rawF < 0) {
      const cap = (-cDonorR * 0.14) / dtOverH;
      return rawF < cap ? cap : rawF;
    }
    return 0;
  };

  const faceBuf = [0, 0, 0, 0, 0, 0, 0]; // f0..f5, fE
  const evalFaceFlux = (idxL: number, idxR: number, axis: 0 | 1 | 2) => {
    for (let k = 0; k < 7; k++) faceBuf[k] = 0;
    if (metaVec4[idxL * 4] < 0.5 || metaVec4[idxR * 4] < 0.5) return;
    const porL = velPorVec4[idxL * 4 + 3];
    const porR = velPorVec4[idxR * 4 + 3];
    const facePor = Math.min(porL, porR);
    if (facePor <= 1e-5) return;

    const vFace = 0.5 * (velPorVec4[idxL * 4 + axis] + velPorVec4[idxR * 4 + axis]) * facePor;

    for (let s = 0; s < S; s++) {
      const cL = readC(statePingVec4, state2PingVec4, idxL, s);
      const cR = readC(statePingVec4, state2PingVec4, idxR, s);
      const adv = vFace >= 0 ? vFace * cL : vFace * cR;
      faceBuf[s] = limitFlux(adv - diffs[s] * facePor * (cR - cL) * invH, cL, cR);
    }

    const eL = statePingVec4[idxL * 4 + 3];
    const eR = statePingVec4[idxR * 4 + 3];
    const tL = auxPingVec4[idxL * 4 + 3];
    const tR = auxPingVec4[idxR * 4 + 3];
    const eAdv = vFace >= 0 ? vFace * eL : vFace * eR;
    const eCond = -0.08 * facePor * (tR - tL) * invH * 2200;
    faceBuf[6] = eAdv + eCond;
  };

  const cBuf = [0, 0, 0, 0, 0, 0];
  const netF = [0, 0, 0, 0, 0, 0];

  // Pass 1: Read statePing -> Boundary Ports + Symmetric 6-Face Flux Divergence -> Write statePong
  for (let idx = 0; idx < total; idx++) {
    const active = metaVec4[idx * 4] >= 0.5;
    if (!active) {
      statePongVec4[idx * 4 + 0] = 0;
      statePongVec4[idx * 4 + 1] = 0;
      statePongVec4[idx * 4 + 2] = 0;
      statePongVec4[idx * 4 + 3] = statePingVec4[idx * 4 + 3];
      if (state2PongVec4) {
        state2PongVec4[idx * 4 + 0] = 0;
        state2PongVec4[idx * 4 + 1] = 0;
        state2PongVec4[idx * 4 + 2] = 0;
        state2PongVec4[idx * 4 + 3] = 0;
      }
      auxPongVec4[idx * 4 + 0] = 0;
      auxPongVec4[idx * 4 + 1] = 0;
      auxPongVec4[idx * 4 + 2] = 0;
      auxPongVec4[idx * 4 + 3] = auxPingVec4[idx * 4 + 3];
      continue;
    }

    let cellMass = 0;
    for (let s = 0; s < S; s++) {
      cBuf[s] = readC(statePingVec4, state2PingVec4, idx, s);
      cellMass += cBuf[s] * masses[s];
      netF[s] = 0;
    }
    const e0 = statePingVec4[idx * 4 + 3];
    massPre += cellMass * vol;

    if (isOpen) {
      const feedMask = metaVec4[idx * 4 + 1];
      const exhaustMask = metaVec4[idx * 4 + 2];
      if (feedMask >= 0.5 && params.feedRatePerSec > 0) {
        const dFeed = params.feedRatePerSec * params.feedConcentrationMolM3 * dt;
        cBuf[0] += dFeed;
        feedMass += dFeed * masses[0] * vol;
      }
      if (exhaustMask >= 0.5 && params.exhaustRatePerSec > 0) {
        const frac = Math.min(0.85, params.exhaustRatePerSec * dt);
        for (let s = 0; s < S; s++) {
          const rm = cBuf[s] * frac;
          cBuf[s] -= rm;
          exhaustMass += rm * masses[s] * vol;
        }
      }
    }

    const iz = Math.floor(idx / nSq);
    const rem = idx - iz * nSq;
    const iy = Math.floor(rem / n);
    const ix = rem - iy * n;

    let netFE = 0;
    let jx = 0;
    let jy = 0;
    let jz = 0;

    const accumMassFace = (): number => {
      let mf = 0;
      for (let s = 0; s < S; s++) mf += faceBuf[s] * masses[s];
      return mf * 0.5;
    };

    if (ix + 1 < n) {
      evalFaceFlux(idx, idx + 1, 0);
      for (let s = 0; s < S; s++) netF[s] -= faceBuf[s];
      netFE -= faceBuf[6];
      jx += accumMassFace();
    }
    if (ix > 0) {
      evalFaceFlux(idx - 1, idx, 0);
      for (let s = 0; s < S; s++) netF[s] += faceBuf[s];
      netFE += faceBuf[6];
      jx += accumMassFace();
    }
    if (iy + 1 < n) {
      evalFaceFlux(idx, idx + n, 1);
      for (let s = 0; s < S; s++) netF[s] -= faceBuf[s];
      netFE -= faceBuf[6];
      jy += accumMassFace();
    }
    if (iy > 0) {
      evalFaceFlux(idx - n, idx, 1);
      for (let s = 0; s < S; s++) netF[s] += faceBuf[s];
      netFE += faceBuf[6];
      jy += accumMassFace();
    }
    if (iz + 1 < n) {
      evalFaceFlux(idx, idx + nSq, 2);
      for (let s = 0; s < S; s++) netF[s] -= faceBuf[s];
      netFE -= faceBuf[6];
      jz += accumMassFace();
    }
    if (iz > 0) {
      evalFaceFlux(idx - nSq, idx, 2);
      for (let s = 0; s < S; s++) netF[s] += faceBuf[s];
      netFE += faceBuf[6];
      jz += accumMassFace();
    }

    let cpVol = 1800;
    let cellPostMass = 0;
    for (let s = 0; s < S; s++) {
      const post = Math.max(0, cBuf[s] + netF[s] * dtOverH);
      cBuf[s] = post;
      cellPostMass += post * masses[s];
      cpVol += post * cps[s];
    }
    const postE = Math.max(5000, e0 + netFE * dtOverH);
    massPostFlux += cellPostMass * vol;

    statePongVec4[idx * 4 + 0] = cBuf[0];
    statePongVec4[idx * 4 + 1] = cBuf[1];
    statePongVec4[idx * 4 + 2] = cBuf[2];
    statePongVec4[idx * 4 + 3] = postE;
    if (state2PongVec4) {
      state2PongVec4[idx * 4 + 0] = cBuf[3];
      state2PongVec4[idx * 4 + 1] = cBuf[4];
      state2PongVec4[idx * 4 + 2] = cBuf[5];
      state2PongVec4[idx * 4 + 3] = 0;
    }

    const tempK = Math.max(40, Math.min(4500, postE / Math.max(200, cpVol)));
    auxPongVec4[idx * 4 + 0] = jx;
    auxPongVec4[idx * 4 + 1] = jy;
    auxPongVec4[idx * 4 + 2] = jz;
    auxPongVec4[idx * 4 + 3] = tempK;
  }

  // Pass 2: Read statePong -> Local Hypergraph Reaction -> Write statePing
  const dc = [0, 0, 0, 0, 0, 0];
  for (let idx = 0; idx < total; idx++) {
    if (metaVec4[idx * 4] < 0.5) continue;
    activeCount++;

    cBuf[0] = statePongVec4[idx * 4 + 0];
    cBuf[1] = statePongVec4[idx * 4 + 1];
    cBuf[2] = statePongVec4[idx * 4 + 2];
    cBuf[3] = state2PongVec4 ? state2PongVec4[idx * 4 + 0] : 0;
    cBuf[4] = state2PongVec4 ? state2PongVec4[idx * 4 + 1] : 0;
    cBuf[5] = state2PongVec4 ? state2PongVec4[idx * 4 + 2] : 0;
    let eVal = statePongVec4[idx * 4 + 3];
    let tempK = auxPongVec4[idx * 4 + 3];
    const pressAtm = metaVec4[idx * 4 + 3];
    const por = velPorVec4[idx * 4 + 3];

    let totalEntropy = 0;
    let deltaE = 0;
    const subSteps = 2;
    const subDt = dt / subSteps;

    for (let step = 0; step < subSteps; step++) {
      for (let s = 0; s < S; s++) dc[s] = 0;
      let stepDH = 0;

      for (let r = 0; r < R; r++) {
        const rxn = hypergraph.reactions[r];
        const gate = evaluateTpWindowGate(rxn, tempK, pressAtm);
        if (gate <= 0) continue;

        const rowOff = r * hypergraph.numSpecies;
        const kf =
          evaluateArrheniusRateConstant(
            hypergraph.calibratedForwardA[r],
            hypergraph.calibratedForwardEaJ[r],
            rxn.tempExponentBeta ?? 0,
            tempK,
          ) * gate;

        let fwdProd = 1.0;
        for (let s = 0; s < S; s++) {
          const ord = hypergraph.reactantOrderMatrix[rowOff + s] ?? 0;
          if (ord > 0) {
            const c = cBuf[s];
            fwdProd *= ord === 1 ? c : ord === 2 ? c * c : Math.pow(Math.max(1e-6, c), ord);
          }
        }
        const fwdRate = kf * fwdProd;

        let revRate = 0;
        if (rxn.isReversible && (rxn.reverseA ?? 0) > 0) {
          const kr =
            evaluateArrheniusRateConstant(
              rxn.reverseA ?? 0,
              rxn.reverseEaJ ?? rxn.forwardEaJ,
              rxn.tempExponentBeta ?? 0,
              tempK,
            ) * gate;
          let revProd = 1.0;
          for (let s = 0; s < S; s++) {
            const ord = hypergraph.productOrderMatrix[rowOff + s] ?? 0;
            if (ord > 0) {
              const c = cBuf[s];
              revProd *= ord === 1 ? c : ord === 2 ? c * c : Math.pow(Math.max(1e-6, c), ord);
            }
          }
          revRate = kr * revProd;
        }

        const netRate = fwdRate - revRate;
        stepDH += netRate * rxn.enthalpyChangeJ;

        if (step === 0) {
          if (fwdRate > 1e-12 && revRate > 1e-12) {
            totalEntropy += GAS_CONSTANT_R * (fwdRate - revRate) * Math.log(fwdRate / revRate);
          } else if (Math.abs(netRate) > 1e-12) {
            totalEntropy += GAS_CONSTANT_R * Math.abs(netRate) * 4.5;
          }
        }

        for (let s = 0; s < S; s++) {
          dc[s] += (hypergraph.stoichMatrix[rowOff + s] ?? 0) * netRate;
        }
      }

      let scale = 1.0;
      for (let s = 0; s < S; s++) {
        if (dc[s] * subDt + cBuf[s] < 0 && dc[s] < -1e-15) {
          scale = Math.min(scale, Math.max(0, cBuf[s] / (-dc[s] * subDt)));
        }
      }

      const effDt = subDt * scale;
      let cpStep = 1800;
      for (let s = 0; s < S; s++) {
        cBuf[s] = Math.max(0, cBuf[s] + dc[s] * effDt);
        cpStep += cBuf[s] * cps[s];
      }
      deltaE += -stepDH * effDt;
      const stepE = Math.max(5000, eVal + deltaE);
      tempK = Math.max(40, Math.min(4500, stepE / Math.max(200, cpStep)));
    }

    eVal = Math.max(5000, eVal + deltaE);
    statePingVec4[idx * 4 + 0] = cBuf[0];
    statePingVec4[idx * 4 + 1] = cBuf[1];
    statePingVec4[idx * 4 + 2] = cBuf[2];
    statePingVec4[idx * 4 + 3] = eVal;
    if (state2PingVec4) {
      state2PingVec4[idx * 4 + 0] = cBuf[3];
      state2PingVec4[idx * 4 + 1] = cBuf[4];
      state2PingVec4[idx * 4 + 2] = cBuf[5];
      state2PingVec4[idx * 4 + 3] = 0;
    }

    auxPingVec4[idx * 4 + 0] = auxPongVec4[idx * 4 + 0];
    auxPingVec4[idx * 4 + 1] = auxPongVec4[idx * 4 + 1];
    auxPingVec4[idx * 4 + 2] = auxPongVec4[idx * 4 + 2];
    auxPingVec4[idx * 4 + 3] = tempK;

    const autocatIdx = S > 3 ? 3 : 1;
    diagVec4[idx * 4 + 0] = classifyMatterPhase(tempK, pressAtm, por);
    diagVec4[idx * 4 + 1] = totalEntropy;
    diagVec4[idx * 4 + 2] = Math.max(0, diagVec4[idx * 4 + 2] + Math.max(0, cBuf[autocatIdx] - 0.75) * dt);
    diagVec4[idx * 4 + 3] = deltaE / Math.max(1e-4, dt);

    let mCell = 0;
    for (let s = 0; s < S; s++) {
      mCell += cBuf[s] * masses[s];
      sumSpecies[s] += cBuf[s];
    }
    massPostReact += mCell * vol;
    sumT += tempK;
    sumEntropy += totalEntropy * vol;
  }

  const boundaryNet = feedMass - exhaustMass;
  const residual = massPostReact - (massPre + boundaryNet);
  const scaleRef = Math.max(1e-9, massPre, massPostReact, Math.abs(boundaryNet));
  const denom = Math.max(1, activeCount);

  return {
    totalMassPreKg: massPre,
    boundaryFeedMassKg: feedMass,
    boundaryExhaustMassKg: exhaustMass,
    totalMassPostFluxKg: massPostFlux,
    totalMassPostReactKg: massPostReact,
    relativeError: Math.abs(residual) / scaleRef,
    meanConcentrations: sumSpecies.slice(0, S).map((v) => v / denom),
    totalEntropyProdRate: sumEntropy,
    meanTempK: sumT / denom,
    activeCellCount: activeCount,
  };
}

export interface GpuScalarReadbackResult {
  readonly totalMassPreKg: number;
  readonly totalMassPostFluxKg: number;
  readonly totalMassPostReactKg: number;
  readonly boundaryFeedMassKg: number;
  readonly boundaryExhaustMassKg: number;
  readonly meanConcentrations: number[];
  readonly totalEntropyProdRate: number;
  readonly meanTempK: number;
  readonly activeCellCount: number;
}

/**
 * True WebGPU Compute Ping-Pong Solver supporting up to 128^3 (2,097,152 voxels)
 * and up to 6 chemical species & 6 hypergraph reactions.
 */
export class WebGpuFvmComputeSolver {
  public readonly cellsPerAxis: FvmResolutionCells;
  public readonly chunksPerAxis: number;
  public readonly totalCells: number;
  public readonly worldHalf: number;
  public readonly voxelSize: number;
  public readonly cellVolumeM3: number;
  public readonly baseRadius: number;
  public numSpecies: number;

  // Ping-Pong GPU storage buffers (vec4 per voxel)
  public readonly statePingAttr: THREE.StorageBufferAttribute;
  public readonly statePongAttr: THREE.StorageBufferAttribute;
  public readonly state2PingAttr: THREE.StorageBufferAttribute;
  public readonly state2PongAttr: THREE.StorageBufferAttribute;
  public readonly auxPingAttr: THREE.StorageBufferAttribute;
  public readonly auxPongAttr: THREE.StorageBufferAttribute;
  public readonly velPorAttr: THREE.StorageBufferAttribute;
  public readonly metaAttr: THREE.StorageBufferAttribute;
  public readonly diagAttr: THREE.StorageBufferAttribute;

  // Packed numeric reaction hypergraph tables (66 vec4 floats)
  public readonly kineticsAttr: THREE.StorageBufferAttribute;
  // 20 x uint32 atomic fixed-point scalar reduction counters (80 bytes total readback!)
  public readonly reduceAtomicAttr: THREE.StorageBufferAttribute;
  // 8x8x8 = 512 macro feedback bins (8 KB readback for planetary thermal & mineralization feedback)
  public readonly macroFeedbackAttr: THREE.StorageBufferAttribute;
  public readonly macroFeedbackBins = 512;

  // TSL Uniforms
  private readonly uDt = uniform(0.05);
  private readonly uBoundaryOpen = uniform(1.0);
  private readonly uFeedRate = uniform(0.42);
  private readonly uExhaustRate = uniform(0.36);
  private readonly uFeedConc = uniform(2.6);
  private readonly uAtomicScale = uniform(10000.0);
  private readonly uSeedModeCode = uniform(1.0); // 0=closed, 1=open, 2=carbon_water, 3=cellular, 4=hydrology

  // TSL Compute Nodes
  private readonly resetReduceNode: ComputeNode;
  private readonly fluxPassNode: ComputeNode;
  private readonly reactPassNode: ComputeNode;
  private readonly seedPlanetNode: ComputeNode;

  private readonly coarsePlanetAttr: THREE.StorageBufferAttribute;
  private readonly uCoarseN = uniform(48);
  private readonly uCoarseVoxelSize = uniform(1.0);
  private readonly uCoarseWorldHalf = uniform(20.0);
  private readonly uSunDir = uniform(new THREE.Vector3(0.7, 0.5, 0.5));
  private readonly uBaseTempK = uniform(305.0);

  private readonly statePingReadNode;
  private readonly state2PingReadNode;
  private readonly auxPingReadNode;
  private readonly velPorReadNode;
  private readonly metaReadNode;
  private readonly diagReadNode;
  private readonly kineticsReadNode;

  private readbackInFlight = false;
  public lastReadback: GpuScalarReadbackResult | null = null;
  public lastMacroBins: MacroFeedbackBin[] = [];

  constructor(
    spec: FvmResolutionSpec,
    worldHalf: number,
    baseRadius: number,
    hypergraph: CompiledReactionHypergraph,
    coarsePlanetCellsPerAxis = 48,
  ) {
    this.cellsPerAxis = spec.cellsPerAxis;
    this.chunksPerAxis = spec.chunksPerAxis;
    this.totalCells = spec.totalVoxels;
    this.worldHalf = worldHalf;
    this.voxelSize = (worldHalf * 2) / this.cellsPerAxis;
    this.cellVolumeM3 = this.voxelSize * this.voxelSize * this.voxelSize;
    this.baseRadius = baseRadius;
    this.numSpecies = Math.min(MAX_GPU_SPECIES, hypergraph.numSpecies);

    const fpScale = this.totalCells > 500_000 ? 1500.0 : 10000.0;
    this.uAtomicScale.value = fpScale;

    this.statePingAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.statePongAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.state2PingAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.state2PongAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.auxPingAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.auxPongAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.velPorAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.metaAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.diagAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);

    const kinArr = packHypergraphKineticsVec4(hypergraph);
    this.kineticsAttr = new THREE.StorageBufferAttribute(kinArr, 4);
    this.reduceAtomicAttr = new THREE.StorageBufferAttribute(new Uint32Array(20), 1);
    this.macroFeedbackAttr = new THREE.StorageBufferAttribute(
      new Float32Array(this.macroFeedbackBins * 4),
      4,
    );

    const coarseN = Math.max(8, coarsePlanetCellsPerAxis);
    this.uCoarseN.value = coarseN;
    this.uCoarseWorldHalf.value = worldHalf;
    this.uCoarseVoxelSize.value = (worldHalf * 2) / coarseN;
    this.coarsePlanetAttr = new THREE.StorageBufferAttribute(
      new Float32Array(coarseN * coarseN * coarseN * 2),
      2,
    );

    const N = this.totalCells;
    this.statePingReadNode = storage(this.statePingAttr, 'vec4', N).toReadOnly();
    const statePingWrite = storage(this.statePingAttr, 'vec4', N);
    const statePongRead = storage(this.statePongAttr, 'vec4', N).toReadOnly();
    const statePongWrite = storage(this.statePongAttr, 'vec4', N);

    this.state2PingReadNode = storage(this.state2PingAttr, 'vec4', N).toReadOnly();
    const state2PingWrite = storage(this.state2PingAttr, 'vec4', N);
    const state2PongRead = storage(this.state2PongAttr, 'vec4', N).toReadOnly();
    const state2PongWrite = storage(this.state2PongAttr, 'vec4', N);

    this.auxPingReadNode = storage(this.auxPingAttr, 'vec4', N).toReadOnly();
    const auxPingWrite = storage(this.auxPingAttr, 'vec4', N);
    const auxPongRead = storage(this.auxPongAttr, 'vec4', N).toReadOnly();
    const auxPongWrite = storage(this.auxPongAttr, 'vec4', N);

    this.velPorReadNode = storage(this.velPorAttr, 'vec4', N).toReadOnly();
    const velPorRead = this.velPorReadNode;
    const velPorWrite = storage(this.velPorAttr, 'vec4', N);
    this.metaReadNode = storage(this.metaAttr, 'vec4', N).toReadOnly();
    const metaWrite = storage(this.metaAttr, 'vec4', N);
    this.diagReadNode = storage(this.diagAttr, 'vec4', N).toReadOnly();
    const diagWrite = storage(this.diagAttr, 'vec4', N);
    this.kineticsReadNode = storage(this.kineticsAttr, 'vec4', PACKED_KINETICS_VEC4_COUNT).toReadOnly();
    const reduceAtomic = storage(this.reduceAtomicAttr, 'uint', 20).toAtomic();
    const macroFeedbackWrite = storage(this.macroFeedbackAttr, 'vec4', this.macroFeedbackBins);
    const coarsePlanetRead = storage(this.coarsePlanetAttr, 'vec2', coarseN * coarseN * coarseN).toReadOnly();

    const nU = uint(this.cellsPerAxis);
    const nSqU = uint(this.cellsPerAxis * this.cellsPerAxis);
    const hVal = float(this.voxelSize);
    const invH = float(1.0 / this.voxelSize);
    const halfF = float(this.worldHalf);
    const r0F = float(this.baseRadius);
    const volF = float(this.cellVolumeM3);

    // Compute Pass S: GPU Planet Seed Initializer (< 2ms for 2.09M voxels!)
    this.seedPlanetNode = Fn(() => {
      const idx = instanceIndex;
      const iz = idx.div(nSqU);
      const rem = idx.sub(iz.mul(nSqU));
      const iy = rem.div(nU);
      const ix = rem.sub(iy.mul(nU));

      const wx = float(ix).add(0.5).mul(hVal).sub(halfF);
      const wy = float(iy).add(0.5).mul(hVal).sub(halfF);
      const wz = float(iz).add(0.5).mul(hVal).sub(halfF);
      const r = length(vec3(wx, wy, wz));

      const minShell = r0F.mul(0.62);
      const maxShell = r0F.mul(1.22);
      const inShell = r.greaterThanEqual(minShell).and(r.lessThanEqual(maxShell));

      If(inShell.not(), () => {
        metaWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 1.0));
        velPorWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 0.0));
        statePingWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 5000.0));
        state2PingWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 0.0));
        auxPingWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 290.0));
        diagWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 0.0));
      }).Else(() => {
        const cMaxF = float(this.uCoarseN).sub(1.0);
        const cx = uint(tslClamp(floor(wx.add(this.uCoarseWorldHalf).div(this.uCoarseVoxelSize)), 0.0, cMaxF));
        const cy = uint(tslClamp(floor(wy.add(this.uCoarseWorldHalf).div(this.uCoarseVoxelSize)), 0.0, cMaxF));
        const cz = uint(tslClamp(floor(wz.add(this.uCoarseWorldHalf).div(this.uCoarseVoxelSize)), 0.0, cMaxF));
        const cIdx = cx.add(cy.mul(uint(this.uCoarseN))).add(cz.mul(uint(this.uCoarseN)).mul(uint(this.uCoarseN)));
        const dm = coarsePlanetRead.element(cIdx);
        const dens = dm.x;
        const matId = dm.y;

        const openAir = dens.lessThanEqual(0.0);
        const nearSurf = abs(dens).lessThan(hVal.mul(2.2));
        const isPorousMat = abs(matId.sub(5.0)).lessThan(0.5).or(abs(matId.sub(3.0)).lessThan(0.5));
        const por = select(openAir, float(1.0), select(nearSurf, float(0.65), select(isPorousMat, float(0.45), float(0.22))));

        const invR = float(1.0).div(max(r, 0.0001));
        const rx = wx.mul(invR);
        const ry = wy.mul(invR);
        const rz = wz.mul(invR);
        const sunDot = dot(vec3(rx, ry, rz), this.uSunDir);
        const zonal = float(0.28).mul(float(0.4).add(float(0.6).mul(pow(max(float(0.0), float(1.0).sub(ry.mul(ry))), 0.5))));
        const updraft = sunDot.mul(0.08);
        const vx = rz.negate().mul(zonal).add(rx.mul(updraft));
        const vy = ry.mul(updraft);
        const vz = rx.mul(zonal).add(rz.mul(updraft));

        const tempBase = this.uBaseTempK.add(sunDot.mul(22.0)).add(max(float(0.0), r0F.sub(r)).mul(16.0));
        const press = max(float(0.05), float(1.2).add(max(float(0.0), r0F.sub(r)).mul(8.0)));

        const seed1 = length(vec3(wx, wy.sub(r0F.mul(0.96)), wz));
        const seed2 = length(vec3(wx.sub(r0F.mul(0.72)), wy.add(r0F.mul(0.3)), wz.sub(r0F.mul(0.4))));
        const seedRad = max(hVal.mul(2.6), r0F.mul(0.28));
        const hasSeed = seed1.lessThan(seedRad).or(seed2.lessThan(seedRad));
        const inZone = seed1.lessThan(r0F.mul(0.24));

        const c0Init = float(0.0).toVar('sC0');
        const c1Init = float(0.0).toVar('sC1');
        const c2Init = float(0.0).toVar('sC2');
        const c3Init = float(0.0).toVar('sC3');
        const c4Init = float(0.0).toVar('sC4');
        const c5Init = float(0.0).toVar('sC5');
        const tempAdj = tempBase.toVar('sT');

        // mode 0: closed_equilibrium, 1: open_autocatalytic, 2: planetary_carbon_water, 3: cellular_metabolism, 4: planetary_hydrology
        If(this.uSeedModeCode.lessThan(0.5), () => {
          c0Init.assign(select(wx.greaterThanEqual(0.0), float(1.85), float(0.35)));
          c1Init.assign(0.05);
          c2Init.assign(0.0);
        }).ElseIf(this.uSeedModeCode.lessThan(1.5), () => {
          c0Init.assign(1.65);
          c1Init.assign(select(hasSeed, float(1.15), float(0.02)));
          c2Init.assign(0.05);
        }).ElseIf(this.uSeedModeCode.lessThan(2.5), () => {
          // planetary_carbon_water: [CO2, H2O(g), H2O(l), CH2O, O2, CH4]
          const isOceanBand = openAir.and(abs(ry).lessThan(0.55));
          const isBioBelt = nearSurf.and(abs(ry).lessThan(0.68));
          c0Init.assign(select(openAir, float(1.45), float(0.65)));
          c1Init.assign(select(openAir, max(float(0.18), sunDot.add(0.45).mul(0.65)), float(0.08)));
          c2Init.assign(select(isOceanBand, float(2.15), select(nearSurf, float(1.25), float(0.45))));
          c3Init.assign(select(inZone, float(1.35), select(isBioBelt, float(0.85), float(0.06))));
          c4Init.assign(select(openAir, float(0.95), float(0.18)));
          c5Init.assign(select(inZone, float(0.42), float(0.08)));
          tempAdj.assign(tslClamp(float(288.0).add(sunDot.mul(26.0)).sub(abs(ry).mul(32.0)), float(240.0), float(395.0)));
        }).ElseIf(this.uSeedModeCode.lessThan(3.5), () => {
          // cellular_metabolism: [C6H12O6, O2, CO2, H2O, C3H6O3, CH2O]
          c0Init.assign(select(inZone, float(1.95), select(nearSurf, float(0.75), float(0.18))));
          c1Init.assign(select(openAir, float(1.35), float(0.32)));
          c2Init.assign(0.45);
          c3Init.assign(1.65);
          c4Init.assign(select(inZone, float(0.18), float(0.06)));
          c5Init.assign(select(inZone, float(1.45), select(hasSeed, float(0.62), float(0.08))));
          tempAdj.assign(float(309.5).add(sunDot.mul(8.0)));
        }).Else(() => {
          // planetary_hydrology: [H2O(l), H2O(g), H2O(s)]
          const polar = abs(ry).greaterThan(0.68);
          c0Init.assign(select(polar, float(0.35), float(1.95)));
          c1Init.assign(max(float(0.12), sunDot.add(0.3).mul(0.85)));
          c2Init.assign(select(polar, float(1.85), float(0.04)));
          tempAdj.assign(tslClamp(float(296.0).add(sunDot.mul(24.0)).sub(abs(ry).mul(48.0)), float(230.0), float(385.0)));
        });

        const isOpenMod = this.uSeedModeCode.greaterThan(0.5);
        const feedMask = select(isOpenMod.and(r.lessThanEqual(r0F.mul(1.04))), float(1.0), float(0.0));
        const exhaustMask = select(isOpenMod.and(r.greaterThanEqual(r0F.mul(0.88))), float(1.0), float(0.0));

        const kinCpA = this.kineticsReadNode.element(uint(4));
        const kinCpB = this.kineticsReadNode.element(uint(5));
        const cpVol = kinCpB.z
          .add(c0Init.mul(kinCpA.x))
          .add(c1Init.mul(kinCpA.y))
          .add(c2Init.mul(kinCpA.z))
          .add(c3Init.mul(kinCpA.w))
          .add(c4Init.mul(kinCpB.x))
          .add(c5Init.mul(kinCpB.y));
        const safeT = tslClamp(tempAdj, float(220.0), float(2200.0));
        const internalE = cpVol.mul(safeT);

        metaWrite.element(idx).assign(vec4(1.0, feedMask, exhaustMask, press));
        velPorWrite.element(idx).assign(vec4(vx, vy, vz, por));
        statePingWrite.element(idx).assign(vec4(c0Init, c1Init, c2Init, internalE));
        state2PingWrite.element(idx).assign(vec4(c3Init, c4Init, c5Init, 0.0));
        auxPingWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, safeT));
        diagWrite.element(idx).assign(vec4(1.0, 0.0, 0.0, 0.0));
      });
    })().compute(N, [64]).setName('MetabolismGpuSeed');

    // Compute Pass 0: Reset atomic reduction buffer (20 uint slots) + clear macro feedback
    this.resetReduceNode = Fn(() => {
      If(instanceIndex.lessThan(uint(20)), () => {
        atomicStore(reduceAtomic.element(instanceIndex), uint(0));
      });
      macroFeedbackWrite.element(instanceIndex).assign(vec4(0.0, 0.0, 0.0, 0.0));
    })().compute(this.macroFeedbackBins, [64]).setName('MetabolismResetAtomic');

    // Compute Pass 1: Boundary Ports + Conservative 6-Face Symmetric Flux (Ping -> Pong)
    this.fluxPassNode = Fn(() => {
      const idx = instanceIndex;
      const metaL = this.metaReadNode.element(idx);
      const isActL = metaL.x.greaterThanEqual(0.5);

      If(isActL.not(), () => {
        statePongWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 5000.0));
        state2PongWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 0.0));
        auxPongWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 290.0));
      }).Else(() => {
        const kinMA = this.kineticsReadNode.element(uint(0));
        const kinMB = this.kineticsReadNode.element(uint(1));
        const kinDA = this.kineticsReadNode.element(uint(2));
        const kinDB = this.kineticsReadNode.element(uint(3));
        const kinCpA = this.kineticsReadNode.element(uint(4));
        const kinCpB = this.kineticsReadNode.element(uint(5));

        const stL = this.statePingReadNode.element(idx);
        const st2L = this.state2PingReadNode.element(idx);
        const auxL = this.auxPingReadNode.element(idx);
        const vpL = velPorRead.element(idx);

        const cL0 = max(float(0.0), stL.x).toVar('cL0');
        const cL1 = max(float(0.0), stL.y).toVar('cL1');
        const cL2 = max(float(0.0), stL.z).toVar('cL2');
        const cL3 = max(float(0.0), st2L.x).toVar('cL3');
        const cL4 = max(float(0.0), st2L.y).toVar('cL4');
        const cL5 = max(float(0.0), st2L.z).toVar('cL5');
        const eL = stL.w;
        const tL = auxL.w;
        const porL = vpL.w;

        const mPreKg = cL0.mul(kinMA.x)
          .add(cL1.mul(kinMA.y))
          .add(cL2.mul(kinMA.z))
          .add(cL3.mul(kinMA.w))
          .add(cL4.mul(kinMB.x))
          .add(cL5.mul(kinMB.y))
          .mul(volF);
        atomicAdd(reduceAtomic.element(uint(2)), uint(max(float(0.0), mPreKg.mul(this.uAtomicScale)).add(0.5)));

        const dtOverH = this.uDt.mul(invH);

        If(this.uBoundaryOpen.greaterThan(0.5), () => {
          If(metaL.y.greaterThanEqual(0.5), () => {
            const feedAmt = this.uFeedRate.mul(this.uFeedConc).mul(this.uDt);
            cL0.addAssign(feedAmt);
            const fMass = feedAmt.mul(kinMA.x).mul(volF);
            atomicAdd(reduceAtomic.element(uint(4)), uint(max(float(0.0), fMass.mul(this.uAtomicScale)).add(0.5)));
          });
          If(metaL.z.greaterThanEqual(0.5), () => {
            const frac = min(float(0.85), this.uExhaustRate.mul(this.uDt));
            const ex0 = cL0.mul(frac);
            const ex1 = cL1.mul(frac);
            const ex2 = cL2.mul(frac);
            const ex3 = cL3.mul(frac);
            const ex4 = cL4.mul(frac);
            const ex5 = cL5.mul(frac);
            cL0.subAssign(ex0);
            cL1.subAssign(ex1);
            cL2.subAssign(ex2);
            cL3.subAssign(ex3);
            cL4.subAssign(ex4);
            cL5.subAssign(ex5);
            const exMass = ex0.mul(kinMA.x)
              .add(ex1.mul(kinMA.y))
              .add(ex2.mul(kinMA.z))
              .add(ex3.mul(kinMA.w))
              .add(ex4.mul(kinMB.x))
              .add(ex5.mul(kinMB.y))
              .mul(volF);
            atomicAdd(reduceAtomic.element(uint(5)), uint(max(float(0.0), exMass.mul(this.uAtomicScale)).add(0.5)));
          });
        });

        const iz = idx.div(nSqU);
        const rem = idx.sub(iz.mul(nSqU));
        const iy = rem.div(nU);
        const ix = rem.sub(iy.mul(nU));

        const netF0 = float(0.0).toVar('netF0');
        const netF1 = float(0.0).toVar('netF1');
        const netF2 = float(0.0).toVar('netF2');
        const netF3 = float(0.0).toVar('netF3');
        const netF4 = float(0.0).toVar('netF4');
        const netF5 = float(0.0).toVar('netF5');
        const netFE = float(0.0).toVar('netFE');
        const jOut = vec3(0.0, 0.0, 0.0).toVar('jOut');

        const accumulateFace = (
          nIdx: Node<'uint'>,
          axisCode: number,
          isPositiveDir: boolean,
        ) => {
          const metaN = this.metaReadNode.element(nIdx);
          If(metaN.x.greaterThanEqual(0.5), () => {
            const stN = this.statePingReadNode.element(nIdx);
            const st2N = this.state2PingReadNode.element(nIdx);
            const auxN = this.auxPingReadNode.element(nIdx);
            const vpN = velPorRead.element(nIdx);
            const facePor = min(porL, vpN.w);

            const vA = axisCode === 0 ? vpL.x : axisCode === 1 ? vpL.y : vpL.z;
            const vB = axisCode === 0 ? vpN.x : axisCode === 1 ? vpN.y : vpN.z;
            const vFace = vA.add(vB).mul(0.5).mul(facePor);

            const evalSpFlux = (
              sL: Node<'float'>,
              sN: Node<'float'>,
              diffCoeff: Node<'float'>,
            ) => {
              const lVal = isPositiveDir ? max(float(0.0), sL) : max(float(0.0), sN);
              const rVal = isPositiveDir ? max(float(0.0), sN) : max(float(0.0), sL);
              const raw = select(vFace.greaterThanEqual(0.0), vFace.mul(lVal), vFace.mul(rVal))
                .sub(diffCoeff.mul(facePor).mul(rVal.sub(lVal)).mul(invH));
              const capPos = lVal.mul(0.14).div(dtOverH);
              const capNeg = rVal.mul(-0.14).div(dtOverH);
              return select(raw.greaterThan(0.0), min(raw, capPos), max(raw, capNeg));
            };

            const f0 = evalSpFlux(stL.x, stN.x, kinDA.x);
            const f1 = evalSpFlux(stL.y, stN.y, kinDA.y);
            const f2 = evalSpFlux(stL.z, stN.z, kinDA.z);
            const f3 = evalSpFlux(st2L.x, st2N.x, kinDA.w);
            const f4 = evalSpFlux(st2L.y, st2N.y, kinDB.x);
            const f5 = evalSpFlux(st2L.z, st2N.z, kinDB.y);

            const eLeft = isPositiveDir ? eL : stN.w;
            const eRight = isPositiveDir ? stN.w : eL;
            const tLeft = isPositiveDir ? tL : auxN.w;
            const tRight = isPositiveDir ? auxN.w : tL;
            const fE = select(vFace.greaterThanEqual(0.0), vFace.mul(eLeft), vFace.mul(eRight))
              .sub(float(176.0).mul(facePor).mul(tRight.sub(tLeft)).mul(invH));

            if (isPositiveDir) {
              netF0.subAssign(f0);
              netF1.subAssign(f1);
              netF2.subAssign(f2);
              netF3.subAssign(f3);
              netF4.subAssign(f4);
              netF5.subAssign(f5);
              netFE.subAssign(fE);
            } else {
              netF0.addAssign(f0);
              netF1.addAssign(f1);
              netF2.addAssign(f2);
              netF3.addAssign(f3);
              netF4.addAssign(f4);
              netF5.addAssign(f5);
              netFE.addAssign(fE);
            }

            const massF = f0.mul(kinMA.x)
              .add(f1.mul(kinMA.y))
              .add(f2.mul(kinMA.z))
              .add(f3.mul(kinMA.w))
              .add(f4.mul(kinMB.x))
              .add(f5.mul(kinMB.y))
              .mul(0.5);
            if (axisCode === 0) jOut.x.addAssign(massF);
            else if (axisCode === 1) jOut.y.addAssign(massF);
            else jOut.z.addAssign(massF);
          });
        };

        If(ix.add(uint(1)).lessThan(nU), () => accumulateFace(idx.add(uint(1)), 0, true));
        If(ix.greaterThan(uint(0)), () => accumulateFace(idx.sub(uint(1)), 0, false));
        If(iy.add(uint(1)).lessThan(nU), () => accumulateFace(idx.add(nU), 1, true));
        If(iy.greaterThan(uint(0)), () => accumulateFace(idx.sub(nU), 1, false));
        If(iz.add(uint(1)).lessThan(nU), () => accumulateFace(idx.add(nSqU), 2, true));
        If(iz.greaterThan(uint(0)), () => accumulateFace(idx.sub(nSqU), 2, false));

        const postC0 = max(float(0.0), cL0.add(netF0.mul(dtOverH)));
        const postC1 = max(float(0.0), cL1.add(netF1.mul(dtOverH)));
        const postC2 = max(float(0.0), cL2.add(netF2.mul(dtOverH)));
        const postC3 = max(float(0.0), cL3.add(netF3.mul(dtOverH)));
        const postC4 = max(float(0.0), cL4.add(netF4.mul(dtOverH)));
        const postC5 = max(float(0.0), cL5.add(netF5.mul(dtOverH)));
        const postE = max(float(5000.0), eL.add(netFE.mul(dtOverH)));

        const mFluxKg = postC0.mul(kinMA.x)
          .add(postC1.mul(kinMA.y))
          .add(postC2.mul(kinMA.z))
          .add(postC3.mul(kinMA.w))
          .add(postC4.mul(kinMB.x))
          .add(postC5.mul(kinMB.y))
          .mul(volF);
        atomicAdd(reduceAtomic.element(uint(3)), uint(max(float(0.0), mFluxKg.mul(this.uAtomicScale)).add(0.5)));

        const cpVol = kinCpB.z
          .add(postC0.mul(kinCpA.x))
          .add(postC1.mul(kinCpA.y))
          .add(postC2.mul(kinCpA.z))
          .add(postC3.mul(kinCpA.w))
          .add(postC4.mul(kinCpB.x))
          .add(postC5.mul(kinCpB.y));
        const tempPost = tslClamp(postE.div(max(float(200.0), cpVol)), float(40.0), float(4500.0));

        statePongWrite.element(idx).assign(vec4(postC0, postC1, postC2, postE));
        state2PongWrite.element(idx).assign(vec4(postC3, postC4, postC5, 0.0));
        auxPongWrite.element(idx).assign(vec4(jOut.x, jOut.y, jOut.z, tempPost));
      });
    })().compute(N, [64]).setName('MetabolismFluxPass');

    // Compute Pass 2: Local 6-Species Hypergraph Reaction + Enthalpy + Phase + Atomic Audit (Pong -> Ping)
    this.reactPassNode = Fn(() => {
      const idx = instanceIndex;
      const metaL = this.metaReadNode.element(idx);
      const isActL = metaL.x.greaterThanEqual(0.5);

      If(isActL, () => {
        const kinMA = this.kineticsReadNode.element(uint(0));
        const kinMB = this.kineticsReadNode.element(uint(1));
        const kinCpA = this.kineticsReadNode.element(uint(4));
        const kinCpB = this.kineticsReadNode.element(uint(5));
        const stP = statePongRead.element(idx);
        const st2P = state2PongRead.element(idx);
        const auxP = auxPongRead.element(idx);
        const vpL = velPorRead.element(idx);
        const prevDiag = this.diagReadNode.element(idx);

        const c0 = max(float(0.0), stP.x).toVar('rxC0');
        const c1 = max(float(0.0), stP.y).toVar('rxC1');
        const c2 = max(float(0.0), stP.z).toVar('rxC2');
        const c3 = max(float(0.0), st2P.x).toVar('rxC3');
        const c4 = max(float(0.0), st2P.y).toVar('rxC4');
        const c5 = max(float(0.0), st2P.z).toVar('rxC5');
        const eVal = stP.w.toVar('rxE');
        const tempK = auxP.w.toVar('rxT');
        const press = metaL.w;
        const sigmaTotal = float(0.0).toVar('sigmaTot');

        const subDt = this.uDt.mul(0.5);
        const Rconst = float(GAS_CONSTANT_R);

        Loop({ start: 0, end: 2, type: 'int', condition: '<' }, ({ i: subIdx }) => {
          const dc0 = float(0.0).toVar('dc0');
          const dc1 = float(0.0).toVar('dc1');
          const dc2 = float(0.0).toVar('dc2');
          const dc3 = float(0.0).toVar('dc3');
          const dc4 = float(0.0).toVar('dc4');
          const dc5 = float(0.0).toVar('dc5');
          const dHRate = float(0.0).toVar('dH');
          const safeT = max(float(20.0), tempK);

          Loop({ start: 0, end: MAX_GPU_REACTIONS, type: 'int', condition: '<' }, ({ i: rIdx }) => {
            const stRowA = this.kineticsReadNode.element(uint(12).add(uint(rIdx)));
            const stRowB = this.kineticsReadNode.element(uint(18).add(uint(rIdx)));
            const fOrdA = this.kineticsReadNode.element(uint(24).add(uint(rIdx)));
            const fOrdB = this.kineticsReadNode.element(uint(30).add(uint(rIdx)));
            const rOrdA = this.kineticsReadNode.element(uint(36).add(uint(rIdx)));
            const rOrdB = this.kineticsReadNode.element(uint(42).add(uint(rIdx)));
            const kinF = this.kineticsReadNode.element(uint(48).add(uint(rIdx)));
            const kinR = this.kineticsReadNode.element(uint(54).add(uint(rIdx)));
            const tpB = this.kineticsReadNode.element(uint(60).add(uint(rIdx)));

            const activeSlot = tpB.w.greaterThan(0.5);
            const inWindow = safeT.greaterThanEqual(kinR.z)
              .and(safeT.lessThanEqual(kinR.w))
              .and(press.greaterThanEqual(tpB.x))
              .and(press.lessThanEqual(tpB.y))
              .and(activeSlot);

            If(inWindow, () => {
              const tSpan = max(float(0.001), kinR.w.sub(kinR.z));
              const tPad = max(float(0.001), min(tSpan.mul(0.03), float(12.0)));
              const pSpan = max(float(0.0001), tpB.y.sub(tpB.x));
              const pPad = max(float(0.0001), min(pSpan.mul(0.03), max(float(0.02), tpB.x.mul(0.5))));
              const gate = min(
                min(tslClamp(safeT.sub(kinR.z).div(tPad), 0.0, 1.0), tslClamp(kinR.w.sub(safeT).div(tPad), 0.0, 1.0)),
                min(tslClamp(press.sub(tpB.x).div(pPad), 0.0, 1.0), tslClamp(tpB.y.sub(press).div(pPad), 0.0, 1.0)),
              );

              const expF = tslClamp(kinF.y.negate().div(Rconst.mul(safeT)), -70.0, 20.0);
              const kf = kinF.x.mul(exp(expF)).mul(gate);

              const powSafe = (val: Node<'float'>, ord: Node<'float'>) =>
                select(
                  ord.lessThanEqual(0.0),
                  float(1.0),
                  select(
                    abs(ord.sub(1.0)).lessThan(0.01),
                    val,
                    select(
                      abs(ord.sub(2.0)).lessThan(0.01),
                      val.mul(val),
                      pow(max(val, 1e-6), ord),
                    ),
                  ),
                );

              const fwdRate = kf
                .mul(powSafe(c0, fOrdA.x))
                .mul(powSafe(c1, fOrdA.y))
                .mul(powSafe(c2, fOrdA.z))
                .mul(powSafe(c3, fOrdA.w))
                .mul(powSafe(c4, fOrdB.x))
                .mul(powSafe(c5, fOrdB.y));

              const isRev = tpB.z.greaterThan(0.5).and(kinR.x.greaterThan(0.0));
              const expR = tslClamp(kinR.y.negate().div(Rconst.mul(safeT)), -70.0, 20.0);
              const kr = select(isRev, kinR.x.mul(exp(expR)).mul(gate), float(0.0));
              const revRate = kr
                .mul(powSafe(c0, rOrdA.x))
                .mul(powSafe(c1, rOrdA.y))
                .mul(powSafe(c2, rOrdA.z))
                .mul(powSafe(c3, rOrdA.w))
                .mul(powSafe(c4, rOrdB.x))
                .mul(powSafe(c5, rOrdB.y));

              const netRate = fwdRate.sub(revRate);
              dHRate.addAssign(netRate.mul(kinF.w));

              If(subIdx.equal(int(0)), () => {
                If(fwdRate.greaterThan(1e-12).and(revRate.greaterThan(1e-12)), () => {
                  const ratioSafe = tslClamp(fwdRate.div(max(revRate, 1e-12)), 1e-6, 1e6);
                  sigmaTotal.addAssign(Rconst.mul(netRate).mul(log(ratioSafe)));
                }).ElseIf(abs(netRate).greaterThan(1e-12), () => {
                  sigmaTotal.addAssign(Rconst.mul(abs(netRate)).mul(4.5));
                });
              });

              dc0.addAssign(stRowA.x.mul(netRate));
              dc1.addAssign(stRowA.y.mul(netRate));
              dc2.addAssign(stRowA.z.mul(netRate));
              dc3.addAssign(stRowA.w.mul(netRate));
              dc4.addAssign(stRowB.x.mul(netRate));
              dc5.addAssign(stRowB.y.mul(netRate));
            });
          });

          const scale = float(1.0).toVar('rxScale');
          const clampScale = (cCur: Node<'float'>, dCur: Node<'float'>) => {
            If(dCur.mul(subDt).add(cCur).lessThan(0.0).and(dCur.lessThan(-1e-12)), () => {
              scale.assign(min(scale, max(float(0.0), cCur.div(dCur.negate().mul(subDt)))));
            });
          };
          clampScale(c0, dc0);
          clampScale(c1, dc1);
          clampScale(c2, dc2);
          clampScale(c3, dc3);
          clampScale(c4, dc4);
          clampScale(c5, dc5);

          const effDt = subDt.mul(scale);
          c0.assign(max(float(0.0), c0.add(dc0.mul(effDt))));
          c1.assign(max(float(0.0), c1.add(dc1.mul(effDt))));
          c2.assign(max(float(0.0), c2.add(dc2.mul(effDt))));
          c3.assign(max(float(0.0), c3.add(dc3.mul(effDt))));
          c4.assign(max(float(0.0), c4.add(dc4.mul(effDt))));
          c5.assign(max(float(0.0), c5.add(dc5.mul(effDt))));
          eVal.assign(max(float(5000.0), eVal.sub(dHRate.mul(effDt))));
          const cpStep = kinCpB.z
            .add(c0.mul(kinCpA.x))
            .add(c1.mul(kinCpA.y))
            .add(c2.mul(kinCpA.z))
            .add(c3.mul(kinCpA.w))
            .add(c4.mul(kinCpB.x))
            .add(c5.mul(kinCpB.y));
          tempK.assign(tslClamp(eVal.div(max(float(200.0), cpStep)), float(40.0), float(4500.0)));
        });

        const ph = select(
          tempK.greaterThanEqual(3200.0),
          float(3.0),
          select(
            tempK.greaterThanEqual(647.0).and(press.greaterThanEqual(25.0)),
            float(4.0),
            select(
              vpL.w.lessThan(0.15).and(tempK.lessThan(1150.0)),
              float(0.0),
              select(tempK.lessThan(273.15), float(0.0), select(tempK.greaterThanEqual(373.15), float(2.0), float(1.0))),
            ),
          ),
        );

        const bioDriver = max(c1, c3);
        const nextMineral = max(float(0.0), prevDiag.z.add(max(float(0.0), bioDriver.sub(0.72)).mul(this.uDt)));
        statePingWrite.element(idx).assign(vec4(c0, c1, c2, eVal));
        state2PingWrite.element(idx).assign(vec4(c3, c4, c5, 0.0));
        auxPingWrite.element(idx).assign(vec4(auxP.x, auxP.y, auxP.z, tempK));
        diagWrite.element(idx).assign(vec4(ph, sigmaTotal, nextMineral, tempK.sub(300.0)));

        // Compact 80-byte atomic scalar telemetry reduction covering all 6 species
        const mReactKg = c0.mul(kinMA.x)
          .add(c1.mul(kinMA.y))
          .add(c2.mul(kinMA.z))
          .add(c3.mul(kinMA.w))
          .add(c4.mul(kinMB.x))
          .add(c5.mul(kinMB.y))
          .mul(volF);
        atomicAdd(reduceAtomic.element(uint(0)), uint(max(float(0.0), mReactKg.mul(this.uAtomicScale)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(6)), uint(max(float(0.0), c0.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(7)), uint(max(float(0.0), c1.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(8)), uint(max(float(0.0), c2.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(9)), uint(max(float(0.0), sigmaTotal.mul(volF).mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(10)), uint(1));
        atomicAdd(reduceAtomic.element(uint(11)), uint(max(float(0.0), tempK).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(12)), uint(max(float(0.0), c3.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(13)), uint(max(float(0.0), c4.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(14)), uint(max(float(0.0), c5.mul(100.0)).add(0.5)));

        const iz = idx.div(nSqU);
        const rem = idx.sub(iz.mul(nSqU));
        const iy = rem.div(nU);
        const ix = rem.sub(iy.mul(nU));
        const binStride = uint(Math.max(1, this.cellsPerAxis / 8));
        const halfStride = uint(Math.max(0, Math.floor(this.cellsPerAxis / 16)));
        const isRep = ix.mod(binStride).equal(halfStride)
          .and(iy.mod(binStride).equal(halfStride))
          .and(iz.mod(binStride).equal(halfStride));
        If(isRep, () => {
          const binStrideF = float(Math.max(1, this.cellsPerAxis / 8));
          const bx = uint(min(float(7.0), floor(float(ix).div(binStrideF))));
          const by = uint(min(float(7.0), floor(float(iy).div(binStrideF))));
          const bz = uint(min(float(7.0), floor(float(iz).div(binStrideF))));
          const bIdx = bx.add(by.mul(uint(8))).add(bz.mul(uint(64)));
          macroFeedbackWrite.element(bIdx).assign(vec4(tempK, bioDriver, nextMineral, sigmaTotal));
        });
      });
    })().compute(N, [64]).setName('MetabolismReactionPass');
  }

  public updateHypergraphKinetics(hypergraph: CompiledReactionHypergraph): void {
    this.numSpecies = Math.min(MAX_GPU_SPECIES, hypergraph.numSpecies);
    const arr = this.kineticsAttr.array as Float32Array;
    packHypergraphKineticsVec4(hypergraph, arr);
    this.kineticsAttr.needsUpdate = true;
  }

  public seedFromCoarsePlanet(
    coarseDensity: Float32Array,
    coarseMaterial: Uint8Array,
    coarseN: number,
    sunDir: readonly [number, number, number],
    ambientTempK: number,
    modeIdOrOpen: string | boolean,
    renderer: THREE.WebGPURenderer,
  ): void {
    const buf = this.coarsePlanetAttr.array as Float32Array;
    const count = Math.min(coarseN * coarseN * coarseN, buf.length / 2);
    for (let i = 0; i < count; i++) {
      buf[i * 2] = coarseDensity[i] ?? 0;
      buf[i * 2 + 1] = coarseMaterial[i] ?? 0;
    }
    this.coarsePlanetAttr.needsUpdate = true;
    this.uCoarseN.value = coarseN;
    this.uCoarseVoxelSize.value = (this.worldHalf * 2) / coarseN;
    this.uCoarseWorldHalf.value = this.worldHalf;
    this.uSunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
    this.uBaseTempK.value = ambientTempK;

    let modeCode = 1.0;
    let isOpen = true;
    if (typeof modeIdOrOpen === 'boolean') {
      modeCode = modeIdOrOpen ? 1.0 : 0.0;
      isOpen = modeIdOrOpen;
    } else if (modeIdOrOpen === 'closed_equilibrium') {
      modeCode = 0.0;
      isOpen = false;
    } else if (modeIdOrOpen === 'open_autocatalytic') {
      modeCode = 1.0;
    } else if (modeIdOrOpen === 'planetary_carbon_water') {
      modeCode = 2.0;
    } else if (modeIdOrOpen === 'cellular_metabolism') {
      modeCode = 3.0;
    } else if (modeIdOrOpen === 'planetary_hydrology') {
      modeCode = 4.0;
    }
    this.uSeedModeCode.value = modeCode;
    this.uBoundaryOpen.value = isOpen ? 1.0 : 0.0;

    renderer.compute(this.seedPlanetNode);
  }

  public dispatchStep(renderer: THREE.WebGPURenderer, params: GpuStepParams): void {
    this.uDt.value = Math.max(1e-4, Math.min(0.25, params.dtSec));
    this.uBoundaryOpen.value = params.boundaryMode === 'open' ? 1.0 : 0.0;
    this.uFeedRate.value = Math.max(0, params.feedRatePerSec);
    this.uExhaustRate.value = Math.max(0, params.exhaustRatePerSec);
    this.uFeedConc.value = Math.max(0, params.feedConcentrationMolM3);

    renderer.compute([this.resetReduceNode, this.fluxPassNode, this.reactPassNode]);
  }

  public scheduleAsyncReadback(renderer: THREE.WebGPURenderer): void {
    if (this.readbackInFlight) return;
    this.readbackInFlight = true;

    const fpScale = Number(this.uAtomicScale.value) || 1500.0;

    void Promise.all([
      renderer.getArrayBufferAsync(this.reduceAtomicAttr),
      renderer.getArrayBufferAsync(this.macroFeedbackAttr),
    ])
      .then(([reduceBuf, macroBuf]) => {
        const u = new Uint32Array(reduceBuf);
        const activeCount = Math.max(0, u[10] ?? 0);
        const denom = Math.max(1, activeCount);

        this.lastReadback = {
          totalMassPostReactKg: (u[0] ?? 0) / fpScale,
          totalMassPreKg: (u[2] ?? 0) / fpScale,
          totalMassPostFluxKg: (u[3] ?? 0) / fpScale,
          boundaryFeedMassKg: (u[4] ?? 0) / fpScale,
          boundaryExhaustMassKg: (u[5] ?? 0) / fpScale,
          meanConcentrations: [
            (u[6] ?? 0) / (100.0 * denom),
            (u[7] ?? 0) / (100.0 * denom),
            (u[8] ?? 0) / (100.0 * denom),
            (u[12] ?? 0) / (100.0 * denom),
            (u[13] ?? 0) / (100.0 * denom),
            (u[14] ?? 0) / (100.0 * denom),
          ].slice(0, this.numSpecies),
          totalEntropyProdRate: (u[9] ?? 0) / 100.0,
          meanTempK: activeCount > 0 ? (u[11] ?? 0) / activeCount : 300.0,
          activeCellCount: activeCount,
        };

        const mArr = new Float32Array(macroBuf);
        const bins: MacroFeedbackBin[] = [];
        const binSpan = (this.worldHalf * 2) / 8;
        for (let bz = 0; bz < 8; bz++) {
          for (let by = 0; by < 8; by++) {
            for (let bx = 0; bx < 8; bx++) {
              const bi = bx + by * 8 + bz * 64;
              const tempK = mArr[bi * 4 + 0] ?? 0;
              const xConc = mArr[bi * 4 + 1] ?? 0;
              const minAcc = mArr[bi * 4 + 2] ?? 0;
              const ent = mArr[bi * 4 + 3] ?? 0;
              if (tempK > 1) {
                bins.push({
                  binIndex: bi,
                  worldPos: [
                    -this.worldHalf + (bx + 0.5) * binSpan,
                    -this.worldHalf + (by + 0.5) * binSpan,
                    -this.worldHalf + (bz + 0.5) * binSpan,
                  ],
                  meanTempK: tempK,
                  meanAutocatalystX: xConc,
                  mineralAccum: minAcc,
                  entropyProdRate: ent,
                  activeCount: 1,
                });
              }
            }
          }
        }
        this.lastMacroBins = bins;
      })
      .catch(() => {
        // Ignored cleanly
      })
      .finally(() => {
        this.readbackInFlight = false;
      });
  }

  /**
   * Builds a zero-readback TSL color sampling node for Three.js WebGPU terrain shading
   * across all 6 chemical species slots.
   */
  public buildTerrainColorSampleFn(
    worldPosNode: Node<'vec3'>,
    channelNode: Node<'float'>,
  ): Node<'vec3'> {
    const nU = uint(this.cellsPerAxis);
    const nSqU = uint(this.cellsPerAxis * this.cellsPerAxis);
    const cMaxF = float(this.cellsPerAxis - 1);
    const worldHalfF = float(this.worldHalf);
    const invVoxel = float(1.0 / this.voxelSize);

    const gx = uint(tslClamp(floor(worldPosNode.x.add(worldHalfF).mul(invVoxel)), 0.0, cMaxF));
    const gy = uint(tslClamp(floor(worldPosNode.y.add(worldHalfF).mul(invVoxel)), 0.0, cMaxF));
    const gz = uint(tslClamp(floor(worldPosNode.z.add(worldHalfF).mul(invVoxel)), 0.0, cMaxF));
    const cellIdx = gx.add(gy.mul(nU)).add(gz.mul(nSqU));

    const st = this.statePingReadNode.element(cellIdx);
    const st2 = this.state2PingReadNode.element(cellIdx);
    const aux = this.auxPingReadNode.element(cellIdx);
    const velPor = this.velPorReadNode.element(cellIdx);
    const meta = this.metaReadNode.element(cellIdx);
    const diag = this.diagReadNode.element(cellIdx);

    const col0 = this.kineticsReadNode.element(uint(6)).xyz;
    const col1 = this.kineticsReadNode.element(uint(7)).xyz;
    const col2 = this.kineticsReadNode.element(uint(8)).xyz;
    const col3 = this.kineticsReadNode.element(uint(9)).xyz;
    const col4 = this.kineticsReadNode.element(uint(10)).xyz;
    const col5 = this.kineticsReadNode.element(uint(11)).xyz;

    const c0 = max(float(0.0), st.x);
    const c1 = max(float(0.0), st.y);
    const c2 = max(float(0.0), st.z);
    const c3 = max(float(0.0), st2.x);
    const c4 = max(float(0.0), st2.y);
    const c5 = max(float(0.0), st2.z);
    const sumC = c0.add(c1).add(c2).add(c3).add(c4).add(c5);
    const lumScale = tslClamp(sumC.div(2.4), 0.34, 1.15);
    const weightedCol = col0.mul(c0)
      .add(col1.mul(c1))
      .add(col2.mul(c2))
      .add(col3.mul(c3))
      .add(col4.mul(c4))
      .add(col5.mul(c5));

    const speciesRgb = select(
      sumC.greaterThan(1e-5),
      weightedCol.div(max(sumC, 1e-4)).mul(lumScale),
      vec3(0.14, 0.18, 0.25),
    );

    const tempC = aux.w.sub(273.15);
    let energyRgb = mix(color(0x2840b8), color(0x22d3ee), smoothstep(-40.0, 5.0, tempC));
    energyRgb = mix(energyRgb, color(0x34d399), smoothstep(5.0, 35.0, tempC));
    energyRgb = mix(energyRgb, color(0xfbbf24), smoothstep(35.0, 120.0, tempC));
    energyRgb = mix(energyRgb, color(0xef4444), smoothstep(120.0, 400.0, tempC));

    const ph = diag.x;
    const phRgb = select(
      ph.lessThan(0.5),
      vec3(0.36, 0.45, 0.58),
      select(
        ph.lessThan(1.5),
        vec3(0.08, 0.68, 0.92),
        select(ph.lessThan(2.5), vec3(0.95, 0.68, 0.22), vec3(0.88, 0.26, 0.78)),
      ),
    );

    const jMag = length(aux.xyz);
    const jNorm = tslClamp(jMag.mul(42.0), 0.0, 1.0);
    const fluxRgb = vec3(
      float(0.08).add(jNorm.mul(0.9)),
      float(0.18).add(sin(jNorm.mul(2.67)).mul(0.72)),
      float(0.45).add(float(1.0).sub(jNorm).mul(0.42)).sub(jNorm.mul(0.25)),
    );

    // Channel 4: Porosity & Mineral Skeleton (low porosity rock -> basalt/granite slate, high porosity -> teal/amber pores)
    const por = tslClamp(velPor.w, 0.0, 1.0);
    let mineralRgb = mix(color(0x334155), color(0xb45309), smoothstep(0.15, 0.42, por));
    mineralRgb = mix(mineralRgb, color(0x10b981), smoothstep(0.42, 0.72, por));
    mineralRgb = mix(mineralRgb, color(0x38bdf8), smoothstep(0.72, 1.0, por));

    // Channel 5: Local Entropy Production / Reaction Activity (sigma)
    const sigNorm = tslClamp(log(float(1.0).add(max(float(0.0), diag.y).mul(5.5))).div(2.4), 0.0, 1.0);
    let rateRgb = mix(color(0x0f172a), color(0x06b6d4), smoothstep(0.0, 0.35, sigNorm));
    rateRgb = mix(rateRgb, color(0x34d399), smoothstep(0.35, 0.7, sigNorm));
    rateRgb = mix(rateRgb, color(0xfbbf24), smoothstep(0.7, 1.0, sigNorm));

    const inactiveRgb = vec3(0.14, 0.18, 0.24);
    const rawRgb = select(
      channelNode.lessThan(0.5),
      speciesRgb,
      select(
        channelNode.lessThan(1.5),
        energyRgb,
        select(
          channelNode.lessThan(2.5),
          phRgb,
          select(
            channelNode.lessThan(3.5),
            fluxRgb,
            select(channelNode.lessThan(4.5), mineralRgb, rateRgb),
          ),
        ),
      ),
    );
    return select(meta.x.greaterThanEqual(0.5), tslClamp(rawRgb, 0.04, 1.0), inactiveRgb);
  }

  public syncLocalPorositySlice(
    centerCell: [number, number, number],
    radiusCells: number,
    cpuSampler: (ix: number, iy: number, iz: number) => { active: boolean; porosity: number },
  ): void {
    const n = this.cellsPerAxis;
    const r = Math.max(1, Math.ceil(radiusCells));
    const minX = Math.max(0, centerCell[0] - r);
    const maxX = Math.min(n - 1, centerCell[0] + r);
    const minY = Math.max(0, centerCell[1] - r);
    const maxY = Math.min(n - 1, centerCell[1] + r);
    const minZ = Math.max(0, centerCell[2] - r);
    const maxZ = Math.min(n - 1, centerCell[2] + r);

    const vpArr = this.velPorAttr.array as Float32Array;
    const metaArr = this.metaAttr.array as Float32Array;

    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let iy = minY; iy <= maxY; iy++) {
        for (let ix = minX; ix <= maxX; ix++) {
          const idx = ix + iy * n + iz * n * n;
          const res = cpuSampler(ix, iy, iz);
          metaArr[idx * 4] = res.active ? 1.0 : 0.0;
          vpArr[idx * 4 + 3] = res.porosity;
        }
      }
    }
    this.velPorAttr.needsUpdate = true;
    this.metaAttr.needsUpdate = true;
  }

  public injectGpuPerturbation(
    wx: number,
    wy: number,
    wz: number,
    speciesIndex: number,
    amountMolM3: number,
    radiusM: number,
  ): number {
    const n = this.cellsPerAxis;
    const radSq = radiusM * radiusM;
    const minX = Math.max(0, Math.floor((wx - radiusM + this.worldHalf) / this.voxelSize));
    const maxX = Math.min(n - 1, Math.floor((wx + radiusM + this.worldHalf) / this.voxelSize));
    const minY = Math.max(0, Math.floor((wy - radiusM + this.worldHalf) / this.voxelSize));
    const maxY = Math.min(n - 1, Math.floor((wy + radiusM + this.worldHalf) / this.voxelSize));
    const minZ = Math.max(0, Math.floor((wz - radiusM + this.worldHalf) / this.voxelSize));
    const maxZ = Math.min(n - 1, Math.floor((wz + radiusM + this.worldHalf) / this.voxelSize));

    const sSlot = Math.max(0, Math.min(MAX_GPU_SPECIES - 1, Math.floor(speciesIndex)));
    const useSecond = sSlot >= 3;
    const st = (useSecond ? this.state2PingAttr.array : this.statePingAttr.array) as Float32Array;
    const meta = this.metaAttr.array as Float32Array;
    const vecComp = useSecond ? sSlot - 3 : sSlot;
    let touched = 0;

    for (let iz = minZ; iz <= maxZ; iz++) {
      const cz = -this.worldHalf + (iz + 0.5) * this.voxelSize;
      for (let iy = minY; iy <= maxY; iy++) {
        const cy = -this.worldHalf + (iy + 0.5) * this.voxelSize;
        for (let ix = minX; ix <= maxX; ix++) {
          const idx = ix + iy * n + iz * n * n;
          if (meta[idx * 4] < 0.5) continue;
          const cx = -this.worldHalf + (ix + 0.5) * this.voxelSize;
          const dSq = (cx - wx) ** 2 + (cy - wy) ** 2 + (cz - wz) ** 2;
          if (dSq <= radSq) {
            const w = 1 - Math.sqrt(dSq) / radiusM;
            st[idx * 4 + vecComp] += amountMolM3 * w;
            touched++;
          }
        }
      }
    }
    if (touched > 0) {
      if (useSecond) this.state2PingAttr.needsUpdate = true;
      else this.statePingAttr.needsUpdate = true;
    }
    return touched;
  }

  public readGpuTelemetry(
    prevStep: number,
    simTimeSec: number,
    boundaryMode: 'closed' | 'open',
    prevTelemetry: FvmStepTelemetry,
  ): FvmStepTelemetry {
    const rb = this.lastReadback;
    if (!rb) return prevTelemetry;
    const netB = rb.boundaryFeedMassKg - rb.boundaryExhaustMassKg;
    const residual = rb.totalMassPostReactKg - (rb.totalMassPreKg + netB);
    const scaleRef = Math.max(1e-6, rb.totalMassPreKg, rb.totalMassPostReactKg, Math.abs(netB));
    const relErr = Math.abs(residual) / scaleRef;

    const S = this.numSpecies;
    const totalSpeciesMoles = new Float64Array(S);
    const meanConcentrations = new Float64Array(S);
    const volTot = rb.activeCellCount * this.cellVolumeM3;
    for (let s = 0; s < S; s++) {
      meanConcentrations[s] = rb.meanConcentrations[s] ?? 0;
      totalSpeciesMoles[s] = meanConcentrations[s] * volTot;
    }

    return {
      stepIndex: prevStep,
      simTimeSec,
      boundaryMode,
      activeCellCount: rb.activeCellCount,
      totalSpeciesMoles,
      meanConcentrations,
      speciesSpatialStdDev: prevTelemetry.speciesSpatialStdDev,
      totalInternalEnergyJ: rb.meanTempK * 1900 * volTot,
      meanTempK: rb.meanTempK,
      totalEntropyProdRate: rb.totalEntropyProdRate,
      phaseCounts: {
        ...prevTelemetry.phaseCounts,
        [MatterPhase.Liquid]: rb.activeCellCount,
      },
      meanFluxMagnitude: prevTelemetry.meanFluxMagnitude,
      meanReactionRates: prevTelemetry.meanReactionRates,
      conservation: {
        stepIndex: prevStep,
        simTimeSec,
        totalMassPreKg: rb.totalMassPreKg,
        boundaryFeedMassKg: rb.boundaryFeedMassKg,
        boundaryExhaustMassKg: rb.boundaryExhaustMassKg,
        boundaryNetMassKg: netB,
        totalMassPostFluxKg: rb.totalMassPostFluxKg,
        totalMassPostReactKg: rb.totalMassPostReactKg,
        fluxMassResidualKg: rb.totalMassPostFluxKg - (rb.totalMassPreKg + netB),
        reactionMassResidualKg: rb.totalMassPostReactKg - rb.totalMassPostFluxKg,
        totalMassBalanceResidualKg: residual,
        relativeError: relErr,
        conserved: relErr < 5e-3,
      },
    };
  }
}
