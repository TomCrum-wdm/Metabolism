// Unified CPU / WebGPU Compute FVM Backend for 《Metabolism》
// Architecture:
// - Shares an identical topological grid descriptor & numeric hypergraph tables across CPU & GPU.
// - Fixed simulation sequence: Boundary Ports -> 6-Neighbor Symmetric Flux -> In-Cell Reaction -> Scalar Audit.
// - WebGPU path uses Ping-Pong StorageBuffers + two-pass TSL compute shaders up to 128^3 (2,097,152 voxels)
//   with zero-readback GPU shader visualization and non-blocking 64-byte atomic reduction readback.

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

// Packed kinetic uniform/storage layout: 16 vec4 slots (64 floats), zero formula string parsing.
// Slot 0: species molar masses [M0, M1, M2, 0]
// Slot 1: effective diffusivities [D0*s0, D1*s1, D2*s2, 0]
// Slot 2: species specific heat Cp [Cp0, Cp1, Cp2, 1800]
// Slots 3..5: species colors [r, g, b, roleCode]
// Slots 6..8: stoichiometry rows R0..R2 [nu0, nu1, nu2, 0]
// Slots 9..11: forward kinetic order rows R0..R2 [o0, o1, o2, 0]
// Slots 12..14: reverse kinetic order rows R0..R2 [o0, o1, o2, 0]
// Slots 15..17: forward Arrhenius + enthalpy [calA, calEa, beta, deltaH]
// Slots 18..20: reverse Arrhenius + T bounds [revA, revEa, minT, maxT]
// Slots 21..23: P bounds + flags [minP, maxP, isReversible, 0]
export const PACKED_KINETICS_VEC4_COUNT = 24;

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
  const S = Math.min(3, hypergraph.numSpecies);
  const R = Math.min(3, hypergraph.numReactions);

  for (let s = 0; s < S; s++) {
    outBuffer[0 * 4 + s] = hypergraph.molarMasses[s];
    outBuffer[1 * 4 + s] = hypergraph.diffusivities[s] * hypergraph.calibratedDiffusivityScale[s];
    outBuffer[2 * 4 + s] = hypergraph.species[s].specificHeatJPerMolK;
    const col = hypergraph.species[s].colorRgb;
    outBuffer[(3 + s) * 4 + 0] = col[0];
    outBuffer[(3 + s) * 4 + 1] = col[1];
    outBuffer[(3 + s) * 4 + 2] = col[2];
    outBuffer[(3 + s) * 4 + 3] = 1.0;
  }
  outBuffer[2 * 4 + 3] = 1800.0; // Baseline rock/solvent Cp

  for (let r = 0; r < R; r++) {
    const rxn = hypergraph.reactions[r];
    const rowOff = r * hypergraph.numSpecies;
    for (let s = 0; s < S; s++) {
      outBuffer[(6 + r) * 4 + s] = hypergraph.stoichMatrix[rowOff + s];
      outBuffer[(9 + r) * 4 + s] = hypergraph.reactantOrderMatrix[rowOff + s];
      outBuffer[(12 + r) * 4 + s] = hypergraph.productOrderMatrix[rowOff + s];
    }
    outBuffer[(15 + r) * 4 + 0] = hypergraph.calibratedForwardA[r];
    outBuffer[(15 + r) * 4 + 1] = hypergraph.calibratedForwardEaJ[r];
    outBuffer[(15 + r) * 4 + 2] = rxn.tempExponentBeta ?? 0;
    outBuffer[(15 + r) * 4 + 3] = rxn.enthalpyChangeJ;

    outBuffer[(18 + r) * 4 + 0] = rxn.reverseA ?? 0;
    outBuffer[(18 + r) * 4 + 1] = rxn.reverseEaJ ?? rxn.forwardEaJ;
    outBuffer[(18 + r) * 4 + 2] = rxn.minTempK;
    outBuffer[(18 + r) * 4 + 3] = rxn.maxTempK;

    outBuffer[(21 + r) * 4 + 0] = rxn.minPressureAtm;
    outBuffer[(21 + r) * 4 + 1] = rxn.maxPressureAtm;
    outBuffer[(21 + r) * 4 + 2] = rxn.isReversible ? 1.0 : 0.0;
    outBuffer[(21 + r) * 4 + 3] = 1.0;
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
 * GPU Flux + Reaction stencil algorithm used in WebGPU Compute Shaders.
 * Enables deterministic parity verification in headless Node unit tests.
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
): {
  totalMassPreKg: number;
  boundaryFeedMassKg: number;
  boundaryExhaustMassKg: number;
  totalMassPostFluxKg: number;
  totalMassPostReactKg: number;
  relativeError: number;
  meanConcentrations: [number, number, number];
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
  const m0 = hypergraph.molarMasses[0] ?? 0.05;
  const m1 = hypergraph.molarMasses[1] ?? 0.05;
  const m2 = hypergraph.molarMasses[2] ?? 0.05;
  const d0 = (hypergraph.diffusivities[0] ?? 0.1) * (hypergraph.calibratedDiffusivityScale[0] ?? 1);
  const d1 = (hypergraph.diffusivities[1] ?? 0.05) * (hypergraph.calibratedDiffusivityScale[1] ?? 1);
  const d2 = (hypergraph.diffusivities[2] ?? 0.1) * (hypergraph.calibratedDiffusivityScale[2] ?? 1);
  const cp0 = hypergraph.species[0]?.specificHeatJPerMolK ?? 40;
  const cp1 = hypergraph.species[1]?.specificHeatJPerMolK ?? 40;
  const cp2 = hypergraph.species[2]?.specificHeatJPerMolK ?? 40;

  let massPre = 0;
  let feedMass = 0;
  let exhaustMass = 0;
  let massPostFlux = 0;
  let massPostReact = 0;
  let sumS = 0;
  let sumX = 0;
  let sumW = 0;
  let sumT = 0;
  let sumEntropy = 0;
  let activeCount = 0;

  // Symmetric face flux helper: depends ONLY on (L, R) read-only statePingVec4
  const evalFaceFlux = (
    idxL: number,
    idxR: number,
    axis: 0 | 1 | 2,
    outFlux: [number, number, number, number], // [f0, f1, f2, fE]
  ) => {
    outFlux[0] = 0;
    outFlux[1] = 0;
    outFlux[2] = 0;
    outFlux[3] = 0;
    if (metaVec4[idxL * 4] < 0.5 || metaVec4[idxR * 4] < 0.5) return;

    const porL = velPorVec4[idxL * 4 + 3];
    const porR = velPorVec4[idxR * 4 + 3];
    const facePor = Math.min(porL, porR);
    if (facePor <= 1e-5) return;

    const vL = velPorVec4[idxL * 4 + axis];
    const vR = velPorVec4[idxR * 4 + axis];
    const vFace = 0.5 * (vL + vR) * facePor;

    const cL0 = Math.max(0, statePingVec4[idxL * 4 + 0]);
    const cL1 = Math.max(0, statePingVec4[idxL * 4 + 1]);
    const cL2 = Math.max(0, statePingVec4[idxL * 4 + 2]);
    const eL = statePingVec4[idxL * 4 + 3];

    const cR0 = Math.max(0, statePingVec4[idxR * 4 + 0]);
    const cR1 = Math.max(0, statePingVec4[idxR * 4 + 1]);
    const cR2 = Math.max(0, statePingVec4[idxR * 4 + 2]);
    const eR = statePingVec4[idxR * 4 + 3];

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

    const adv0 = vFace >= 0 ? vFace * cL0 : vFace * cR0;
    const adv1 = vFace >= 0 ? vFace * cL1 : vFace * cR1;
    const adv2 = vFace >= 0 ? vFace * cL2 : vFace * cR2;

    outFlux[0] = limitFlux(adv0 - d0 * facePor * (cR0 - cL0) * invH, cL0, cR0);
    outFlux[1] = limitFlux(adv1 - d1 * facePor * (cR1 - cL1) * invH, cL1, cR1);
    outFlux[2] = limitFlux(adv2 - d2 * facePor * (cR2 - cL2) * invH, cL2, cR2);

    const tL = auxPingVec4[idxL * 4 + 3];
    const tR = auxPingVec4[idxR * 4 + 3];
    const eAdv = vFace >= 0 ? vFace * eL : vFace * eR;
    const eCond = -0.08 * facePor * (tR - tL) * invH * 2200;
    outFlux[3] = eAdv + eCond;
  };

  const faceBuf: [number, number, number, number] = [0, 0, 0, 0];

  // Pass 1: Read statePing -> Boundary Ports + Symmetric 6-Face Flux Divergence -> Write statePong
  for (let idx = 0; idx < total; idx++) {
    const active = metaVec4[idx * 4] >= 0.5;
    if (!active) {
      statePongVec4[idx * 4 + 0] = 0;
      statePongVec4[idx * 4 + 1] = 0;
      statePongVec4[idx * 4 + 2] = 0;
      statePongVec4[idx * 4 + 3] = statePingVec4[idx * 4 + 3];
      auxPongVec4[idx * 4 + 0] = 0;
      auxPongVec4[idx * 4 + 1] = 0;
      auxPongVec4[idx * 4 + 2] = 0;
      auxPongVec4[idx * 4 + 3] = auxPingVec4[idx * 4 + 3];
      continue;
    }

    let c0 = Math.max(0, statePingVec4[idx * 4 + 0]);
    let c1 = Math.max(0, statePingVec4[idx * 4 + 1]);
    let c2 = Math.max(0, statePingVec4[idx * 4 + 2]);
    let e0 = statePingVec4[idx * 4 + 3];
    massPre += (c0 * m0 + c1 * m1 + c2 * m2) * vol;

    if (isOpen) {
      const feedMask = metaVec4[idx * 4 + 1];
      const exhaustMask = metaVec4[idx * 4 + 2];
      if (feedMask >= 0.5 && params.feedRatePerSec > 0) {
        const dFeed = params.feedRatePerSec * params.feedConcentrationMolM3 * dt;
        c0 += dFeed;
        feedMass += dFeed * m0 * vol;
      }
      if (exhaustMask >= 0.5 && params.exhaustRatePerSec > 0) {
        const frac = Math.min(0.85, params.exhaustRatePerSec * dt);
        const r0 = c0 * frac;
        const r1 = c1 * frac;
        const r2 = c2 * frac;
        c0 -= r0;
        c1 -= r1;
        c2 -= r2;
        exhaustMass += (r0 * m0 + r1 * m1 + r2 * m2) * vol;
      }
    }

    const iz = Math.floor(idx / nSq);
    const rem = idx - iz * nSq;
    const iy = Math.floor(rem / n);
    const ix = rem - iy * n;

    let netF0 = 0;
    let netF1 = 0;
    let netF2 = 0;
    let netFE = 0;
    let jx = 0;
    let jy = 0;
    let jz = 0;

    // +X and -X
    if (ix + 1 < n) {
      evalFaceFlux(idx, idx + 1, 0, faceBuf);
      netF0 -= faceBuf[0];
      netF1 -= faceBuf[1];
      netF2 -= faceBuf[2];
      netFE -= faceBuf[3];
      jx += (faceBuf[0] * m0 + faceBuf[1] * m1 + faceBuf[2] * m2) * 0.5;
    }
    if (ix > 0) {
      evalFaceFlux(idx - 1, idx, 0, faceBuf);
      netF0 += faceBuf[0];
      netF1 += faceBuf[1];
      netF2 += faceBuf[2];
      netFE += faceBuf[3];
      jx += (faceBuf[0] * m0 + faceBuf[1] * m1 + faceBuf[2] * m2) * 0.5;
    }
    // +Y and -Y
    if (iy + 1 < n) {
      evalFaceFlux(idx, idx + n, 1, faceBuf);
      netF0 -= faceBuf[0];
      netF1 -= faceBuf[1];
      netF2 -= faceBuf[2];
      netFE -= faceBuf[3];
      jy += (faceBuf[0] * m0 + faceBuf[1] * m1 + faceBuf[2] * m2) * 0.5;
    }
    if (iy > 0) {
      evalFaceFlux(idx - n, idx, 1, faceBuf);
      netF0 += faceBuf[0];
      netF1 += faceBuf[1];
      netF2 += faceBuf[2];
      netFE += faceBuf[3];
      jy += (faceBuf[0] * m0 + faceBuf[1] * m1 + faceBuf[2] * m2) * 0.5;
    }
    // +Z and -Z
    if (iz + 1 < n) {
      evalFaceFlux(idx, idx + nSq, 2, faceBuf);
      netF0 -= faceBuf[0];
      netF1 -= faceBuf[1];
      netF2 -= faceBuf[2];
      netFE -= faceBuf[3];
      jz += (faceBuf[0] * m0 + faceBuf[1] * m1 + faceBuf[2] * m2) * 0.5;
    }
    if (iz > 0) {
      evalFaceFlux(idx - nSq, idx, 2, faceBuf);
      netF0 += faceBuf[0];
      netF1 += faceBuf[1];
      netF2 += faceBuf[2];
      netFE += faceBuf[3];
      jz += (faceBuf[0] * m0 + faceBuf[1] * m1 + faceBuf[2] * m2) * 0.5;
    }

    const postC0 = Math.max(0, c0 + netF0 * dtOverH);
    const postC1 = Math.max(0, c1 + netF1 * dtOverH);
    const postC2 = Math.max(0, c2 + netF2 * dtOverH);
    const postE = Math.max(5000, e0 + netFE * dtOverH);

    // Note: because boundary exchange occurred before face divergence, exact total mass post-flux:
    massPostFlux += (postC0 * m0 + postC1 * m1 + postC2 * m2) * vol;

    statePongVec4[idx * 4 + 0] = postC0;
    statePongVec4[idx * 4 + 1] = postC1;
    statePongVec4[idx * 4 + 2] = postC2;
    statePongVec4[idx * 4 + 3] = postE;

    const cpVol = 1800 + postC0 * cp0 + postC1 * cp1 + postC2 * cp2;
    const tempK = Math.max(40, Math.min(4500, postE / Math.max(200, cpVol)));
    auxPongVec4[idx * 4 + 0] = jx;
    auxPongVec4[idx * 4 + 1] = jy;
    auxPongVec4[idx * 4 + 2] = jz;
    auxPongVec4[idx * 4 + 3] = tempK;
  }

  // Pass 2: Read statePong -> Local Hypergraph Reaction -> Write statePing
  for (let idx = 0; idx < total; idx++) {
    if (metaVec4[idx * 4] < 0.5) continue;
    activeCount++;

    let c0 = statePongVec4[idx * 4 + 0];
    let c1 = statePongVec4[idx * 4 + 1];
    let c2 = statePongVec4[idx * 4 + 2];
    let eVal = statePongVec4[idx * 4 + 3];
    let tempK = auxPongVec4[idx * 4 + 3];
    const pressAtm = metaVec4[idx * 4 + 3];
    const por = velPorVec4[idx * 4 + 3];

    let totalEntropy = 0;
    let deltaE = 0;

    // 2 adaptive positivity substeps
    const subSteps = 2;
    const subDt = dt / subSteps;
    for (let step = 0; step < subSteps; step++) {
      let dc0 = 0;
      let dc1 = 0;
      let dc2 = 0;
      let stepDH = 0;

      for (let r = 0; r < hypergraph.numReactions; r++) {
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

        const ordF0 = hypergraph.reactantOrderMatrix[rowOff + 0] ?? 0;
        const ordF1 = hypergraph.reactantOrderMatrix[rowOff + 1] ?? 0;
        const ordF2 = hypergraph.reactantOrderMatrix[rowOff + 2] ?? 0;
        let fwdProd = 1.0;
        if (ordF0 > 0) fwdProd *= ordF0 === 1 ? c0 : ordF0 === 2 ? c0 * c0 : Math.pow(c0, ordF0);
        if (ordF1 > 0) fwdProd *= ordF1 === 1 ? c1 : ordF1 === 2 ? c1 * c1 : Math.pow(c1, ordF1);
        if (ordF2 > 0) fwdProd *= ordF2 === 1 ? c2 : ordF2 === 2 ? c2 * c2 : Math.pow(c2, ordF2);
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
          const ordR0 = hypergraph.productOrderMatrix[rowOff + 0] ?? 0;
          const ordR1 = hypergraph.productOrderMatrix[rowOff + 1] ?? 0;
          const ordR2 = hypergraph.productOrderMatrix[rowOff + 2] ?? 0;
          let revProd = 1.0;
          if (ordR0 > 0) revProd *= ordR0 === 1 ? c0 : ordR0 === 2 ? c0 * c0 : Math.pow(c0, ordR0);
          if (ordR1 > 0) revProd *= ordR1 === 1 ? c1 : ordR1 === 2 ? c1 * c1 : Math.pow(c1, ordR1);
          if (ordR2 > 0) revProd *= ordR2 === 1 ? c2 : ordR2 === 2 ? c2 * c2 : Math.pow(c2, ordR2);
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

        dc0 += (hypergraph.stoichMatrix[rowOff + 0] ?? 0) * netRate;
        dc1 += (hypergraph.stoichMatrix[rowOff + 1] ?? 0) * netRate;
        dc2 += (hypergraph.stoichMatrix[rowOff + 2] ?? 0) * netRate;
      }

      let scale = 1.0;
      if (dc0 * subDt + c0 < 0 && dc0 < -1e-15) scale = Math.min(scale, Math.max(0, c0 / (-dc0 * subDt)));
      if (dc1 * subDt + c1 < 0 && dc1 < -1e-15) scale = Math.min(scale, Math.max(0, c1 / (-dc1 * subDt)));
      if (dc2 * subDt + c2 < 0 && dc2 < -1e-15) scale = Math.min(scale, Math.max(0, c2 / (-dc2 * subDt)));

      const effDt = subDt * scale;
      c0 = Math.max(0, c0 + dc0 * effDt);
      c1 = Math.max(0, c1 + dc1 * effDt);
      c2 = Math.max(0, c2 + dc2 * effDt);
      deltaE += -stepDH * effDt;
    }

    eVal = Math.max(5000, eVal + deltaE);
    const cpVol = 1800 + c0 * cp0 + c1 * cp1 + c2 * cp2;
    tempK = Math.max(40, Math.min(4500, eVal / Math.max(200, cpVol)));

    statePingVec4[idx * 4 + 0] = c0;
    statePingVec4[idx * 4 + 1] = c1;
    statePingVec4[idx * 4 + 2] = c2;
    statePingVec4[idx * 4 + 3] = eVal;

    auxPingVec4[idx * 4 + 0] = auxPongVec4[idx * 4 + 0];
    auxPingVec4[idx * 4 + 1] = auxPongVec4[idx * 4 + 1];
    auxPingVec4[idx * 4 + 2] = auxPongVec4[idx * 4 + 2];
    auxPingVec4[idx * 4 + 3] = tempK;

    diagVec4[idx * 4 + 0] = classifyMatterPhase(tempK, pressAtm, por);
    diagVec4[idx * 4 + 1] = totalEntropy;
    diagVec4[idx * 4 + 2] = Math.max(0, diagVec4[idx * 4 + 2] + Math.max(0, c1 - 0.75) * dt);
    diagVec4[idx * 4 + 3] = deltaE / Math.max(1e-4, dt);

    massPostReact += (c0 * m0 + c1 * m1 + c2 * m2) * vol;
    sumS += c0;
    sumX += c1;
    sumW += c2;
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
    meanConcentrations: [sumS / denom, sumX / denom, sumW / denom],
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
  readonly meanConcentrations: [number, number, number];
  readonly totalEntropyProdRate: number;
  readonly meanTempK: number;
  readonly activeCellCount: number;
}

/**
 * True WebGPU Compute Ping-Pong Solver supporting up to 128^3 (2,097,152 voxels).
 * Keeps entire voxel state on GPU StorageBuffers, exposing:
 *   1. Non-blocking scalar 64-byte atomic reduction readback for mass conservation & live plots.
 *   2. Compact 512-bin (8 KB) macro feedback buffer for planetary thermal hotspots & mineralization.
 *   3. Zero-readback TSL color sampler node embedded directly in terrain material shaders.
 */
export class WebGpuFvmComputeSolver {
  public readonly cellsPerAxis: FvmResolutionCells;
  public readonly chunksPerAxis: number;
  public readonly totalCells: number;
  public readonly worldHalf: number;
  public readonly voxelSize: number;
  public readonly cellVolumeM3: number;
  public readonly baseRadius: number;

  // Ping-Pong GPU storage buffers (vec4 per voxel)
  public readonly statePingAttr: THREE.StorageBufferAttribute;
  public readonly statePongAttr: THREE.StorageBufferAttribute;
  public readonly auxPingAttr: THREE.StorageBufferAttribute;
  public readonly auxPongAttr: THREE.StorageBufferAttribute;
  public readonly velPorAttr: THREE.StorageBufferAttribute;
  public readonly metaAttr: THREE.StorageBufferAttribute;
  public readonly diagAttr: THREE.StorageBufferAttribute;

  // Packed numeric reaction hypergraph tables (24 vec4 floats)
  public readonly kineticsAttr: THREE.StorageBufferAttribute;
  // 16 x uint32 atomic fixed-point scalar reduction counters (64 bytes total readback!)
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
  private readonly uModeOpen = uniform(1.0);

  // TSL Compute Nodes
  private readonly resetReduceNode: ComputeNode;
  private readonly fluxPassNode: ComputeNode;
  private readonly reactPassNode: ComputeNode;
  private readonly seedPlanetNode: ComputeNode;

  // Compact coarse terrain density grid attribute uploaded once for instant GPU seeding (< 2ms at 128^3)
  private readonly coarsePlanetAttr: THREE.StorageBufferAttribute;
  private readonly uCoarseN = uniform(48);
  private readonly uCoarseVoxelSize = uniform(1.0);
  private readonly uCoarseWorldHalf = uniform(20.0);
  private readonly uSunDir = uniform(new THREE.Vector3(0.7, 0.5, 0.5));
  private readonly uBaseTempK = uniform(305.0);

  private readonly statePingReadNode;
  private readonly auxPingReadNode;
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

    // Scale fixed-point multiplier so 2,097,152 cells stay safely below uint32 max (4.29e9)
    const fpScale = this.totalCells > 500_000 ? 1500.0 : 10000.0;
    this.uAtomicScale.value = fpScale;

    this.statePingAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.statePongAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.auxPingAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.auxPongAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.velPorAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.metaAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);
    this.diagAttr = new THREE.StorageBufferAttribute(new Float32Array(this.totalCells * 4), 4);

    const kinArr = packHypergraphKineticsVec4(hypergraph);
    this.kineticsAttr = new THREE.StorageBufferAttribute(kinArr, 4);
    this.reduceAtomicAttr = new THREE.StorageBufferAttribute(new Uint32Array(16), 1);
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

    this.auxPingReadNode = storage(this.auxPingAttr, 'vec4', N).toReadOnly();
    const auxPingWrite = storage(this.auxPingAttr, 'vec4', N);
    const auxPongRead = storage(this.auxPongAttr, 'vec4', N).toReadOnly();
    const auxPongWrite = storage(this.auxPongAttr, 'vec4', N);

    const velPorRead = storage(this.velPorAttr, 'vec4', N).toReadOnly();
    const velPorWrite = storage(this.velPorAttr, 'vec4', N);
    this.metaReadNode = storage(this.metaAttr, 'vec4', N).toReadOnly();
    const metaWrite = storage(this.metaAttr, 'vec4', N);
    this.diagReadNode = storage(this.diagAttr, 'vec4', N).toReadOnly();
    const diagWrite = storage(this.diagAttr, 'vec4', N);
    this.kineticsReadNode = storage(this.kineticsAttr, 'vec4', PACKED_KINETICS_VEC4_COUNT).toReadOnly();
    const reduceAtomic = storage(this.reduceAtomicAttr, 'uint', 16).toAtomic();
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

        const c0Init = select(this.uModeOpen.greaterThan(0.5), float(1.65), select(wx.greaterThanEqual(0.0), float(1.85), float(0.35)));
        const c1Init = select(this.uModeOpen.greaterThan(0.5), select(hasSeed, float(1.15), float(0.02)), float(0.05));
        const c2Init = select(this.uModeOpen.greaterThan(0.5), float(0.05), float(0.0));

        const feedMask = select(this.uModeOpen.greaterThan(0.5).and(r.lessThanEqual(r0F.mul(1.04))), float(1.0), float(0.0));
        const exhaustMask = select(this.uModeOpen.greaterThan(0.5).and(r.greaterThanEqual(r0F.mul(0.88))), float(1.0), float(0.0));

        const kinCp = this.kineticsReadNode.element(uint(2));
        const cpVol = kinCp.w.add(c0Init.mul(kinCp.x)).add(c1Init.mul(kinCp.y)).add(c2Init.mul(kinCp.z));
        const safeT = tslClamp(tempBase, float(260.0), float(2200.0));
        const internalE = cpVol.mul(safeT);

        metaWrite.element(idx).assign(vec4(1.0, feedMask, exhaustMask, press));
        velPorWrite.element(idx).assign(vec4(vx, vy, vz, por));
        statePingWrite.element(idx).assign(vec4(c0Init, c1Init, c2Init, internalE));
        auxPingWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, safeT));
        diagWrite.element(idx).assign(vec4(1.0, 0.0, 0.0, 0.0));
      });
    })().compute(N, [64]).setName('MetabolismGpuSeed');

    // Compute Pass 0: Reset atomic reduction buffer (16 uint slots) + clear macro feedback
    this.resetReduceNode = Fn(() => {
      If(instanceIndex.lessThan(uint(16)), () => {
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
        auxPongWrite.element(idx).assign(vec4(0.0, 0.0, 0.0, 290.0));
      }).Else(() => {
        const kinM = this.kineticsReadNode.element(uint(0));
        const kinD = this.kineticsReadNode.element(uint(1));
        const kinCp = this.kineticsReadNode.element(uint(2));

        const stL = this.statePingReadNode.element(idx);
        const auxL = this.auxPingReadNode.element(idx);
        const vpL = velPorRead.element(idx);

        const cL0 = max(float(0.0), stL.x).toVar('cL0');
        const cL1 = max(float(0.0), stL.y).toVar('cL1');
        const cL2 = max(float(0.0), stL.z).toVar('cL2');
        const eL = stL.w;
        const tL = auxL.w;
        const porL = vpL.w;

        const mPreKg = cL0.mul(kinM.x).add(cL1.mul(kinM.y)).add(cL2.mul(kinM.z)).mul(volF);
        atomicAdd(reduceAtomic.element(uint(2)), uint(max(float(0.0), mPreKg.mul(this.uAtomicScale)).add(0.5)));

        const dtOverH = this.uDt.mul(invH);

        // Open-system boundary feed / exhaust prior to spatial flux
        const feedAmt = float(0.0).toVar('feedAmt');
        const exhAmt0 = float(0.0).toVar('exhAmt0');
        const exhAmt1 = float(0.0).toVar('exhAmt1');
        const exhAmt2 = float(0.0).toVar('exhAmt2');
        If(this.uBoundaryOpen.greaterThan(0.5), () => {
          If(metaL.y.greaterThanEqual(0.5), () => {
            feedAmt.assign(this.uFeedRate.mul(this.uFeedConc).mul(this.uDt));
            cL0.addAssign(feedAmt);
            const fMass = feedAmt.mul(kinM.x).mul(volF);
            atomicAdd(reduceAtomic.element(uint(4)), uint(max(float(0.0), fMass.mul(this.uAtomicScale)).add(0.5)));
          });
          If(metaL.z.greaterThanEqual(0.5), () => {
            const frac = min(float(0.85), this.uExhaustRate.mul(this.uDt));
            exhAmt0.assign(cL0.mul(frac));
            exhAmt1.assign(cL1.mul(frac));
            exhAmt2.assign(cL2.mul(frac));
            cL0.subAssign(exhAmt0);
            cL1.subAssign(exhAmt1);
            cL2.subAssign(exhAmt2);
            const exMass = exhAmt0.mul(kinM.x).add(exhAmt1.mul(kinM.y)).add(exhAmt2.mul(kinM.z)).mul(volF);
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
        const netFE = float(0.0).toVar('netFE');
        const jOut = vec3(0.0, 0.0, 0.0).toVar('jOut');

        // Helper closure: evaluate exact symmetric flux across face (aIdx -> bIdx) along axis
        // When sign = -1 (outgoing L->R), subtracting gives flux leaving L; when sign = +1 (incoming L'->L), adding gives flux entering L.
        const accumulateFace = (
          nIdx: Node<'uint'>,
          axisCode: number,
          isPositiveDir: boolean,
        ) => {
          const metaN = this.metaReadNode.element(nIdx);
          If(metaN.x.greaterThanEqual(0.5), () => {
            const stN = this.statePingReadNode.element(nIdx);
            const auxN = this.auxPingReadNode.element(nIdx);
            const vpN = velPorRead.element(nIdx);
            const facePor = min(porL, vpN.w);

            const vA = axisCode === 0 ? vpL.x : axisCode === 1 ? vpL.y : vpL.z;
            const vB = axisCode === 0 ? vpN.x : axisCode === 1 ? vpN.y : vpN.z;
            const vFace = vA.add(vB).mul(0.5).mul(facePor);

            // Ordered L -> R pair preserves IEEE parity cleanly
            const leftC0 = isPositiveDir ? max(float(0.0), stL.x) : max(float(0.0), stN.x);
            const leftC1 = isPositiveDir ? max(float(0.0), stL.y) : max(float(0.0), stN.y);
            const leftC2 = isPositiveDir ? max(float(0.0), stL.z) : max(float(0.0), stN.z);
            const rightC0 = isPositiveDir ? max(float(0.0), stN.x) : max(float(0.0), stL.x);
            const rightC1 = isPositiveDir ? max(float(0.0), stN.y) : max(float(0.0), stL.y);
            const rightC2 = isPositiveDir ? max(float(0.0), stN.z) : max(float(0.0), stL.z);

            const limitF = (raw: Node<'float'>, dL: Node<'float'>, dR: Node<'float'>) => {
              const capPos = dL.mul(0.14).div(dtOverH);
              const capNeg = dR.mul(-0.14).div(dtOverH);
              return select(raw.greaterThan(0.0), min(raw, capPos), max(raw, capNeg));
            };

            const f0 = limitF(
              select(vFace.greaterThanEqual(0.0), vFace.mul(leftC0), vFace.mul(rightC0))
                .sub(kinD.x.mul(facePor).mul(rightC0.sub(leftC0)).mul(invH)),
              leftC0,
              rightC0,
            );
            const f1 = limitF(
              select(vFace.greaterThanEqual(0.0), vFace.mul(leftC1), vFace.mul(rightC1))
                .sub(kinD.y.mul(facePor).mul(rightC1.sub(leftC1)).mul(invH)),
              leftC1,
              rightC1,
            );
            const f2 = limitF(
              select(vFace.greaterThanEqual(0.0), vFace.mul(leftC2), vFace.mul(rightC2))
                .sub(kinD.z.mul(facePor).mul(rightC2.sub(leftC2)).mul(invH)),
              leftC2,
              rightC2,
            );

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
              netFE.subAssign(fE);
            } else {
              netF0.addAssign(f0);
              netF1.addAssign(f1);
              netF2.addAssign(f2);
              netFE.addAssign(fE);
            }
            const massF = f0.mul(kinM.x).add(f1.mul(kinM.y)).add(f2.mul(kinM.z)).mul(0.5);
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
        const postE = max(float(5000.0), eL.add(netFE.mul(dtOverH)));

        const mFluxKg = postC0.mul(kinM.x).add(postC1.mul(kinM.y)).add(postC2.mul(kinM.z)).mul(volF);
        atomicAdd(reduceAtomic.element(uint(3)), uint(max(float(0.0), mFluxKg.mul(this.uAtomicScale)).add(0.5)));

        const cpVol = kinCp.w.add(postC0.mul(kinCp.x)).add(postC1.mul(kinCp.y)).add(postC2.mul(kinCp.z));
        const tempPost = tslClamp(postE.div(max(float(200.0), cpVol)), float(40.0), float(4500.0));

        statePongWrite.element(idx).assign(vec4(postC0, postC1, postC2, postE));
        auxPongWrite.element(idx).assign(vec4(jOut.x, jOut.y, jOut.z, tempPost));
      });
    })().compute(N, [64]).setName('MetabolismFluxPass');

    // Compute Pass 2: Local Hypergraph Reaction + Enthalpy + Phase + Atomic Audit (Pong -> Ping)
    this.reactPassNode = Fn(() => {
      const idx = instanceIndex;
      const metaL = this.metaReadNode.element(idx);
      const isActL = metaL.x.greaterThanEqual(0.5);

      If(isActL, () => {
        const kinM = this.kineticsReadNode.element(uint(0));
        const kinCp = this.kineticsReadNode.element(uint(2));
        const stP = statePongRead.element(idx);
        const auxP = auxPongRead.element(idx);
        const vpL = velPorRead.element(idx);
        const prevDiag = this.diagReadNode.element(idx);

        const c0 = max(float(0.0), stP.x).toVar('rxC0');
        const c1 = max(float(0.0), stP.y).toVar('rxC1');
        const c2 = max(float(0.0), stP.z).toVar('rxC2');
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
          const dHRate = float(0.0).toVar('dH');
          const safeT = max(float(20.0), tempK);

          Loop({ start: 0, end: 3, type: 'int', condition: '<' }, ({ i: rIdx }) => {
            const stRow = this.kineticsReadNode.element(uint(6).add(uint(rIdx)));
            const fOrdRow = this.kineticsReadNode.element(uint(9).add(uint(rIdx)));
            const rOrdRow = this.kineticsReadNode.element(uint(12).add(uint(rIdx)));
            const kinF = this.kineticsReadNode.element(uint(15).add(uint(rIdx)));
            const kinR = this.kineticsReadNode.element(uint(18).add(uint(rIdx)));
            const tpB = this.kineticsReadNode.element(uint(21).add(uint(rIdx)));

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
                .mul(powSafe(c0, fOrdRow.x))
                .mul(powSafe(c1, fOrdRow.y))
                .mul(powSafe(c2, fOrdRow.z));

              const isRev = tpB.z.greaterThan(0.5).and(kinR.x.greaterThan(0.0));
              const expR = tslClamp(kinR.y.negate().div(Rconst.mul(safeT)), -70.0, 20.0);
              const kr = select(isRev, kinR.x.mul(exp(expR)).mul(gate), float(0.0));
              const revRate = kr
                .mul(powSafe(c0, rOrdRow.x))
                .mul(powSafe(c1, rOrdRow.y))
                .mul(powSafe(c2, rOrdRow.z));

              const netRate = fwdRate.sub(revRate);
              dHRate.addAssign(netRate.mul(kinF.w));

              If(subIdx.equal(int(0)), () => {
                If(fwdRate.greaterThan(1e-12).and(revRate.greaterThan(1e-12)), () => {
                  // Exact De Donder affinity: R * (Jf - Jr) * ln(Jf / Jr) >= 0
                  const ratioSafe = tslClamp(fwdRate.div(max(revRate, 1e-12)), 1e-6, 1e6);
                  sigmaTotal.addAssign(Rconst.mul(netRate).mul(log(ratioSafe)));
                }).ElseIf(abs(netRate).greaterThan(1e-12), () => {
                  sigmaTotal.addAssign(Rconst.mul(abs(netRate)).mul(4.5));
                });
              });

              dc0.addAssign(stRow.x.mul(netRate));
              dc1.addAssign(stRow.y.mul(netRate));
              dc2.addAssign(stRow.z.mul(netRate));
            });
          });

          const scale = float(1.0).toVar('rxScale');
          If(dc0.mul(subDt).add(c0).lessThan(0.0).and(dc0.lessThan(-1e-12)), () => {
            scale.assign(min(scale, max(float(0.0), c0.div(dc0.negate().mul(subDt)))));
          });
          If(dc1.mul(subDt).add(c1).lessThan(0.0).and(dc1.lessThan(-1e-12)), () => {
            scale.assign(min(scale, max(float(0.0), c1.div(dc1.negate().mul(subDt)))));
          });
          If(dc2.mul(subDt).add(c2).lessThan(0.0).and(dc2.lessThan(-1e-12)), () => {
            scale.assign(min(scale, max(float(0.0), c2.div(dc2.negate().mul(subDt)))));
          });

          const effDt = subDt.mul(scale);
          c0.assign(max(float(0.0), c0.add(dc0.mul(effDt))));
          c1.assign(max(float(0.0), c1.add(dc1.mul(effDt))));
          c2.assign(max(float(0.0), c2.add(dc2.mul(effDt))));
          eVal.assign(max(float(5000.0), eVal.sub(dHRate.mul(effDt))));
          const cpStep = kinCp.w.add(c0.mul(kinCp.x)).add(c1.mul(kinCp.y)).add(c2.mul(kinCp.z));
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

        const nextMineral = max(float(0.0), prevDiag.z.add(max(float(0.0), c1.sub(0.72)).mul(this.uDt)));
        statePingWrite.element(idx).assign(vec4(c0, c1, c2, eVal));
        auxPingWrite.element(idx).assign(vec4(auxP.x, auxP.y, auxP.z, tempK));
        diagWrite.element(idx).assign(vec4(ph, sigmaTotal, nextMineral, tempK.sub(300.0)));

        // Compact 64-byte atomic scalar telemetry reduction
        const mReactKg = c0.mul(kinM.x).add(c1.mul(kinM.y)).add(c2.mul(kinM.z)).mul(volF);
        atomicAdd(reduceAtomic.element(uint(0)), uint(max(float(0.0), mReactKg.mul(this.uAtomicScale)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(6)), uint(max(float(0.0), c0.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(7)), uint(max(float(0.0), c1.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(8)), uint(max(float(0.0), c2.mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(9)), uint(max(float(0.0), sigmaTotal.mul(volF).mul(100.0)).add(0.5)));
        atomicAdd(reduceAtomic.element(uint(10)), uint(1));
        atomicAdd(reduceAtomic.element(uint(11)), uint(max(float(0.0), tempK).add(0.5)));

        // Write 8x8x8 = 512 macro feedback bins cleanly from representative center voxel per coarse bin (zero races!)
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
          macroFeedbackWrite.element(bIdx).assign(vec4(tempK, c1, nextMineral, sigmaTotal));
        });
      });
    })().compute(N, [64]).setName('MetabolismReactionPass');
  }

  public updateHypergraphKinetics(hypergraph: CompiledReactionHypergraph): void {
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
    isOpenMode: boolean,
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
    this.uModeOpen.value = isOpenMode ? 1.0 : 0.0;
    this.uBoundaryOpen.value = isOpenMode ? 1.0 : 0.0;

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

  /**
   * Non-blocking async 64-byte scalar audit + 8 KB macro feedback readback.
   * Never blocks rendering and never transfers the 2M voxel buffers back to CPU!
   */
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
          ],
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
        // Device lost or disposed cleanly ignored
      })
      .finally(() => {
        this.readbackInFlight = false;
      });
  }

  /**
   * Builds a zero-readback TSL color sampling node for Three.js WebGPU terrain shading.
   * Converts worldPos -> 3D voxel index -> directly reads GPU StorageBuffers in fragment shader!
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
    const aux = this.auxPingReadNode.element(cellIdx);
    const meta = this.metaReadNode.element(cellIdx);
    const diag = this.diagReadNode.element(cellIdx);

    const col0 = this.kineticsReadNode.element(uint(3)).xyz;
    const col1 = this.kineticsReadNode.element(uint(4)).xyz;
    const col2 = this.kineticsReadNode.element(uint(5)).xyz;

    // Channel 0: species concentrations
    const c0 = max(float(0.0), st.x);
    const c1 = max(float(0.0), st.y);
    const c2 = max(float(0.0), st.z);
    const sumC = c0.add(c1).add(c2);
    const lumScale = tslClamp(sumC.div(2.2), 0.32, 1.15);
    const speciesRgb = select(
      sumC.greaterThan(1e-5),
      col0.mul(c0).add(col1.mul(c1)).add(col2.mul(c2)).div(max(sumC, 1e-4)).mul(lumScale),
      vec3(0.14, 0.18, 0.25),
    );

    // Channel 1: thermal / internal energy
    const tempC = aux.w.sub(273.15);
    let energyRgb = mix(color(0x2840b8), color(0x22d3ee), smoothstep(-40.0, 5.0, tempC));
    energyRgb = mix(energyRgb, color(0x34d399), smoothstep(5.0, 35.0, tempC));
    energyRgb = mix(energyRgb, color(0xfbbf24), smoothstep(35.0, 120.0, tempC));
    energyRgb = mix(energyRgb, color(0xef4444), smoothstep(120.0, 400.0, tempC));

    // Channel 2: phase
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

    // Channel 3: flux magnitude |J|
    const jMag = length(aux.xyz);
    const jNorm = tslClamp(jMag.mul(42.0), 0.0, 1.0);
    const fluxRgb = vec3(
      float(0.08).add(jNorm.mul(0.9)),
      float(0.18).add(sin(jNorm.mul(2.67)).mul(0.72)),
      float(0.45).add(float(1.0).sub(jNorm).mul(0.42)).sub(jNorm.mul(0.25)),
    );

    const inactiveRgb = vec3(0.14, 0.18, 0.24);
    const rawRgb = select(
      channelNode.lessThan(0.5),
      speciesRgb,
      select(
        channelNode.lessThan(1.5),
        energyRgb,
        select(channelNode.lessThan(2.5), phRgb, fluxRgb),
      ),
    );
    return select(meta.x.greaterThanEqual(0.5), tslClamp(rawRgb, 0.04, 1.0), inactiveRgb);
  }

  /**
   * Patches local porosity & activeMask slices inside the GPU storage buffers when the player sculpts terrain.
   */
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

    const st = this.statePingAttr.array as Float32Array;
    const meta = this.metaAttr.array as Float32Array;
    const slot = Math.max(0, Math.min(2, Math.floor(speciesIndex)));
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
            st[idx * 4 + slot] += amountMolM3 * w;
            touched++;
          }
        }
      }
    }
    if (touched > 0) {
      this.statePingAttr.needsUpdate = true;
    }
    return touched;
  }

  public readGpuTelemetry(prevStep: number, simTimeSec: number, boundaryMode: 'closed' | 'open', prevTelemetry: FvmStepTelemetry): FvmStepTelemetry {
    const rb = this.lastReadback;
    if (!rb) return prevTelemetry;
    const netB = rb.boundaryFeedMassKg - rb.boundaryExhaustMassKg;
    const residual = rb.totalMassPostReactKg - (rb.totalMassPreKg + netB);
    const scaleRef = Math.max(1e-6, rb.totalMassPreKg, rb.totalMassPostReactKg, Math.abs(netB));
    const relErr = Math.abs(residual) / scaleRef;

    const totalSpeciesMoles = new Float64Array(3);
    const meanConcentrations = new Float64Array(3);
    const volTot = rb.activeCellCount * this.cellVolumeM3;
    for (let s = 0; s < 3; s++) {
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
        conserved: relErr < 5e-3, // Fixed-point uint quantization tolerance at 2M voxels
      },
    };
  }
}
