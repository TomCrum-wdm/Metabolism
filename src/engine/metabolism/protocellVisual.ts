import * as THREE from 'three/webgpu';
import { color, float, vertexColor } from 'three/tsl';
import { CellularBioTelemetry, FvmRenderFieldView } from './eulerianFvm';
import { MetabolismVisualChannel, sampleFvmRenderColor } from './metabolismEngine';

const BOX_EDGES: ReadonlyArray<[number, number, number, number, number, number]> = [
  [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0],
  [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
  [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
];

const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();
const _tmpUp = new THREE.Vector3(0, 1, 0);
const _tmpQuat = new THREE.Quaternion();
const _tmpMat4 = new THREE.Matrix4();
const _tmpColor = new THREE.Color();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface ProtocellVisualAssembly {
  readonly root: THREE.Group;
  update(
    dtSec: number,
    simTimeSec: number,
    zoneCenter: readonly [number, number, number],
    zoneHalfExtent: number,
    cellularBio: CellularBioTelemetry,
    showCell: boolean,
    showPicParticles: boolean,
  ): void;
  dispose(): void;
}

/**
 * Builds a composite 8-part procedural 3D Protocell + PIC AABB Brownian tracer assembly.
 * Zero external asset dependencies; purely procedural Three.js + TSL NodeMaterials.
 */
export function createProtocellVisualAssembly(isSoftwareGl = false): ProtocellVisualAssembly {
  const root = new THREE.Group();
  root.name = 'MetabolismProtocellAssembly';

  const cellGroup = new THREE.Group();
  cellGroup.name = 'ProtocellBody';
  root.add(cellGroup);

  const disposables: Array<{ dispose(): void }> = [];

  // 1. Primary lipid bilayer outer membrane (translucent physical dome/vesicle)
  const outerGeo = new THREE.SphereGeometry(1.0, 28, 20);
  const outerMat = new THREE.MeshPhysicalNodeMaterial();
  outerMat.colorNode = color(0x2dd4bf);
  outerMat.emissiveNode = color(0x064e3b);
  outerMat.roughnessNode = float(0.16);
  outerMat.metalnessNode = float(0.04);
  outerMat.clearcoatNode = float(1.0);
  outerMat.clearcoatRoughnessNode = float(0.08);
  outerMat.opacityNode = float(isSoftwareGl ? 0.34 : 0.28);
  outerMat.transparent = true;
  outerMat.depthWrite = false;
  const outerMembrane = new THREE.Mesh(outerGeo, outerMat);
  outerMembrane.renderOrder = 5;
  cellGroup.add(outerMembrane);
  disposables.push(outerGeo, outerMat);

  // 2. Cytoskeleton icosahedral geodesic cortex lattice
  const cortexBaseGeo = new THREE.IcosahedronGeometry(0.95, 1);
  const cortexWireGeo = new THREE.WireframeGeometry(cortexBaseGeo);
  cortexBaseGeo.dispose();
  const cortexMat = new THREE.LineBasicNodeMaterial();
  cortexMat.colorNode = color(0x5eead4);
  cortexMat.opacityNode = float(0.32);
  cortexMat.transparent = true;
  const cortexLines = new THREE.LineSegments(cortexWireGeo, cortexMat);
  cellGroup.add(cortexLines);
  disposables.push(cortexWireGeo, cortexMat);

  // 3. Cytoplasm metabolic core
  const coreGeo = new THREE.SphereGeometry(0.42, 20, 14);
  const coreMat = new THREE.MeshStandardNodeMaterial();
  coreMat.colorNode = color(0x10b981);
  coreMat.emissiveNode = color(0x059669);
  coreMat.roughnessNode = float(0.45);
  coreMat.metalnessNode = float(0.1);
  coreMat.opacityNode = float(0.55);
  coreMat.transparent = true;
  coreMat.depthWrite = false;
  const cytoplasmCore = new THREE.Mesh(coreGeo, coreMat);
  cytoplasmCore.renderOrder = 4;
  cellGroup.add(cytoplasmCore);
  disposables.push(coreGeo, coreMat);

  // 4. Coiled circular plasmid / RNA-DNA genetic ring
  const plasmidGeo = new THREE.TorusKnotGeometry(0.24, 0.036, 68, 10, 2, 3);
  const plasmidMat = new THREE.MeshStandardNodeMaterial();
  plasmidMat.colorNode = color(0xc084fc);
  plasmidMat.emissiveNode = color(0x6b21a8);
  plasmidMat.roughnessNode = float(0.32);
  plasmidMat.metalnessNode = float(0.22);
  const plasmidMesh = new THREE.Mesh(plasmidGeo, plasmidMat);
  cellGroup.add(plasmidMesh);
  disposables.push(plasmidGeo, plasmidMat);

  // 5-6. Four metabolic organelles (mitochondria / thylakoid capsules)
  const orgGeo = new THREE.CapsuleGeometry(0.085, 0.19, 6, 12);
  const orgMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.75,
    roughness: 0.38,
    metalness: 0.15,
  });
  const organelles: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const org = new THREE.Mesh(orgGeo, orgMat);
    const phi = (i / 4) * Math.PI * 2;
    org.position.set(Math.cos(phi) * 0.56, (i % 2 === 0 ? 1 : -1) * 0.22, Math.sin(phi) * 0.56);
    org.rotation.set(0.4 * i, phi, 0.5);
    cellGroup.add(org);
    organelles.push(org);
  }
  disposables.push(orgGeo, orgMat);

  // 7. Instanced transmembrane ion & proton channel pores embedded across bilayer
  const poreCount = 10;
  const poreGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.18, 10);
  const poreMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.45,
    roughness: 0.65,
    metalness: 0.42,
  });
  const poresMesh = new THREE.InstancedMesh(poreGeo, poreMat, poreCount);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < poreCount; i++) {
    const y = 1 - (i / (poreCount - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    _tmpVecA.set(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY).normalize();
    _tmpQuat.setFromUnitVectors(_tmpUp, _tmpVecA);
    _tmpVecB.copy(_tmpVecA).multiplyScalar(0.96);
    _tmpVecC.set(1, 1, 1);
    _tmpMat4.compose(_tmpVecB, _tmpQuat, _tmpVecC);
    poresMesh.setMatrixAt(i, _tmpMat4);
  }
  poresMesh.instanceMatrix.needsUpdate = true;
  poresMesh.computeBoundingSphere();
  cellGroup.add(poresMesh);
  disposables.push(poreGeo, poreMat);

  // 8. Ephemeral PIC AABB Langevin tracer particles (strictly confined inside coupling zone)
  const particleCount = 160;
  const partPos = new Float32Array(particleCount * 3);
  const partCol = new Float32Array(particleCount * 3);
  const partSeed = new Float32Array(particleCount * 4);
  for (let i = 0; i < particleCount; i++) {
    // Deterministic Halton-like phase seeds
    const h1 = ((i * 73 + 17) % 199) / 199;
    const h2 = ((i * 137 + 43) % 251) / 251;
    const h3 = ((i * 211 + 89) % 307) / 307;
    partSeed[i * 4 + 0] = (h1 - 0.5) * 1.85;
    partSeed[i * 4 + 1] = (h2 - 0.5) * 1.85;
    partSeed[i * 4 + 2] = (h3 - 0.5) * 1.85;
    partSeed[i * 4 + 3] = 0.7 + ((i * 53) % 100) / 100;
  }
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
  partGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3));
  const partMat = new THREE.PointsNodeMaterial();
  partMat.vertexColors = true;
  partMat.sizeNode = float(4.2);
  partMat.colorNode = vertexColor();
  partMat.opacityNode = float(0.88);
  partMat.transparent = true;
  partMat.depthWrite = false;
  const picPoints = new THREE.Points(partGeo, partMat);
  picPoints.frustumCulled = false;
  root.add(picPoints);
  disposables.push(partGeo, partMat);

  let phaseSpin = 0;

  return {
    root,
    update(dtSec, simTimeSec, zoneCenter, zoneHalfExtent, cellularBio, showCell, showPicParticles) {
      root.visible = showCell || showPicParticles;
      if (!root.visible) return;

      const zx = zoneCenter[0];
      const zy = zoneCenter[1];
      const zz = zoneCenter[2];

      cellGroup.visible = showCell;
      if (showCell) {
        const atpNorm = clamp(cellularBio.atpSynthesisRateMmolLs / 12.0, 0.1, 1.5);
        const aeroRatio = clamp(cellularBio.aerobicSharePct / 100, 0, 1);
        const pulse = 1 + 0.045 * Math.sin(simTimeSec * (2.4 + atpNorm * 2.2));
        const baseScale = Math.max(0.45, zoneHalfExtent * 0.62) * pulse;

        cellGroup.position.set(zx, zy, zz);
        // Align +Y axis radially outward from planet core
        _tmpVecA.set(zx, zy, zz);
        if (_tmpVecA.lengthSq() > 1e-4) {
          _tmpVecA.normalize();
          _tmpQuat.setFromUnitVectors(_tmpUp, _tmpVecA);
          cellGroup.quaternion.copy(_tmpQuat);
        }
        cellGroup.scale.setScalar(baseScale);

        phaseSpin += dtSec * (0.45 + atpNorm * 0.85);
        plasmidMesh.rotation.set(phaseSpin * 0.7, phaseSpin, phaseSpin * 0.35);
        cortexLines.rotation.y = -phaseSpin * 0.25;

        // Shift organelle glow: cyan-emerald for aerobic ATP dominance, amber-orange for anaerobic fermentation
        _tmpColor.setRGB(
          0.95 - aeroRatio * 0.72,
          0.52 + aeroRatio * 0.38,
          0.12 + aeroRatio * 0.56,
        );
        orgMat.emissive.copy(_tmpColor);
        orgMat.color.copy(_tmpColor).lerp(_tmpColor.setRGB(1, 0.9, 0.75), 0.35);
        orgMat.emissiveIntensity = 0.55 + 0.65 * atpNorm;

        for (let i = 0; i < organelles.length; i++) {
          const ang = phaseSpin * 0.65 + (i * Math.PI) / 2;
          organelles[i].position.set(
            Math.cos(ang) * 0.54,
            Math.sin(ang * 1.5 + i) * 0.22,
            Math.sin(ang) * 0.54,
          );
          organelles[i].rotation.y = -ang;
        }
      }

      picPoints.visible = showPicParticles;
      if (showPicParticles) {
        const half = Math.max(0.4, zoneHalfExtent);
        const aeroFrac = clamp(cellularBio.aerobicSharePct / 100, 0, 1);
        const pAttr = partGeo.getAttribute('position') as THREE.BufferAttribute;
        const cAttr = partGeo.getAttribute('color') as THREE.BufferAttribute;

        for (let i = 0; i < particleCount; i++) {
          const sx = partSeed[i * 4 + 0];
          const sy = partSeed[i * 4 + 1];
          const sz = partSeed[i * 4 + 2];
          const spd = partSeed[i * 4 + 3];
          const t = simTimeSec * spd * 1.45;
          // Reflected triangle-like Lissajous oscillation bounded cleanly inside [-0.95*half, 0.95*half]
          const ox = Math.sin(t + sx * 5.0) * 0.88 * half;
          const oy = Math.cos(t * 1.23 + sy * 6.1) * 0.82 * half;
          const oz = Math.sin(t * 0.87 + sz * 7.3) * 0.88 * half;

          partPos[i * 3 + 0] = zx + ox;
          partPos[i * 3 + 1] = zy + oy;
          partPos[i * 3 + 2] = zz + oz;

          // Color particles: oxygen/ATP carriers cyan-emerald vs substrate/CO2 warm amber
          const kind = i % 3;
          if (kind === 0) {
            partCol[i * 3 + 0] = 0.16;
            partCol[i * 3 + 1] = 0.72 + aeroFrac * 0.24;
            partCol[i * 3 + 2] = 0.96;
          } else if (kind === 1) {
            partCol[i * 3 + 0] = 0.96;
            partCol[i * 3 + 1] = 0.68;
            partCol[i * 3 + 2] = 0.22;
          } else {
            partCol[i * 3 + 0] = 0.24;
            partCol[i * 3 + 1] = 0.92;
            partCol[i * 3 + 2] = 0.56;
          }
        }
        pAttr.needsUpdate = true;
        cAttr.needsUpdate = true;
      }
    },
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}

export interface FvmFluxArrowsVisual {
  readonly lines: THREE.LineSegments;
  update(
    view: FvmRenderFieldView,
    planetBaseRadius: number,
    simTimeSec: number,
    visible: boolean,
  ): void;
  dispose(): void;
}

/**
 * Renders 3D directional mass-flux / advection streamlines around the planetary surface shell
 * using a single pre-allocated LineSegments buffer (zero per-frame GC).
 */
export function createFvmFluxArrowsVisual(maxArrows = 420): FvmFluxArrowsVisual {
  const vertsPerArrow = 6; // shaft (2) + 2 arrowhead wings (4)
  const positions = new Float32Array(maxArrows * vertsPerArrow * 3);
  const colors = new Float32Array(maxArrows * vertsPerArrow * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineBasicNodeMaterial();
  mat.vertexColors = true;
  mat.colorNode = vertexColor();
  mat.opacityNode = float(0.86);
  mat.transparent = true;
  mat.depthWrite = false;

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;

  return {
    lines,
    update(view, planetBaseRadius, simTimeSec, visible) {
      lines.visible = visible;
      if (!visible) return;

      const n = view.cellsPerAxis;
      const half = view.worldHalf;
      const vs = view.voxelSize;
      const minR = planetBaseRadius * 0.94;
      const maxR = planetBaseRadius * 1.16;
      const stride = n >= 24 ? 2 : 1;

      let count = 0;
      for (let iz = 0; iz < n && count < maxArrows; iz += stride) {
        for (let iy = 0; iy < n && count < maxArrows; iy += stride) {
          for (let ix = 0; ix < n && count < maxArrows; ix += stride) {
            const idx = ix + iy * n + iz * n * n;
            if (view.activeMask[idx] === 0) continue;

            const wx = -half + (ix + 0.5) * vs;
            const wy = -half + (iy + 0.5) * vs;
            const wz = -half + (iz + 0.5) * vs;
            const r = Math.hypot(wx, wy, wz);
            if (r < minR || r > maxR) continue;

            let fx = view.fluxX[idx];
            let fy = view.fluxY[idx];
            let fz = view.fluxZ[idx];
            let mag = Math.hypot(fx, fy, fz);

            // If diffusion gradient flux is near equilibrium, gently show zonal tangential circulation vector
            if (mag < 1e-4) {
              fx = -wz * 0.04;
              fy = 0;
              fz = wx * 0.04;
              mag = Math.hypot(fx, fy, fz);
            }
            if (mag < 1e-6) continue;

            const invM = 1 / mag;
            const dx = fx * invM;
            const dy = fy * invM;
            const dz = fz * invM;

            // Normalized flux intensity + subtle animated advection pulse
            const intensity = clamp(Math.log1p(mag * 12) / 3.2, 0.25, 1.0);
            const pulse = 0.85 + 0.15 * Math.sin(simTimeSec * 3.0 + ix * 0.7 + iz * 0.9);
            const len = vs * (0.45 + 0.65 * intensity) * pulse;

            const sx = wx;
            const sy = wy;
            const sz = wz;
            const ex = sx + dx * len;
            const ey = sy + dy * len;
            const ez = sz + dz * len;

            // Orthogonal wing vector via cross product with radial normal
            const invR = r > 1e-4 ? 1 / r : 1;
            const rx = wx * invR;
            const ry = wy * invR;
            const rz = wz * invR;
            let px = dy * rz - dz * ry;
            let py = dz * rx - dx * rz;
            let pz = dx * ry - dy * rx;
            const pLen = Math.hypot(px, py, pz);
            if (pLen > 1e-5) {
              px /= pLen;
              py /= pLen;
              pz /= pLen;
            } else {
              px = 1;
              py = 0;
              pz = 0;
            }

            const wingBack = len * 0.28;
            const wingSpan = len * 0.18;
            const w1x = ex - dx * wingBack + px * wingSpan;
            const w1y = ey - dy * wingBack + py * wingSpan;
            const w1z = ez - dz * wingBack + pz * wingSpan;
            const w2x = ex - dx * wingBack - px * wingSpan;
            const w2y = ey - dy * wingBack - py * wingSpan;
            const w2z = ez - dz * wingBack - pz * wingSpan;

            const vBase = count * vertsPerArrow * 3;
            // Shaft
            positions[vBase + 0] = sx;
            positions[vBase + 1] = sy;
            positions[vBase + 2] = sz;
            positions[vBase + 3] = ex;
            positions[vBase + 4] = ey;
            positions[vBase + 5] = ez;
            // Wing 1
            positions[vBase + 6] = ex;
            positions[vBase + 7] = ey;
            positions[vBase + 8] = ez;
            positions[vBase + 9] = w1x;
            positions[vBase + 10] = w1y;
            positions[vBase + 11] = w1z;
            // Wing 2
            positions[vBase + 12] = ex;
            positions[vBase + 13] = ey;
            positions[vBase + 14] = ez;
            positions[vBase + 15] = w2x;
            positions[vBase + 16] = w2y;
            positions[vBase + 17] = w2z;

            // Color ramp: cyan -> emerald -> bright amber for strong fluxes
            const cr = clamp(intensity * 1.15 - 0.15, 0.12, 0.98);
            const cg = clamp(0.92 - Math.abs(intensity - 0.5) * 0.35, 0.45, 0.96);
            const cb = clamp(1.0 - intensity * 0.85, 0.18, 0.96);

            for (let k = 0; k < vertsPerArrow; k++) {
              const tailDim = k === 0 ? 0.55 : 1.0;
              colors[vBase + k * 3 + 0] = cr * tailDim;
              colors[vBase + k * 3 + 1] = cg * tailDim;
              colors[vBase + k * 3 + 2] = cb * tailDim;
            }
            count++;
          }
        }
      }

      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geo.setDrawRange(0, count * vertsPerArrow);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export interface HoveredVoxHighlightVisual {
  readonly lines: THREE.LineSegments;
  update(
    cellCenterWorld: readonly [number, number, number] | null,
    voxelSize: number,
    visible: boolean,
  ): void;
  dispose(): void;
}

/**
 * Highlights the exact Eulerian FVM single control volume voxel box currently under the cursor or locked.
 */
export function createHoveredVoxHighlightVisual(colorHex = 0xfbbf24): HoveredVoxHighlightVisual {
  const positions = new Float32Array(12 * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 24);

  const mat = new THREE.LineBasicNodeMaterial();
  mat.colorNode = color(colorHex);
  mat.opacityNode = float(0.95);
  mat.transparent = true;

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;

  return {
    lines,
    update(cellCenterWorld, voxelSize, visible) {
      if (!visible || !cellCenterWorld || voxelSize <= 0) {
        lines.visible = false;
        return;
      }
      lines.visible = true;
      const half = voxelSize * 0.5;
      const x0 = cellCenterWorld[0] - half;
      const y0 = cellCenterWorld[1] - half;
      const z0 = cellCenterWorld[2] - half;
      let v = 0;
      for (const e of BOX_EDGES) {
        positions[v * 3 + 0] = x0 + e[0] * voxelSize;
        positions[v * 3 + 1] = y0 + e[1] * voxelSize;
        positions[v * 3 + 2] = z0 + e[2] * voxelSize;
        v++;
        positions[v * 3 + 0] = x0 + e[3] * voxelSize;
        positions[v * 3 + 1] = y0 + e[4] * voxelSize;
        positions[v * 3 + 2] = z0 + e[5] * voxelSize;
        v++;
      }
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export interface FvmVoxelBlocksVisual {
  readonly mesh: THREE.InstancedMesh;
  update(
    view: FvmRenderFieldView,
    planetBaseRadius: number,
    channel: MetabolismVisualChannel,
    visible: boolean,
  ): void;
  dispose(): void;
}

const _blkRgb: [number, number, number] = [0, 0, 0];
const _blkScale = new THREE.Vector3();
const _blkPos = new THREE.Vector3();
const _blkIdQuat = new THREE.Quaternion();

/**
 * Renders discrete 3D FVM control-volume blocks on the reactive surface shell using InstancedMesh,
 * making every control volume's real FVM state tangible without per-frame allocations.
 */
export function createFvmVoxelBlocksVisual(maxBlocks = 640): FvmVoxelBlocksVisual {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.08,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, maxBlocks);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  // Initialize default instance color buffer cleanly
  _tmpColor.setRGB(1, 1, 1);
  for (let i = 0; i < maxBlocks; i++) {
    mesh.setColorAt(i, _tmpColor);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    update(view, planetBaseRadius, channel, visible) {
      mesh.visible = visible;
      if (!visible) return;

      const n = view.cellsPerAxis;
      const half = view.worldHalf;
      const vs = view.voxelSize;
      const minR = planetBaseRadius * 0.96;
      const maxR = planetBaseRadius * 1.15;
      const stride = n >= 24 ? 2 : 1;

      let count = 0;
      for (let iz = 0; iz < n && count < maxBlocks; iz += stride) {
        const wz = -half + (iz + 0.5) * vs;
        for (let iy = 0; iy < n && count < maxBlocks; iy += stride) {
          const wy = -half + (iy + 0.5) * vs;
          for (let ix = 0; ix < n && count < maxBlocks; ix += stride) {
            const idx = ix + iy * n + iz * n * n;
            if (view.activeMask[idx] === 0) continue;
            const wx = -half + (ix + 0.5) * vs;
            const r = Math.hypot(wx, wy, wz);
            if (r < minR || r > maxR) continue;

            if (!sampleFvmRenderColor(view, wx, wy, wz, channel, _blkRgb)) continue;

            // Subtle scale modulation by local activity / flux so active blocks stand out clearly
            const sigma = view.entropyProdRate[idx] ?? 0;
            const sFactor = clamp(0.76 + Math.min(0.18, sigma * 0.08), 0.72, 0.94) * vs;
            _blkPos.set(wx, wy, wz);
            _blkScale.setScalar(sFactor);
            _tmpMat4.compose(_blkPos, _blkIdQuat, _blkScale);
            mesh.setMatrixAt(count, _tmpMat4);

            _tmpColor.setRGB(_blkRgb[0], _blkRgb[1], _blkRgb[2]);
            mesh.setColorAt(count, _tmpColor);
            count++;
          }
        }
      }

      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
