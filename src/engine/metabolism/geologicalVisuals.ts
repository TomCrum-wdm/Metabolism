// Zero-GC 3D WebGPU Visual Assembly for Stage 5 Geological Evolution:
//   1. Concentric expanding P-wave / S-wave Seismic Wavefront Rings + Fault Line Traces at recent quakes
//   2. Rising Volcanic Ash Plume & Glowing Magma Ember Particles at active volcano calderas

import * as THREE from 'three/webgpu';
import { float, vertexColor } from 'three/tsl';
import { GeologicalEvolutionStats } from './geologicalEvolution';

const MAX_QUAKES = 6;
const RING_SEGS = 28;
// Per quake: 2 concentric wavefront rings * 28 segs + 1 fault segment = 57 line segments (114 vertices)
const SEGS_PER_QUAKE = RING_SEGS * 2 + 1;
const MAX_LINE_VERTS = MAX_QUAKES * SEGS_PER_QUAKE * 2;

const MAX_VOLCANOES = 6;
const EMBERS_PER_VOLCANO = 28;
const MAX_PLUME_POINTS = MAX_VOLCANOES * EMBERS_PER_VOLCANO;

export interface GeologicalVisualsAssembly {
  readonly root: THREE.Group;
  update(
    simTimeSec: number,
    planetRadius: number,
    geoStats: GeologicalEvolutionStats,
    visible: boolean,
  ): void;
  dispose(): void;
}

function normalizeOrUp(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return [0, 1, 0];
  return [x / len, y / len, z / len];
}

function orthoTangentPair(nx: number, ny: number, nz: number): [
  number, number, number,
  number, number, number,
] {
  const rx = Math.abs(ny) < 0.85 ? 0 : 1;
  const ry = Math.abs(ny) < 0.85 ? 1 : 0;
  const rz = 0;
  let tx = ry * nz - rz * ny;
  let ty = rz * nx - rx * nz;
  let tz = rx * ny - ry * nx;
  const tLen = Math.hypot(tx, ty, tz) || 1;
  tx /= tLen;
  ty /= tLen;
  tz /= tLen;
  const ux = ny * tz - nz * ty;
  const uy = nz * tx - nx * tz;
  const uz = nx * ty - ny * tx;
  return [tx, ty, tz, ux, uy, uz];
}

export function createGeologicalVisualsAssembly(): GeologicalVisualsAssembly {
  const root = new THREE.Group();
  root.name = 'MetabolismGeologicalVisuals';

  // 1. Seismic Wavefront Rings + Fault Rupture Lines
  const linePos = new Float32Array(MAX_LINE_VERTS * 3);
  const lineCol = new Float32Array(MAX_LINE_VERTS * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  lineGeo.setDrawRange(0, 0);

  const lineMat = new THREE.LineBasicNodeMaterial();
  lineMat.vertexColors = true;
  lineMat.colorNode = vertexColor();
  lineMat.opacityNode = float(0.88);
  lineMat.transparent = true;
  lineMat.depthWrite = false;

  const seismicLines = new THREE.LineSegments(lineGeo, lineMat);
  seismicLines.frustumCulled = false;
  root.add(seismicLines);

  // 2. Volcanic Plume & Magma Ember Points
  const plumePos = new Float32Array(MAX_PLUME_POINTS * 3);
  const plumeCol = new Float32Array(MAX_PLUME_POINTS * 3);
  const plumeGeo = new THREE.BufferGeometry();
  plumeGeo.setAttribute('position', new THREE.BufferAttribute(plumePos, 3));
  plumeGeo.setAttribute('color', new THREE.BufferAttribute(plumeCol, 3));
  plumeGeo.setDrawRange(0, 0);

  const plumeMat = new THREE.PointsNodeMaterial();
  plumeMat.vertexColors = true;
  plumeMat.sizeNode = float(4.8);
  plumeMat.colorNode = vertexColor();
  plumeMat.opacityNode = float(0.85);
  plumeMat.transparent = true;
  plumeMat.depthWrite = false;

  const volcanoPoints = new THREE.Points(plumeGeo, plumeMat);
  volcanoPoints.frustumCulled = false;
  root.add(volcanoPoints);

  return {
    root,
    update(simTimeSec, planetRadius, geoStats, visible) {
      root.visible = visible;
      if (!visible) return;

      const rScale = Math.max(0.1, planetRadius / 13.0);

      // Update seismic wavefront rings & fault traces
      const quakes = geoStats.recentQuakes;
      let vIdx = 0;
      const qCount = Math.min(MAX_QUAKES, quakes.length);
      for (let q = 0; q < qCount; q++) {
        const marker = quakes[q];
        const [ex, ey, ez] = marker.epicenter;
        const [nx, ny, nz] = normalizeOrUp(ex, ey, ez);
        const [tx, ty, tz, ux, uy, uz] = orthoTangentPair(nx, ny, nz);

        // Continuous subtle pulse phase driven by ageSec + simTimeSec
        const cycle = ((simTimeSec * 0.65 + q * 0.37) % 1.0);
        const magScale = Math.max(0.65, (marker.magnitudeMw - 4.0) * 0.42);
        const maxRad = (1.6 + magScale * 2.2) * rScale;

        // Fault rupture trace slightly lifted above crust
        const lift = 0.16 * rScale;
        const [fx2, fy2, fz2] = marker.faultEnd;
        const [fnx2, fny2, fnz2] = normalizeOrUp(fx2, fy2, fz2);
        const ax = ex + nx * lift;
        const ay = ey + ny * lift;
        const az = ez + nz * lift;
        const bx = fx2 + fnx2 * lift;
        const by = fy2 + fny2 * lift;
        const bz = fz2 + fnz2 * lift;
        const mirrorAx = ex * 2 - fx2 + nx * lift;
        const mirrorAy = ey * 2 - fy2 + ny * lift;
        const mirrorAz = ez * 2 - fz2 + nz * lift;

        if (vIdx + 2 <= MAX_LINE_VERTS) {
          linePos[vIdx * 3] = mirrorAx;
          linePos[vIdx * 3 + 1] = mirrorAy;
          linePos[vIdx * 3 + 2] = mirrorAz;
          lineCol[vIdx * 3] = 1.0;
          lineCol[vIdx * 3 + 1] = 0.28;
          lineCol[vIdx * 3 + 2] = 0.18;
          vIdx++;

          linePos[vIdx * 3] = bx;
          linePos[vIdx * 3 + 1] = by;
          linePos[vIdx * 3 + 2] = bz;
          lineCol[vIdx * 3] = 1.0;
          lineCol[vIdx * 3 + 1] = 0.55;
          lineCol[vIdx * 3 + 2] = 0.2;
          vIdx++;
        }

        // Two concentric P/S wavefront rings
        for (let ring = 0; ring < 2; ring++) {
          const rPhase = (cycle + ring * 0.5) % 1.0;
          const ringRad = (0.35 + rPhase) * maxRad;
          const fade = 1.0 - rPhase * 0.72;
          const rColR = ring === 0 ? 0.98 * fade : 0.25 * fade;
          const rColG = ring === 0 ? 0.62 * fade : 0.85 * fade;
          const rColB = ring === 0 ? 0.22 * fade : 0.98 * fade;

          for (let s = 0; s < RING_SEGS; s++) {
            if (vIdx + 2 > MAX_LINE_VERTS) break;
            const a0 = (s / RING_SEGS) * Math.PI * 2;
            const a1 = ((s + 1) / RING_SEGS) * Math.PI * 2;

            const c0 = Math.cos(a0) * ringRad;
            const s0 = Math.sin(a0) * ringRad;
            const c1 = Math.cos(a1) * ringRad;
            const s1 = Math.sin(a1) * ringRad;

            linePos[vIdx * 3] = ax + tx * c0 + ux * s0;
            linePos[vIdx * 3 + 1] = ay + ty * c0 + uy * s0;
            linePos[vIdx * 3 + 2] = az + tz * c0 + uz * s0;
            lineCol[vIdx * 3] = rColR;
            lineCol[vIdx * 3 + 1] = rColG;
            lineCol[vIdx * 3 + 2] = rColB;
            vIdx++;

            linePos[vIdx * 3] = ax + tx * c1 + ux * s1;
            linePos[vIdx * 3 + 1] = ay + ty * c1 + uy * s1;
            linePos[vIdx * 3 + 2] = az + tz * c1 + uz * s1;
            lineCol[vIdx * 3] = rColR;
            lineCol[vIdx * 3 + 1] = rColG;
            lineCol[vIdx * 3 + 2] = rColB;
            vIdx++;
          }
        }
      }

      if (vIdx > 0) {
        (lineGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (lineGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      }
      lineGeo.setDrawRange(0, vIdx);
      seismicLines.visible = vIdx > 0;

      // Update active volcano magma embers & ash plume points
      const volcanos = geoStats.activeVolcanoes;
      const volCount = Math.min(MAX_VOLCANOES, volcanos.length);
      let pIdx = 0;
      for (let v = 0; v < volCount; v++) {
        const site = volcanos[v];
        const [vx, vy, vz] = site.worldPos;
        const [nx, ny, nz] = normalizeOrUp(vx, vy, vz);
        const [tx, ty, tz, ux, uy, uz] = orthoTangentPair(nx, ny, nz);
        const plumeHeight = (1.6 + Math.min(2.2, site.intensity)) * rScale;

        for (let k = 0; k < EMBERS_PER_VOLCANO; k++) {
          if (pIdx >= MAX_PLUME_POINTS) break;
          const seedPhase = ((k * 73 + v * 37) % 100) / 100;
          const life = (simTimeSec * (0.45 + seedPhase * 0.35) + seedPhase) % 1.0;
          const h = life * plumeHeight;
          const swirlAngle = simTimeSec * 1.4 + k * 0.85;
          const spread = (0.14 + life * 0.65) * rScale;
          const offT = Math.cos(swirlAngle) * spread;
          const offU = Math.sin(swirlAngle) * spread;

          plumePos[pIdx * 3] = vx + nx * h + tx * offT + ux * offU;
          plumePos[pIdx * 3 + 1] = vy + ny * h + ty * offT + uy * offU;
          plumePos[pIdx * 3 + 2] = vz + nz * h + tz * offT + uz * offU;

          // Transition from molten orange-yellow near caldera base to dark smoky ash aloft
          const heat = Math.max(0, 1.0 - life * 1.15);
          plumeCol[pIdx * 3] = 0.28 + heat * 0.72;
          plumeCol[pIdx * 3 + 1] = 0.22 + heat * 0.45;
          plumeCol[pIdx * 3 + 2] = 0.24 - heat * 0.14;
          pIdx++;
        }
      }

      if (pIdx > 0) {
        (plumeGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (plumeGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      }
      plumeGeo.setDrawRange(0, pIdx);
      volcanoPoints.visible = pIdx > 0;
    },
    dispose() {
      lineGeo.dispose();
      lineMat.dispose();
      plumeGeo.dispose();
      plumeMat.dispose();
    },
  };
}
