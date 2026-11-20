import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEscapeVelocity,
  computeGravityMagnitude,
  computeGravityVector,
  DEFAULT_PLANET_RADIUS,
  EARTH_SURFACE_GRAVITY,
  parallelTransportTangentFrame,
} from './gravity';
import {
  decodeSeedCode,
  DEFAULT_SEED_CONFIG,
  encodeSeedCode,
  MaterialId,
  VoxelPlanet,
} from './voxelPlanet';
import { FluidSim } from './fluidSim';
import {
  clampPlayerScale,
  computeCharacterScaleMetrics,
  computeDetailCameraOptics,
  computeFirstPersonEyePose,
  computeSafeClipPlanes,
  DEFAULT_PLAYER_SCALE,
  evaluateLandingDescentPose,
  MAX_PLAYER_SCALE,
  MIN_PLAYER_SCALE,
  resolveSphericalCoreUp,
  stabilizeRadialAnchor,
  transportCameraForwardOnSphere,
} from './cameraMath';
import {
  BUILTIN_TOOLS,
  createCustomToolTemplate,
  resolveToolDefinition,
  TOOL_BEHAVIOR_PRESETS,
} from './toolRegistry';
import {
  computeRayPointDistanceSq,
  computeTractorSpringForce,
  evaluateStretchedAnchorPoint,
  intersectCursorWithDragPlane,
  summarizeEscapeStatus,
} from './tractorBeam';
import { computeHotspotDeltaC } from './thermal';
import {
  computePlanFrameCount,
  createDefaultDirectorPlan,
  DirectorSceneAnchor,
  evaluateDirectorPose,
  FPS_PRESETS,
  RESOLUTION_PRESETS,
} from './director';
import { buildTarArchive, WebmMuxer } from './webmMuxer';
import {
  analyzeRgbaFrameLuma,
  computeOfflineSubsteps,
  normalizeReadbackRgbaToTopDown,
} from './directorCapture';
import {
  classifyBackendDiagnostic,
  RollingPerfTracker,
} from './perfMonitor';
import {
  accumulateRgbaSample,
  buildRenderQualityConfig,
  computeSubpixelJitterOffset,
  computeTightShadowFrustum,
  createDefaultDirectorQuality,
  createRgbaAccumulator,
  finalizeAccumulatedRgba,
  halton,
  resolveDirectorOfflineQuality,
  resolveShadowMapSize,
} from './renderQuality';

const GRAVITY_PARAMS = {
  referenceRadius: DEFAULT_PLANET_RADIUS,
  surfaceGravity: EARTH_SURFACE_GRAVITY,
};

test('Newtonian gravity follows inverse-square law outside and Shell Theorem inside', () => {
  const r0 = DEFAULT_PLANET_RADIUS;
  const gSurface = computeGravityMagnitude(r0, GRAVITY_PARAMS);
  assert.ok(Math.abs(gSurface - EARTH_SURFACE_GRAVITY) < 1e-6);

  const gDouble = computeGravityMagnitude(r0 * 2, GRAVITY_PARAMS);
  assert.ok(Math.abs(gDouble - EARTH_SURFACE_GRAVITY / 4) < 1e-6);

  const gHalf = computeGravityMagnitude(r0 * 0.5, GRAVITY_PARAMS);
  assert.ok(Math.abs(gHalf - EARTH_SURFACE_GRAVITY * 0.5) < 1e-6);

  assert.equal(computeGravityMagnitude(0, GRAVITY_PARAMS), 0);

  const gv = { x: 0, y: 0, z: 0 };
  computeGravityVector(0, r0, 0, GRAVITY_PARAMS, gv);
  assert.ok(gv.y < -9.8 && Math.abs(gv.x) < 1e-6 && Math.abs(gv.z) < 1e-6);

  const vEsc = computeEscapeVelocity(r0, GRAVITY_PARAMS);
  assert.ok(Math.abs(vEsc - Math.sqrt(2 * EARTH_SURFACE_GRAVITY * r0)) < 1e-6);
});

test('Parallel transport tangent frame remains orthonormal even at north and south poles', () => {
  const up = { x: 0, y: 0, z: 0 };
  const fwd = { x: 0, y: 0, z: 0 };
  const right = { x: 0, y: 0, z: 0 };

  parallelTransportTangentFrame(0, 14, 0, { x: 0, y: 1, z: 0 }, up, fwd, right);
  assert.ok(Math.abs(up.y - 1) < 1e-5);
  const dotUF = up.x * fwd.x + up.y * fwd.y + up.z * fwd.z;
  const dotUR = up.x * right.x + up.y * right.y + up.z * right.z;
  const dotFR = fwd.x * right.x + fwd.y * right.y + fwd.z * right.z;
  assert.ok(Math.abs(dotUF) < 1e-5);
  assert.ok(Math.abs(dotUR) < 1e-5);
  assert.ok(Math.abs(dotFR) < 1e-5);
});

test('VoxelPlanet extracts closed outward-normal Marching Cubes terrain and supports sculpting/building', () => {
  const planet = new VoxelPlanet(202611);

  const [sx, sy, sz] = planet.spawnPosition;
  const spawnDensity = planet.sampleDensity(sx, sy, sz);
  assert.ok(spawnDensity < 0, 'Spawn point should be in open air above surface');

  const sLen = Math.hypot(sx, sy, sz);
  const hit = planet.raycastTerrain(
    sx,
    sy,
    sz,
    -sx / sLen,
    -sy / sLen,
    -sz / sLen,
    10,
  );
  assert.equal(hit.hit, true);
  assert.ok(hit.distance > 0.3 && hit.distance < 3.0);

  const radialDot =
    (hit.nx * hit.x + hit.ny * hit.y + hit.nz * hit.z) /
    Math.hypot(hit.x, hit.y, hit.z);
  assert.ok(radialDot > 0.5, 'Surface normal must point outward');

  let totalVerts = 0;
  for (let cz = 0; cz < planet.chunksPerAxis; cz++) {
    for (let cy = 0; cy < planet.chunksPerAxis; cy++) {
      for (let cx = 0; cx < planet.chunksPerAxis; cx++) {
        const mesh = planet.extractChunkMesh(cx, cy, cz, 0);
        totalVerts += mesh.vertexCount;
      }
    }
  }
  assert.ok(totalVerts > 15000, `Expected rich planet mesh, got ${totalVerts} verts`);

  const revBefore = planet.voxelRevision;
  const statsBefore = planet.getVoxelStats();

  const carveRes = planet.applyBrush(
    hit.x,
    hit.y,
    hit.z,
    'carve',
    2.4,
    2.5,
    MaterialId.Air,
  );
  assert.ok(carveRes.deltaVolume < 0);
  assert.ok(carveRes.modifiedChunks.length > 0);
  assert.ok(planet.sampleDensity(hit.x, hit.y, hit.z) < 0);
  assert.equal(planet.voxelRevision, revBefore + 1);

  const buildPos = [
    hit.x + hit.nx * 1.5,
    hit.y + hit.ny * 1.5,
    hit.z + hit.nz * 1.5,
  ];
  const buildRes = planet.applyBrush(
    buildPos[0],
    buildPos[1],
    buildPos[2],
    'build',
    2.0,
    3.5,
    MaterialId.Crystal,
  );
  assert.ok(buildRes.deltaVolume > 0);
  assert.ok(planet.sampleDensity(buildPos[0], buildPos[1], buildPos[2]) > 0);
  assert.equal(planet.voxelRevision, revBefore + 2);
  const statsAfter = planet.getVoxelStats();
  assert.ok(
    statsAfter.materialCounts[MaterialId.Crystal] > statsBefore.materialCounts[MaterialId.Crystal],
    'Material counts must immediately reflect newly sculpted Crystal voxels',
  );
});

test('Multi-resolution Chunk LOD reduces triangle counts monotonically across LOD 0, 1, and 2', () => {
  const planet = new VoxelPlanet(202611);
  const countVertsAtLod = (lod: 0 | 1 | 2) => {
    let total = 0;
    for (let cz = 0; cz < planet.chunksPerAxis; cz++) {
      for (let cy = 0; cy < planet.chunksPerAxis; cy++) {
        for (let cx = 0; cx < planet.chunksPerAxis; cx++) {
          total += planet.extractChunkMesh(cx, cy, cz, lod).vertexCount;
        }
      }
    }
    return total;
  };

  const v0 = countVertsAtLod(0);
  const v1 = countVertsAtLod(1);
  const v2 = countVertsAtLod(2);
  assert.ok(v0 > v1, `Expected LOD0 (${v0}) > LOD1 (${v1})`);
  assert.ok(v1 > v2, `Expected LOD1 (${v1}) > LOD2 (${v2})`);
  assert.ok(v2 > 500, `Expected LOD2 (${v2}) to remain a valid closed shell`);
});

test('Complex seed configuration scales planet radius, encodes/decodes cleanly, and probes voxel format', () => {
  const customCfg = {
    ...DEFAULT_SEED_CONFIG,
    seed: 77419,
    radius: 9.2,
    craterCount: 5,
    waterFill: 0.6,
    hasArch: false,
  };
  const code = encodeSeedCode(customCfg);
  const decoded = decodeSeedCode(code);
  assert.ok(decoded !== null);
  assert.equal(decoded.seed, 77419);
  assert.ok(Math.abs(decoded.radius - 9.2) < 1e-6);
  assert.equal(decoded.craterCount, 5);
  assert.equal(decoded.hasArch, false);

  const planet = new VoxelPlanet(customCfg);
  assert.ok(Math.abs(planet.baseRadius - 9.2) < 1e-6);
  const spawnR = Math.hypot(...planet.spawnPosition);
  assert.ok(spawnR > 8.5 && spawnR < 13.0, `Expected compact spawn radius, got ${spawnR}`);

  const stats = planet.getVoxelStats();
  assert.equal(stats.gridN, 57);
  assert.equal(stats.totalVoxels, 57 * 57 * 57);
  assert.equal(stats.densityBytes, 57 * 57 * 57 * 4);
  assert.equal(stats.materialBytes, 57 * 57 * 57);

  // Probe surface hit cell
  const sLen = spawnR;
  const hit = planet.raycastTerrain(
    planet.spawnPosition[0],
    planet.spawnPosition[1],
    planet.spawnPosition[2],
    -planet.spawnPosition[0] / sLen,
    -planet.spawnPosition[1] / sLen,
    -planet.spawnPosition[2] / sLen,
    10,
  );
  assert.equal(hit.hit, true);
  const probe = planet.probeVoxelCell(hit.x, hit.y, hit.z);
  assert.equal(probe.corners.length, 8);
  assert.equal(probe.slice5x5.length, 25);
  assert.ok(probe.cubeIndex > 0 && probe.cubeIndex < 255, 'Surface cell must cross isosurface');
  assert.ok(probe.triangleCount >= 1);
});

test('VoxelPlanet & FluidSim snapshots round-trip edited terrain and fluid state losslessly', () => {
  const planetA = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 551199, radius: 11.4 });
  const fluidA = new FluidSim();
  fluidA.seedInitialLakes(planetA);

  // Apply custom crystal spire edit
  planetA.applyBrush(0, 11.4, 0, 'build', 2.2, 3.0, MaterialId.Crystal);
  const snapPlanet = planetA.exportSnapshot();
  const snapFluid = fluidA.exportState();

  const planetB = new VoxelPlanet(1);
  const fluidB = new FluidSim();
  planetB.importSnapshot(snapPlanet);
  fluidB.importState(snapFluid);

  assert.equal(planetB.baseRadius, planetA.baseRadius);
  assert.equal(planetB.seedConfig.seed, 551199);
  assert.equal(
    planetB.sampleNearestMaterial(0, 11.4, 0),
    planetA.sampleNearestMaterial(0, 11.4, 0),
  );
  assert.equal(
    planetB.sampleDensity(0, 11.4, 0),
    planetA.sampleDensity(0, 11.4, 0),
  );
  assert.equal(fluidB.activeCount, fluidA.activeCount);
});

test('SPH FluidSim pulls water toward planet center and collides with voxel terrain', () => {
  const planet = new VoxelPlanet(202611);
  const fluid = new FluidSim();

  const [sx, sy, sz] = planet.spawnPosition;
  const sLen = Math.hypot(sx, sy, sz);
  const dropR = sLen + 2.5;
  fluid.spawnParticle(
    (sx / sLen) * dropR,
    (sy / sLen) * dropR,
    (sz / sLen) * dropR,
  );

  const initialR = Math.hypot(fluid.px[0], fluid.py[0], fluid.pz[0]);
  for (let i = 0; i < 45; i++) {
    fluid.step(1 / 60, planet, GRAVITY_PARAMS, 2);
  }
  const settledR = Math.hypot(fluid.px[0], fluid.py[0], fluid.pz[0]);

  assert.ok(settledR < initialR - 1.0, 'Fluid particle should fall radially inward');
  assert.ok(
    planet.sampleDensity(fluid.px[0], fluid.py[0], fluid.pz[0]) <= 0.05,
    'Fluid particle should rest on terrain surface without tunneling into rock',
  );

  fluid.seedInitialLakes(planet);
  assert.ok(fluid.activeCount >= 500);
  fluid.step(1 / 60, planet, GRAVITY_PARAMS, 2);
  const waterMesh = fluid.extractWaterSurface(planet);
  assert.ok(
    waterMesh.vertexCount > 500,
    `Expected smooth water isosurface triangles, got ${waterMesh.vertexCount} verts`,
  );
});

test('Unrestricted seed parameters support arbitrary extreme radii (2m & 150m), TS2/TS1 decode, and scale-invariant SPH fluid', () => {
  // Tiny 2.0m micro-asteroid with 12 craters and unrestricted amplitudes
  const tinyCfg = {
    ...DEFAULT_SEED_CONFIG,
    seed: 9102,
    radius: 2.0,
    continentAmp: 0.35,
    ridgeAmp: 0.3,
    craterCount: 12,
    craterDepth: 0.5,
    waterFill: 1.0,
  };
  const tinyCode = encodeSeedCode(tinyCfg);
  assert.ok(tinyCode.startsWith('TS3|'), `Expected TS3| prefix, got ${tinyCode}`);
  const decodedTiny = decodeSeedCode(tinyCode);
  assert.ok(decodedTiny !== null);
  assert.equal(decodedTiny.radius, 2.0);
  assert.equal(decodedTiny.craterCount, 12);

  // Backwards-compatible TS2 and TS1 decode
  const ts2Decoded = decodeSeedCode('TS2|888|240|3.5|4.1|2.5|10|6.2|1.5|0.8|2.0|1');
  assert.ok(ts2Decoded !== null);
  assert.equal(ts2Decoded.radius, 240);
  assert.equal(ts2Decoded.voxelRadius, 18);

  const legacyDecoded = decodeSeedCode('TS1-888-240-3.5-4.1-2.5-10-6.2-1.5-0.8-2.0-1');
  assert.ok(legacyDecoded !== null);
  assert.equal(legacyDecoded.radius, 240);
  assert.equal(legacyDecoded.craterCount, 10);

  const tinyPlanet = new VoxelPlanet(tinyCfg);
  assert.ok(tinyPlanet.worldHalf < 4.5, `Expected tiny worldHalf < 4.5m, got ${tinyPlanet.worldHalf}`);
  const tinySpawnR = Math.hypot(...tinyPlanet.spawnPosition);
  assert.ok(tinySpawnR > 1.5 && tinySpawnR < 3.5, `Expected tiny spawnR ~2.2m, got ${tinySpawnR}`);

  const tinyFluid = new FluidSim();
  tinyFluid.seedInitialLakes(tinyPlanet);
  assert.ok(tinyFluid.activeCount > 100);
  const tinyGrav = { referenceRadius: tinyPlanet.baseRadius, surfaceGravity: EARTH_SURFACE_GRAVITY };
  for (let i = 0; i < 15; i++) {
    tinyFluid.step(1 / 60, tinyPlanet, tinyGrav, 2);
  }
  const tinyWater = tinyFluid.extractWaterSurface(tinyPlanet);
  assert.ok(tinyWater.vertexCount > 100, 'Expected valid water surface on 2m planet');

  // Giant 150.0m super-planet
  const giantCfg = {
    ...DEFAULT_SEED_CONFIG,
    seed: 4411,
    radius: 150.0,
    continentAmp: 18.0,
    ridgeAmp: 22.0,
    craterCount: 8,
    craterDepth: 25.0,
    waterFill: 1.0,
  };
  const giantPlanet = new VoxelPlanet(giantCfg);
  assert.ok(giantPlanet.worldHalf > 220, `Expected giant worldHalf > 220m, got ${giantPlanet.worldHalf}`);
  const giantSpawnR = Math.hypot(...giantPlanet.spawnPosition);
  assert.ok(giantSpawnR > 130 && giantSpawnR < 210, `Expected giant spawnR ~160m, got ${giantSpawnR}`);

  const giantFluid = new FluidSim();
  giantFluid.seedInitialLakes(giantPlanet);
  const giantGrav = { referenceRadius: giantPlanet.baseRadius, surfaceGravity: EARTH_SURFACE_GRAVITY };
  for (let i = 0; i < 10; i++) {
    giantFluid.step(1 / 60, giantPlanet, giantGrav, 2);
  }
  const giantWater = giantFluid.extractWaterSurface(giantPlanet);
  assert.ok(giantWater.vertexCount > 100, 'Expected valid water surface on 150m planet');
});

import { DEFAULT_ATMOS_CONFIG, sampleAtmosphereAtPoint } from './atmosphere';
import { DEFAULT_THERMAL_CONFIG, sampleThermalField, temperatureToRgb } from './thermal';
import {
  buildPlanetarySurfaceAtlas,
  lonLatToDir,
  MapProjection,
  projectLonLatToUV,
  renderCrossSectionImageData,
  renderPlanarMapImageData,
  unprojectUVToLonLat,
} from './cartography';

test('Blocky voxel cube extraction emits outward faces, UVs [0..1], and scales monotonically with LOD', () => {
  const planet = new VoxelPlanet(202611);
  const countBlockyVerts = (lod: 0 | 1 | 2) => {
    let verts = 0;
    let validUV = true;
    for (let cz = 0; cz < planet.chunksPerAxis; cz++) {
      for (let cy = 0; cy < planet.chunksPerAxis; cy++) {
        for (let cx = 0; cx < planet.chunksPerAxis; cx++) {
          const m = planet.extractBlockyChunkMesh(cx, cy, cz, lod);
          verts += m.vertexCount;
          if (m.vertexCount > 0 && lod === 0) {
            if (m.uvs.length !== m.vertexCount * 2) validUV = false;
            // Verify vertex normals point along canonical cube axes
            for (let i = 0; i < Math.min(30, m.vertexCount); i++) {
              const nMag = Math.hypot(
                m.normals[i * 3],
                m.normals[i * 3 + 1],
                m.normals[i * 3 + 2],
              );
              if (Math.abs(nMag - 1) > 1e-4) validUV = false;
            }
          }
        }
      }
    }
    return { verts, validUV };
  };

  const b0 = countBlockyVerts(0);
  const b1 = countBlockyVerts(1);
  const b2 = countBlockyVerts(2);
  assert.equal(b0.validUV, true);
  assert.ok(b0.verts > b1.verts, `Expected blocky LOD0 (${b0.verts}) > LOD1 (${b1.verts})`);
  assert.ok(b1.verts > b2.verts, `Expected blocky LOD1 (${b1.verts}) > LOD2 (${b2.verts})`);
  assert.ok(b2.verts > 200, `Expected valid blocky LOD2 shell (${b2.verts} verts)`);

  // Also test blocky SPH fluid cube meshing
  const fluid = new FluidSim();
  fluid.seedInitialLakes(planet);
  const blockyWater = fluid.extractWaterSurface(planet, true);
  assert.ok(blockyWater.vertexCount > 100, 'Expected valid blocky SPH water cubes');
});

test('Atmospheric simulation obeys barometric scale height, vacuum toggle, and Coriolis winds', () => {
  const r0 = DEFAULT_PLANET_RADIUS;
  const surface = sampleAtmosphereAtPoint(r0, 0, 0, r0, DEFAULT_ATMOS_CONFIG, 12.0);
  const highAlt = sampleAtmosphereAtPoint(r0 * 1.4, 0, 0, r0, DEFAULT_ATMOS_CONFIG, 12.0);

  assert.ok(Math.abs(surface.pressureAtm - DEFAULT_ATMOS_CONFIG.surfacePressureAtm) < 0.05);
  assert.ok(highAlt.pressureAtm < surface.pressureAtm * 0.25, 'Pressure must decay exponentially with altitude');
  assert.ok(surface.windSpeedMs > 0.1, 'Planetary atmosphere must generate Coriolis zonal winds');

  const vacuum = sampleAtmosphereAtPoint(
    r0,
    0,
    0,
    r0,
    { ...DEFAULT_ATMOS_CONFIG, enabled: false },
    12.0,
  );
  assert.equal(vacuum.pressureAtm, 0);
  assert.equal(vacuum.cloudDensity, 0);
});

test('3D Thermal field couples solar incidence, latitude, lapse rate, and geothermal core conduction', () => {
  const r0 = DEFAULT_PLANET_RADIUS;
  const sunDir: [number, number, number] = [1, 0, 0];

  const daysideEq = sampleThermalField(r0, 0, 0, r0, sunDir, DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);
  const nightsideEq = sampleThermalField(-r0, 0, 0, r0, sunDir, DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);
  const northPole = sampleThermalField(0, r0, 0, r0, sunDir, DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);
  const highAltitude = sampleThermalField(r0 * 1.35, 0, 0, r0, sunDir, DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);
  const deepCore = sampleThermalField(r0 * 0.15, 0, 0, r0, sunDir, DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);

  assert.ok(daysideEq.tempC > nightsideEq.tempC, `Dayside (${daysideEq.tempC}) must exceed nightside (${nightsideEq.tempC})`);
  assert.ok(daysideEq.tempC > northPole.tempC, `Equator (${daysideEq.tempC}) must exceed pole (${northPole.tempC})`);
  assert.ok(daysideEq.tempC > highAltitude.tempC, `Surface (${daysideEq.tempC}) must exceed high altitude (${highAltitude.tempC})`);
  assert.ok(deepCore.tempC > 400, `Deep core (${deepCore.tempC}°C) must reflect geothermal heating`);
  assert.equal(deepCore.regime, '地热熔岩带');

  const rgbCold = temperatureToRgb(-60);
  const rgbHot = temperatureToRgb(600);
  assert.ok(rgbCold[2] > rgbCold[0], 'Cryogenic temperatures map to cool blue');
  assert.ok(rgbHot[0] > rgbHot[2], 'Geothermal core temperatures map to warm red/yellow');
});

test('Cartographic projections round-trip cleanly and planetary atlas / cross-section render valid RGBA buffers', () => {
  const projections: MapProjection[] = [
    'equirectangular',
    'mollweide',
    'mercator',
    'polar',
    'orthographic',
  ];

  const testLon = 0.52;
  const testLat = 0.38;
  for (const proj of projections) {
    const uv = projectLonLatToUV(testLon, testLat, proj, 0, 0);
    assert.ok(uv !== null, `Expected valid UV for ${proj}`);
    const back = unprojectUVToLonLat(uv.u, uv.v, proj, 0, 0);
    assert.ok(back !== null, `Expected valid inverse lon/lat for ${proj}`);
    const [dx1, dy1, dz1] = lonLatToDir(testLon, testLat);
    const [dx2, dy2, dz2] = lonLatToDir(back.lonRad, back.latRad);
    const dot = dx1 * dx2 + dy1 * dy2 + dz1 * dz2;
    assert.ok(dot > 0.998, `Projection ${proj} round-trip direction mismatch (dot=${dot})`);
  }

  const planet = new VoxelPlanet(202611);
  const fluid = new FluidSim();
  fluid.seedInitialLakes(planet);
  const atlas = buildPlanetarySurfaceAtlas(planet, fluid, 48, 24);
  assert.equal(atlas.surfaceRadius.length, 48 * 24);

  const mapPixels = renderPlanarMapImageData(80, 40, {
    mode: 'geology',
    projection: 'mollweide',
    atlas,
    sunDir: [1, 0, 0],
    atmosCfg: DEFAULT_ATMOS_CONFIG,
    thermalCfg: DEFAULT_THERMAL_CONFIG,
    simTimeSec: 0,
    centerLonDeg: 0,
    centerLatDeg: 0,
  });
  assert.equal(mapPixels.length, 80 * 40 * 4);

  const section = renderCrossSectionImageData(64, 64, {
    plane: 'xy',
    azimuthDeg: 25,
    offsetRatio: 0,
    showThermalOverlay: true,
    planet,
    fluid,
    sunDir: [1, 0, 0],
    atmosCfg: DEFAULT_ATMOS_CONFIG,
    thermalCfg: DEFAULT_THERMAL_CONFIG,
    simTimeSec: 0,
  });
  assert.equal(section.pixels.length, 64 * 64 * 4);
  assert.equal(section.radialElevProfile.length, 180);
  assert.equal(section.radialTempProfile.length, 180);
});

test('Ultra-high voxel resolution (voxelRadius=20000) streams sparse chunks, sculpts single blocks, and persists editedChunks', () => {
  const hiCfg = {
    ...DEFAULT_SEED_CONFIG,
    seed: 99123,
    radius: 20.0,
    voxelRadius: 20000,
  };
  const code = encodeSeedCode(hiCfg);
  assert.ok(code.startsWith('TS3|'));
  const decoded = decodeSeedCode(code);
  assert.ok(decoded !== null && decoded.voxelRadius === 20000);

  const planet = new VoxelPlanet(hiCfg);
  assert.equal(planet.isHighResStreaming, true);
  assert.ok(Math.abs(planet.nativeVoxelSize - 0.001) < 1e-6);

  const stats = planet.getVoxelStats();
  assert.equal(stats.voxelRadius, 20000);
  assert.equal(stats.isSparseStreaming, true);
  assert.ok(stats.virtualCellsPerAxis >= 60000);

  // Stream around actual surface hit point in smooth and blocky modes
  const [sx, sy, sz] = planet.spawnPosition;
  const sLen = Math.hypot(sx, sy, sz);
  const hit = planet.raycastTerrain(sx, sy, sz, -sx / sLen, -sy / sLen, -sz / sLen, 10);
  assert.equal(hit.hit, true);

  let nonEmpty = 0;
  for (let pass = 0; pass < 4; pass++) {
    const batch = planet.streamHighResAround(hit.x, hit.y, hit.z, 'blocky', 48);
    assert.equal(batch.active, true);
    for (const m of batch.rebuiltMeshes) {
      if (m.mesh.vertexCount > 0) nonEmpty++;
    }
  }
  assert.ok(planet.sparseChunks.size > 0, 'Expected sparse chunks streamed');
  assert.ok(nonEmpty > 0, 'Expected non-empty blocky high-res surface chunks');

  // Sculpt single crystal tower at fine brush radius inside streamed native chunks
  const fineHit = planet.raycastTerrain(sx, sy, sz, -sx / sLen, -sy / sLen, -sz / sLen, 10);
  assert.equal(fineHit.hit, true);

  const bx = fineHit.x + fineHit.nx * 0.004;
  const by = fineHit.y + fineHit.ny * 0.004;
  const bz = fineHit.z + fineHit.nz * 0.004;
  planet.applyBrush(bx, by, bz, 'build', 0.006, 3.0, MaterialId.Crystal);

  const editedCount = Array.from(planet.sparseChunks.values()).filter((c) => c.edited).length;
  assert.ok(editedCount >= 1, 'Fine brush must mark native sparse chunks as edited');
  assert.ok(planet.sampleDensity(bx, by, bz) > 0, 'Built fine crystal spire must be solid');
  assert.equal(planet.sampleNearestMaterial(bx, by, bz), MaterialId.Crystal);

  // Verify snapshot preserves sparse edited chunks
  const snap = planet.exportSnapshot();
  assert.ok(snap.editedChunks && snap.editedChunks.length === editedCount);
  const restored = new VoxelPlanet(1);
  restored.importSnapshot(snap);
  assert.equal(restored.voxelRadius, 20000);
  assert.equal(restored.sampleNearestMaterial(bx, by, bz), MaterialId.Crystal);
});

test('Deferred VoxelPlanet skipGenerate + generatePlanetAsync + FluidSim.seedInitialLakesAsync match sync results without blocking', async () => {
  const deferred = new VoxelPlanet(482910, { skipGenerate: true });
  assert.equal(deferred.hasGenerated, false);

  const slices: number[] = [];
  const okVoxel = await deferred.generatePlanetAsync(
    { ...DEFAULT_SEED_CONFIG, seed: 482910, radius: 14.5 },
    (fraction) => slices.push(fraction),
  );
  assert.equal(okVoxel, true);
  assert.equal(deferred.hasGenerated, true);
  assert.ok(slices.length >= 1 && slices[slices.length - 1] === 1);

  const fluid = new FluidSim();
  const fluidSteps: number[] = [];
  const okFluid = await fluid.seedInitialLakesAsync(deferred, (f) => fluidSteps.push(f));
  assert.equal(okFluid, true);
  assert.ok(fluid.activeCount > 300);
  assert.ok(fluidSteps.length >= 1 && fluidSteps[fluidSteps.length - 1] === 1);
});

test('Dynamic macro grid scales full-planet resolution (voxelRadius=32) and snapshot resizes cleanly', () => {
  const base18 = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 314159, voxelRadius: 18 });
  const med32 = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 314159, voxelRadius: 32 });

  assert.equal(base18.chunksPerAxis, 7);
  assert.equal(base18.cellsPerAxis, 56);
  assert.ok(med32.chunksPerAxis >= 12, `Expected >= 12 chunks/axis at res=32, got ${med32.chunksPerAxis}`);
  assert.ok(med32.cellsPerAxis >= 96, `Expected >= 96 cells/axis at res=32, got ${med32.cellsPerAxis}`);
  assert.equal(med32.isHighResStreaming, false);

  let verts18 = 0;
  for (let cz = 0; cz < base18.chunksPerAxis; cz++) {
    for (let cy = 0; cy < base18.chunksPerAxis; cy++) {
      for (let cx = 0; cx < base18.chunksPerAxis; cx++) {
        verts18 += base18.extractBlockyChunkMesh(cx, cy, cz, 0).vertexCount;
      }
    }
  }
  let verts32 = 0;
  for (let cz = 0; cz < med32.chunksPerAxis; cz++) {
    for (let cy = 0; cy < med32.chunksPerAxis; cy++) {
      for (let cx = 0; cx < med32.chunksPerAxis; cx++) {
        verts32 += med32.extractBlockyChunkMesh(cx, cy, cz, 0).vertexCount;
      }
    }
  }
  assert.ok(verts32 > verts18 * 2.2, `Expected full-globe blocky vertex count at res=32 (${verts32}) >> res=18 (${verts18})`);

  // Snapshot created at 105^3 must restore cleanly into a default 57^3 instance
  const snap = med32.exportSnapshot();
  const target = new VoxelPlanet(1);
  target.importSnapshot(snap);
  assert.equal(target.cellsPerAxis, med32.cellsPerAxis);
  assert.equal(target.chunksPerAxis, med32.chunksPerAxis);
  assert.equal(target.density.length, med32.density.length);
});

test('High-res planets exceed 160³ limit natively (voxelRadius=64->200³, 96->296³) and stream full visible cap at 512', () => {
  const hi64 = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 808123, voxelRadius: 64 });
  assert.equal(hi64.chunksPerAxis, 25);
  assert.equal(hi64.cellsPerAxis, 200);
  assert.equal(hi64.isHighResStreaming, false);

  const hi96 = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 808123, voxelRadius: 96 });
  assert.equal(hi96.chunksPerAxis, 37);
  assert.equal(hi96.cellsPerAxis, 296);
  assert.equal(hi96.isHighResStreaming, false);

  let verts64 = 0;
  for (let cz = 0; cz < hi64.chunksPerAxis; cz++) {
    for (let cy = 0; cy < hi64.chunksPerAxis; cy++) {
      for (let cx = 0; cx < hi64.chunksPerAxis; cx++) {
        if (hi64.nonUniformChunks[hi64.chunkIndex(cx, cy, cz)] === 0) continue;
        verts64 += hi64.extractBlockyChunkMesh(cx, cy, cz, 0).vertexCount;
      }
    }
  }
  assert.ok(verts64 > 180000, `Expected dense native 200³ blocky surface verts (>180k), got ${verts64}`);

  const hi512 = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 808123, voxelRadius: 512 });
  assert.equal(hi512.chunksPerAxis, 24);
  assert.equal(hi512.cellsPerAxis, 192);
  assert.equal(hi512.isHighResStreaming, true);
  const surfR512 = hi512.findSurfaceRadiusAlongRay(0, 1, 0);
  const tiersBuilt = new Set<string>();
  let nonEmptyHemi = 0;
  let lastDiscard = 0;
  for (let pass = 0; pass < 50; pass++) {
    const batch = hi512.streamHighResAround(0, surfR512, 0, 'blocky', 48, 22);
    assert.equal(batch.active, true);
    for (const m of batch.rebuiltMeshes) {
      if (m.mesh.vertexCount > 0) {
        tiersBuilt.add(m.tier);
        if (m.tier === 'hemi') nonEmptyHemi++;
      }
    }
    lastDiscard = batch.hemiDiscardRadius;
    if (batch.pendingTotal === 0) break;
  }
  assert.ok(nonEmptyHemi > 200, `Expected high-density visible cap chunks (>200), got ${nonEmptyHemi}`);
  assert.ok(lastDiscard > hi512.baseRadius * 0.8, `Expected hemisphere discard radius > 0.8*R, got ${lastDiscard}`);
  assert.ok(
    tiersBuilt.has('hemi') && tiersBuilt.has('mid') && tiersBuilt.has('native'),
    `Expected hemi/mid/native tiers, got ${Array.from(tiersBuilt).join(',')}`,
  );
});

test('Full 360° SVO scales past 1,000,000,000³ (voxelRadius=500M -> 1.54B³), covers all 6 directions, and streams 1:1 native blocks', () => {
  const ultraCfg = {
    ...DEFAULT_SEED_CONFIG,
    seed: 998877,
    radius: 13.0,
    voxelRadius: 500_000_000,
  };
  const code = encodeSeedCode(ultraCfg);
  assert.ok(code.startsWith('TS3|'));
  const decoded = decodeSeedCode(code);
  assert.ok(decoded !== null && decoded.voxelRadius === 500_000_000);

  const planet = new VoxelPlanet(ultraCfg);
  assert.equal(planet.isHighResStreaming, true);
  assert.ok(
    planet.fullCellsPerAxis > 1_000_000_000,
    `Expected fullCellsPerAxis > 1,000,000,000, got ${planet.fullCellsPerAxis}`,
  );
  assert.ok(planet.octreeDepth >= 28, `Expected octreeDepth >= 28, got ${planet.octreeDepth}`);
  assert.equal(planet.chunksPerAxis, 24);

  const stats = planet.getVoxelStats();
  assert.equal(stats.fullCellsPerAxis, planet.fullCellsPerAxis);
  assert.equal(stats.virtualCellsPerAxis, planet.fullCellsPerAxis);
  assert.ok(stats.fullTotalVoxelsLabel.includes('10^27'));

  // 1. Verify full 360° coverage around the sphere (globe + hemi tiers close all 6 cardinal hemispheres)
  const surfY = planet.findSurfaceRadiusAlongRay(0, 1, 0);
  let dirFlags = { posX: 0, negX: 0, posY: 0, negY: 0, posZ: 0, negZ: 0 };
  let lastBatch = planet.streamHighResAround(0, surfY, 0, 'blocky', 48, 28);
  const allRebuilt = [...lastBatch.rebuiltMeshes];
  for (let pass = 0; pass < 60 && lastBatch.pendingTotal > 0; pass++) {
    lastBatch = planet.streamHighResAround(0, surfY, 0, 'blocky', 48, 28);
    allRebuilt.push(...lastBatch.rebuiltMeshes);
  }
  assert.equal(lastBatch.globeBuiltComplete, true, 'Full 360° globe+hemi shell should complete');
  assert.equal(lastBatch.hideMacro, true, 'Macro fallback must hide once full 360° sparse octree is built');

  for (const item of allRebuilt) {
    if (item.mesh.vertexCount === 0 || !item.mesh.origin) continue;
    const ox = item.mesh.origin[0] + item.mesh.positions[0];
    const oy = item.mesh.origin[1] + item.mesh.positions[1];
    const oz = item.mesh.origin[2] + item.mesh.positions[2];
    if (ox > 1) dirFlags.posX++;
    if (ox < -1) dirFlags.negX++;
    if (oy > 1) dirFlags.posY++;
    if (oy < -1) dirFlags.negY++;
    if (oz > 1) dirFlags.posZ++;
    if (oz < -1) dirFlags.negZ++;
  }
  assert.ok(
    dirFlags.posX > 0 &&
      dirFlags.negX > 0 &&
      dirFlags.posY > 0 &&
      dirFlags.negY > 0 &&
      dirFlags.posZ > 0 &&
      dirFlags.negZ > 0,
    `Expected full 360° surface coverage across ±X/±Y/±Z, got ${JSON.stringify(dirFlags)}`,
  );

  // 2. Verify zoomed-in cascade streams midOuter, mid, and 1:1 native blocks with chunk-local coords
  const [sx, sy, sz] = planet.spawnPosition;
  const sLen = Math.hypot(sx, sy, sz);
  const hit = planet.raycastTerrain(sx, sy, sz, -sx / sLen, -sy / sLen, -sz / sLen, 10);
  assert.equal(hit.hit, true, 'Adaptive sphere-assisted raycast must hit 1.54B³ surface cleanly');

  const zoomTiers = new Set<string>();
  let nativeMeshOriginOk = false;
  for (let pass = 0; pass < 30; pass++) {
    const zb = planet.streamHighResAround(hit.x, hit.y, hit.z, 'blocky', 48, 0.0001);
    for (const item of zb.rebuiltMeshes) {
      if (item.mesh.vertexCount > 0) {
        zoomTiers.add(item.tier);
        if (item.tier === 'native' && item.mesh.origin) {
          const span = 8 * planet.nativeVoxelSize;
          const lx = item.mesh.positions[0];
          const ly = item.mesh.positions[1];
          const lz = item.mesh.positions[2];
          if (
            lx >= -1e-9 &&
            lx <= span + 1e-9 &&
            ly >= -1e-9 &&
            ly <= span + 1e-9 &&
            lz >= -1e-9 &&
            lz <= span + 1e-9
          ) {
            nativeMeshOriginOk = true;
          }
        }
      }
    }
    if (zb.pendingTotal === 0) break;
  }
  assert.ok(
    zoomTiers.has('midOuter') && zoomTiers.has('mid') && zoomTiers.has('native'),
    `Expected midOuter/mid/native zoom cascade at 1.54B³, got ${Array.from(zoomTiers).join(',')}`,
  );
  assert.equal(nativeMeshOriginOk, true, '1:1 native sparse chunk must emit chunk-local coordinates + origin');

  // 3. Sculpt 1:1 sub-micron crystal block & verify snapshot persistence
  const bx = hit.x + hit.nx * planet.nativeVoxelSize * 2.5;
  const by = hit.y + hit.ny * planet.nativeVoxelSize * 2.5;
  const bz = hit.z + hit.nz * planet.nativeVoxelSize * 2.5;
  planet.applyBrush(bx, by, bz, 'build', planet.nativeVoxelSize * 5, 3.0, MaterialId.Crystal);
  assert.equal(planet.sampleNearestMaterial(bx, by, bz), MaterialId.Crystal);

  const snap = planet.exportSnapshot();
  const restored = new VoxelPlanet(1);
  restored.importSnapshot(snap);
  assert.equal(restored.voxelRadius, 500_000_000);
  assert.ok(restored.fullCellsPerAxis > 1_000_000_000);
  assert.equal(restored.sampleNearestMaterial(bx, by, bz), MaterialId.Crystal);
});

test('Dyadic SVO partition is strictly non-overlapping, never flickers hideMacro on focus move, and emits seam sealing geometry', () => {
  const planet = new VoxelPlanet({
    ...DEFAULT_SEED_CONFIG,
    seed: 774411,
    radius: 13.0,
    voxelRadius: 512,
  });

  const surfY = planet.findSurfaceRadiusAlongRay(0, 1, 0);
  let lastBatch = planet.streamHighResAround(0, surfY, 0, 'smooth', 48, 22);
  for (let pass = 0; pass < 60 && lastBatch.pendingTotal > 0; pass++) {
    lastBatch = planet.streamHighResAround(0, surfY, 0, 'smooth', 48, 22);
  }
  assert.equal(lastBatch.globeBuiltComplete, true, 'SVO should converge completely at res=512');
  assert.equal(lastBatch.hideMacro, true, 'hideMacro must be true after root globe completes');

  // Verify strict non-overlapping dyadic partition invariant in desiredKeys
  const verifyNonOverlapping = (keys: Set<string>) => {
    const keySet = keys;
    for (const kStr of keySet) {
      const [smStr, coords] = kStr.split(':');
      const sm = Number(smStr);
      const [cx, cy, cz] = coords.split(',').map(Number);
      let ax = cx;
      let ay = cy;
      let az = cz;
      for (let asm = sm * 2; asm <= 1024; asm *= 2) {
        ax = Math.floor(ax / 2);
        ay = Math.floor(ay / 2);
        az = Math.floor(az / 2);
        const ancKey = `${asm}:${ax},${ay},${az}`;
        assert.equal(
          keySet.has(ancKey),
          false,
          `Overlapping SVO desiredKeys detected: ${kStr} and ancestor ${ancKey}`,
        );
      }
    }
  };

  verifyNonOverlapping(lastBatch.desiredKeys);
  assert.ok(lastBatch.desiredKeys.size > 100, 'Expected non-empty desiredKeys cut');

  // Move focus & camera to another hemisphere/direction and verify hideMacro stays true permanently
  const surfX = planet.findSurfaceRadiusAlongRay(1, 0, 0);
  const movedBatch = planet.streamHighResAround(surfX, 0, 0, 'blocky', 48, 12);
  assert.equal(movedBatch.globeBuiltComplete, true);
  assert.equal(movedBatch.hideMacro, true);
  verifyNonOverlapping(movedBatch.desiredKeys);

  // Verify seam-sealing emits extra geometry in both blocky (boundary caps) and smooth (skirts) modes
  let testChunk = null;
  for (const ch of planet.sparseChunks.values()) {
    if (!ch.isEmpty && ch.scaleMult <= 8) {
      testChunk = ch;
      break;
    }
  }
  assert.ok(testChunk !== null, 'Expected a non-empty surface sparse chunk');

  const smoothNoSeam = planet.extractSparseChunkMesh(testChunk!, false, 0);
  const smoothAllSeam = planet.extractSparseChunkMesh(testChunk!, false, 0b111111);
  assert.ok(
    smoothAllSeam.vertexCount > smoothNoSeam.vertexCount,
    `Expected smooth T-junction skirts to add vertices (${smoothAllSeam.vertexCount} > ${smoothNoSeam.vertexCount})`,
  );

  const blockyNoSeam = planet.extractSparseChunkMesh(testChunk!, true, 0);
  const blockyAllSeam = planet.extractSparseChunkMesh(testChunk!, true, 0b111111);
  assert.ok(
    blockyAllSeam.vertexCount > blockyNoSeam.vertexCount,
    `Expected blocky boundary caps to add vertices (${blockyAllSeam.vertexCount} > ${blockyNoSeam.vertexCount})`,
  );
});

test('Forced LOD 0 disables concentric LOD degradation across viewport and scales LOD 1/2 limits cleanly', () => {
  const planet = new VoxelPlanet({
    ...DEFAULT_SEED_CONFIG,
    seed: 512009,
    radius: 13.0,
    voxelRadius: 512,
  });
  const sy = planet.findSurfaceRadiusAlongRay(0, 1, 0);

  // Forced LOD 0 at close-up view (camDist=1.8m -> ~102 blocks across view < 360) must render 100% 1:1 native in viewport
  let batch;
  for (let pass = 0; pass < 70; pass++) {
    batch = planet.streamHighResAround(
      0,
      sy,
      0,
      'blocky',
      64,
      1.8,
      [0, sy + 1.8, 0],
      [0, -1, 0],
      { lodMode: 0, lod0Dist: 38 },
    );
    if (batch.pendingTotal === 0) break;
  }
  assert.ok(batch && batch.desiredKeys.size > 200);

  let nativeInView = 0;
  let coarserInView = 0;
  for (const key of batch!.desiredKeys) {
    const ch = planet.sparseChunks.get(key);
    if (!ch) continue;
    const cx = ch.originX + 4 * ch.stepSize;
    const cy = ch.originY + 4 * ch.stepSize;
    const cz = ch.originZ + 4 * ch.stepSize;
    if (Math.hypot(cx, cy - sy, cz) <= 1.8) {
      if (ch.scaleMult === 1) nativeInView++;
      else coarserInView++;
    }
  }
  assert.ok(nativeInView > 150, `Expected dense 1:1 native chunks filling viewport, got ${nativeInView}`);
  assert.equal(coarserInView, 0, `Expected zero coarser blocks inside LOD0 viewport, got ${coarserInView}`);

  // Verify LOD 2 mode constrains leaf granularity to scaleMult >= 4
  const planetLod2 = new VoxelPlanet({
    ...DEFAULT_SEED_CONFIG,
    seed: 512009,
    radius: 13.0,
    voxelRadius: 512,
  });
  let lod2Batch;
  for (let pass = 0; pass < 35; pass++) {
    lod2Batch = planetLod2.streamHighResAround(
      0,
      sy,
      0,
      'blocky',
      64,
      1.8,
      [0, sy + 1.8, 0],
      [0, -1, 0],
      { lodMode: 2, lod0Dist: 38 },
    );
    if (lod2Batch.pendingTotal === 0) break;
  }
  let minScaleSeen = Infinity;
  for (const key of lod2Batch!.desiredKeys) {
    const ch = planetLod2.sparseChunks.get(key);
    if (ch && ch.scaleMult < minScaleSeen) minScaleSeen = ch.scaleMult;
  }
  assert.ok(minScaleSeen >= 4, `Expected LOD 2 mode minimum scaleMult >= 4, got ${minScaleSeen}`);
});

test('Detail Camera optics prevent surface penetration, preserve depth precision, and Landing descent eases cleanly to touchdown', () => {
  const baseRadius = 13.0;
  const nativeVoxelSize = baseRadius / 500_000_000;

  // Even when zoomed to micron voxel spacing, physicalDist never collapses inside voxels
  const macroOpt = computeDetailCameraOptics(20.0, baseRadius, nativeVoxelSize, 55);
  assert.ok(Math.abs(macroOpt.fovDeg - 55) < 0.01);
  assert.ok(macroOpt.physicalDist >= macroOpt.effectiveStreamDist - 1e-9);

  const microOpt = computeDetailCameraOptics(nativeVoxelSize * 2, baseRadius, nativeVoxelSize, 55);
  assert.ok(
    microOpt.physicalDist >= baseRadius * 0.0015 - 1e-9,
    `Expected physical standoff >= surface safety floor, got ${microOpt.physicalDist}`,
  );
  assert.ok(
    microOpt.fovDeg < 15,
    `Expected telephoto FOV < 15° under extreme magnification, got ${microOpt.fovDeg}`,
  );
  assert.ok(
    microOpt.magnification > macroOpt.magnification * 100,
    `Expected substantial detail magnification, got ${microOpt.magnification}`,
  );
  assert.ok(
    microOpt.effectiveStreamDist <= nativeVoxelSize * 2.1,
    `Expected SVO stream distance to stay tied to zoom target, got ${microOpt.effectiveStreamDist}`,
  );

  // Depth-buffer clip planes must maintain safe far/near ratio (< 2.5e5) at telephoto micro standoff
  const clips = computeSafeClipPlanes(
    microOpt.physicalDist,
    microOpt.physicalDist,
    baseRadius,
    microOpt.fovDeg,
  );
  assert.ok(clips.near > 0 && clips.far > clips.near);
  assert.ok(
    clips.far / clips.near <= 2.5e5,
    `Expected safe 24-bit depth ratio far/near <= 2.5e5, got ${clips.far / clips.near}`,
  );

  // Landing descent eases monotonically from orbit pose down to eye height looking toward horizon
  const startPos: [number, number, number] = [0, 32, 18];
  const sitePos: [number, number, number] = [0, 13, 0];
  const endPos: [number, number, number] = [0, 14.65, 0];
  const endLook: [number, number, number] = [0, 14.65, -8];

  const p0 = evaluateLandingDescentPose(0, startPos, endPos, sitePos, endLook);
  assert.equal(p0.done, false);
  assert.deepEqual(p0.pos, startPos);
  assert.deepEqual(p0.look, sitePos);

  const pMid = evaluateLandingDescentPose(0.5, startPos, endPos, sitePos, endLook);
  assert.equal(pMid.done, false);
  // Cubic ease-out at t=0.5 reaches 87.5% of trajectory while look begins sweeping toward horizon
  assert.ok(pMid.pos[1] < 18 && pMid.pos[1] > 14.65);

  const pEnd = evaluateLandingDescentPose(1.0, startPos, endPos, sitePos, endLook);
  assert.equal(pEnd.done, true);
  assert.deepEqual(pEnd.pos, endPos);
  assert.deepEqual(pEnd.look, endLook);
});

test('Spherical camera parallel transport, radial jitter stabilizer, and core up-guard remain jitter-free across axes and planet center', () => {
  // Walk a great-circle trajectory passing directly across |up.x| = 0.85, (1,0,0), and poles (0,±1,0)
  let fwd: [number, number, number] = [0, 0, -1];
  const steps = 180;
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    // Tilted great circle hitting both X-axis (±1,0,0) and high Y/Z latitudes
    const up: [number, number, number] = [
      Math.cos(theta),
      Math.sin(theta) * 0.72,
      Math.sin(theta) * 0.694,
    ];
    const basis = transportCameraForwardOnSphere(up, fwd, 0.01);
    const fLen = Math.hypot(basis.forward[0], basis.forward[1], basis.forward[2]);
    const rLen = Math.hypot(basis.right[0], basis.right[1], basis.right[2]);
    assert.ok(Math.abs(fLen - 1) < 1e-5, `forward not unit: ${fLen}`);
    assert.ok(Math.abs(rLen - 1) < 1e-5, `right not unit: ${rLen}`);

    const uLen = Math.hypot(up[0], up[1], up[2]);
    const dotFU =
      (basis.forward[0] * up[0] + basis.forward[1] * up[1] + basis.forward[2] * up[2]) / uLen;
    assert.ok(Math.abs(dotFU) < 1e-5, `forward not tangent to sphere: ${dotFU}`);

    // Continuity check: adjacent steps never snap or flip (dot > 0.96 even with small yaw + curve step)
    const dotStep =
      basis.forward[0] * fwd[0] + basis.forward[1] * fwd[1] + basis.forward[2] * fwd[2];
    assert.ok(dotStep > 0.96, `Camera forward discontinuity detected at step ${i}: dot=${dotStep}`);
    fwd = basis.forward;
  }

  // Radial stabilizer damps high-frequency vertical ground bumps while tracking horizontal movement closely
  const prevAnchor: [number, number, number] = [0, 14.0, 0];
  const bumpedTarget: [number, number, number] = [1.0, 14.5, 0];
  const damped = stabilizeRadialAnchor(prevAnchor, bumpedTarget, [0, 1, 0], 0.2, 0.9);
  assert.ok(Math.abs(damped[0] - 0.9) < 1e-6, `Expected fast tangent tracking ~0.9, got ${damped[0]}`);
  assert.ok(Math.abs(damped[1] - 14.1) < 1e-6, `Expected damped radial tracking ~14.1, got ${damped[1]}`);

  // Core up-guard freezes up vector inside tunnel core (r < guard) and recovers outside
  const lockedCore = resolveSphericalCoreUp([0.05, -0.02, 0.01], [0, 1, 0], 0.85);
  assert.deepEqual(lockedCore, [0, 1, 0]);
  const outsideCore = resolveSphericalCoreUp([0, -5, 0], [0, 1, 0], 0.85);
  assert.ok(outsideCore[1] < -0.99);
});

test('Through-planet laser/tunnel piercing punches clean tunnels through core on macro and >1B^3 SVO worlds, plus paint, extrude, and drain', () => {
  // 1. Macro grid through-planet piercing
  const macro = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, voxelRadius: 18, radius: 13 });
  const R = macro.baseRadius;
  const solidBefore = macro.sampleDensity(0, 0, 0);
  assert.ok(solidBefore > 0, `Planet core should initially be solid, got ${solidBefore}`);

  macro.applyBrush(0, R + 2, 0, 'laser', 2.4, 2.2, MaterialId.Air, {
    ex: 0,
    ey: -R - 2,
    ez: 0,
    shape: 'cylinder',
  });

  assert.ok(macro.sampleDensity(0, 0, 0) < 0, 'Core center should be carved hollow by through-planet laser');
  assert.ok(macro.sampleDensity(0, R, 0) < 0, 'North entry should be carved');
  assert.ok(macro.sampleDensity(0, -R, 0) < 0, 'South antipode exit should be carved');

  const rayThrough = macro.raycastTerrain(0, R + 5, 0, 0, -1, 0, R * 3.5);
  assert.equal(rayThrough.hit, false, 'Raycast straight down pierced bore axis should pass completely through planet');

  // 2. Paint preserves density while changing surface material; extrude builds rock outward
  const px = R;
  const py = 0;
  const pz = 0;
  const surfaceHit = macro.raycastTerrain(R + 8, 0, 0, -1, 0, 0, 20);
  assert.equal(surfaceHit.hit, true);
  const densBeforePaint = macro.sampleDensity(surfaceHit.x, surfaceHit.y, surfaceHit.z);
  macro.applyBrush(surfaceHit.x, surfaceHit.y, surfaceHit.z, 'paint', 2.0, 1.0, MaterialId.Crystal);
  const densAfterPaint = macro.sampleDensity(surfaceHit.x, surfaceHit.y, surfaceHit.z);
  assert.ok(Math.abs(densAfterPaint - densBeforePaint) < 1e-4, 'Paint tool must not deform terrain density');

  // Sample slightly inside surface after paint to check crystal material
  const innerMat = macro.sampleNearestMaterial(
    surfaceHit.x - surfaceHit.nx * 0.4,
    surfaceHit.y - surfaceHit.ny * 0.4,
    surfaceHit.z - surfaceHit.nz * 0.4,
  );
  assert.equal(innerMat, MaterialId.Crystal, 'Paint tool should repaint subsurface material to Crystal');

  // Extrude adds solid rock outside the previous surface
  const outX = px + 6;
  const probeOutX = surfaceHit.x + surfaceHit.nx * 1.1;
  const probeOutY = surfaceHit.y + surfaceHit.ny * 1.1;
  const probeOutZ = surfaceHit.z + surfaceHit.nz * 1.1;
  assert.ok(macro.sampleDensity(probeOutX, probeOutY, probeOutZ) < 0);
  macro.applyBrush(surfaceHit.x, surfaceHit.y, surfaceHit.z, 'extrude', 2.2, 2.0, MaterialId.Basalt, {
    ex: surfaceHit.x + surfaceHit.nx * 2.5,
    ey: surfaceHit.y + surfaceHit.ny * 2.5,
    ez: surfaceHit.z + surfaceHit.nz * 2.5,
    shape: 'cylinder',
  });
  assert.ok(
    macro.sampleDensity(probeOutX, probeOutY, probeOutZ) > 0,
    `Extrude cylinder should add solid rock beyond surface (probe=${outX})`,
  );

  // 3. FluidSim.drainWithinRadius removes only nearby fluid
  const fluid = new FluidSim();
  fluid.spawnParticle(0, R + 1, 0);
  fluid.spawnParticle(0.5, R + 1, 0);
  fluid.spawnParticle(0, -R - 1, 0);
  const drained = fluid.drainWithinRadius(0, R + 1, 0, 2.0);
  assert.equal(drained, 2);
  assert.equal(fluid.activeCount, 1);

  // 4. High-res (>1B^3) SVO tunnel core piercing & interior mesh generation
  const svoPlanet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, voxelRadius: 512, radius: 13 });
  svoPlanet.applyBrush(0, 15, 0, 'tunnel', 2.4, 2.4, MaterialId.Air, {
    ex: 0,
    ey: -15,
    ez: 0,
    shape: 'cylinder',
  });
  assert.ok(svoPlanet.sampleDensity(0, 0, 0) < 0, 'SVO planet core should be hollow inside tunnel');
  assert.ok(svoPlanet.sampleDensity(2.6, 0, 0) > 0, 'SVO planet core outside tunnel wall stays solid');

  // Stream SVO chunks directly around the core (0,0,0) and confirm tunnel walls emit triangles
  let coreVerts = 0;
  for (let pass = 0; pass < 12; pass++) {
    const batch = svoPlanet.streamHighResAround(0, 0, 0, 'smooth', 64, 4.0, [0, 0, 0], [0, -1, 0], {
      lodMode: 0,
      lod0Dist: 38,
    });
    for (const m of batch.rebuiltMeshes) {
      coreVerts += m.mesh.vertexCount;
    }
    if (batch.pendingTotal === 0) break;
  }
  assert.ok(coreVerts > 0, `Expected SVO core tunnel walls to generate mesh vertices near (0,0,0), got ${coreVerts}`);
});

test('Tool registry (30+ tools & custom creation), crater/volcano/quake/rimMaterial primitives, fluid impulses, and thermal hotspots', () => {
  // 1. Built-in tool catalog completeness & custom tool creation / overrides
  assert.ok(BUILTIN_TOOLS.length >= 30, `Expected at least 30 built-in tools, got ${BUILTIN_TOOLS.length}`);
  const requiredIds = [
    'megaLaser',
    'continuousLaser',
    'explosion',
    'burn',
    'magma',
    'lightning',
    'meteor',
    'nuke',
    'worm',
  ];
  for (const id of requiredIds) {
    assert.ok(
      BUILTIN_TOOLS.some((t) => t.id === id),
      `Expected built-in tool '${id}' to exist in BUILTIN_TOOLS`,
    );
  }

  const customTool = createCustomToolTemplate('nuke', { name: '自定义聚变核弹' });
  assert.equal(customTool.isCustom, true);
  assert.equal(customTool.group, 'custom');
  assert.equal(customTool.name, '自定义聚变核弹');
  assert.equal(customTool.attributes.behavior, 'nuke');

  const resolvedOverridden = resolveToolDefinition(
    'megaLaser',
    [customTool],
    { megaLaser: { radiusMult: 3.1, thermalDeltaC: 2400 } },
  );
  assert.equal(resolvedOverridden.attributes.radiusMult, 3.1);
  assert.equal(resolvedOverridden.attributes.thermalDeltaC, 2400);

  const resolvedCustom = resolveToolDefinition(customTool.id, [customTool], {});
  assert.equal(resolvedCustom.id, customTool.id);
  assert.equal(resolvedCustom.name, '自定义聚变核弹');

  // 2. VoxelPlanet crater, volcano, quake & rimMaterial on macro grid
  const R = 13;
  const macro = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, voxelRadius: 32, radius: R });
  const surfaceHit = macro.raycastTerrain(0, R + 8, 0, 0, -1, 0, 20);
  assert.ok(surfaceHit.hit, 'Raycast should hit north pole surface');

  // Crater: hollows pit center while depositing floor & rim basalt
  macro.applyBrush(surfaceHit.x, surfaceHit.y, surfaceHit.z, 'crater', 3.2, 2.6, MaterialId.Basalt, {
    rimMaterial: MaterialId.Basalt,
    floorMaterial: MaterialId.Basalt,
  });
  const pitCheckY = surfaceHit.y + 0.1;
  assert.ok(macro.sampleDensity(surfaceHit.x, pitCheckY, surfaceHit.z) < 0, 'Crater should excavate pit center');

  // Laser with rimMaterial chars surrounding wall to Basalt
  const laserHit = macro.raycastTerrain(0, -R - 8, 0, 0, 1, 0, 20);
  assert.ok(laserHit.hit);
  macro.applyBrush(laserHit.x, laserHit.y, laserHit.z, 'laser', 1.5, 2.0, MaterialId.Air, {
    ex: laserHit.x,
    ey: laserHit.y + 6,
    ez: laserHit.z,
    shape: 'cylinder',
    rimMaterial: MaterialId.Basalt,
  });
  assert.ok(macro.sampleDensity(laserHit.x, laserHit.y + 2.0, laserHit.z) < 0, 'Laser channel should be hollowed');

  // Volcano at equatorial east pole builds a positive cone above surface
  const eastHit = macro.raycastTerrain(R + 8, 0, 0, -1, 0, 0, 20);
  assert.ok(eastHit.hit);
  const aboveVolcanoX = eastHit.x + 1.4;
  macro.applyBrush(eastHit.x, eastHit.y, eastHit.z, 'volcano', 3.0, 2.8, MaterialId.Basalt, {
    rimMaterial: MaterialId.Basalt,
  });
  assert.ok(
    macro.sampleDensity(aboveVolcanoX, eastHit.y, eastHit.z) > 0,
    'Volcano cone should raise solid terrain above original equator surface',
  );

  // Quake applies jagged displacement & preserves non-NaN density
  macro.applyBrush(0, 0, -R, 'quake', 3.5, 1.5, MaterialId.Stone);
  const quakeSample = macro.sampleDensity(0, 0, -R);
  assert.ok(Number.isFinite(quakeSample));

  // SVO (>1B^3) crater operation also records and hollows center
  const svo = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, voxelRadius: 512, radius: R });
  svo.applyBrush(0, R, 0, 'crater', 3.2, 2.8, MaterialId.Basalt, {
    rimMaterial: MaterialId.Basalt,
    floorMaterial: MaterialId.Basalt,
  });
  assert.ok(svo.sampleDensity(0, R + 0.2, 0) < 0, 'SVO crater pit center should be carved');

  // 3. FluidSim radial explosion impulse & swirl vortex
  const fluid = new FluidSim();
  fluid.spawnParticle(1.0, R + 1, 0, 0, 0, 0);
  const blasted = fluid.applyRadialImpulse(0, R + 1, 0, 4.0, 8.0, 3.0);
  assert.equal(blasted, 1);
  assert.ok(fluid.vx[0] > 0.5 && fluid.vy[0] > 0.5, 'Explosion impulse should accelerate fluid outward and upward');

  const swirled = fluid.applySwirlVortex(0, R + 1, 0, 0, 1, 0, 5.0, 6.0, 2.0);
  assert.equal(swirled, 1);
  assert.ok(Math.abs(fluid.vz[0]) > 0.1, 'Vortex should impart tangential swirl velocity around Y axis');

  // 4. Thermal hotspots heat the planetary field smoothly and decay
  const hotspots = [{ x: 0, y: R, z: 0, radius: 5.0, deltaC: 900, decayPerSec: 120 }];
  const deltaCenter = computeHotspotDeltaC(0, R, 0, hotspots);
  const deltaFar = computeHotspotDeltaC(0, -R, 0, hotspots);
  assert.ok(deltaCenter > 850);
  assert.equal(deltaFar, 0);

  const coolSample = sampleThermalField(0, R, 0, R, [0, 1, 0], DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG, 0, MaterialId.Soil, 0, 0);
  const hotSample = sampleThermalField(0, R, 0, R, [0, 1, 0], DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG, 0, MaterialId.Soil, 0, deltaCenter);
  assert.ok(hotSample.tempC > coolSample.tempC + 800);
  assert.equal(hotSample.regime, '地热熔岩带');
});

test('Director choreography (6K/165fps presets, micro-to-planet zoom, 360 orbit, surface flyover, keyframe spline) & WebM/TAR muxing', () => {
  // 1. Resolution (6K) & FPS (165) presets + frame count math
  const p6k = RESOLUTION_PRESETS.find((r) => r.id === '6k');
  const p6kDci = RESOLUTION_PRESETS.find((r) => r.id === '6k-dci');
  assert.ok(p6k && p6k.width === 5760 && p6k.height === 3240);
  assert.ok(p6kDci && p6kDci.width === 6144 && p6kDci.height === 3456);
  assert.ok(FPS_PRESETS.includes(165) && FPS_PRESETS.includes(240));

  const defaultPlan = createDefaultDirectorPlan();
  assert.equal(defaultPlan.width, 5760);
  assert.equal(defaultPlan.height, 3240);
  assert.equal(defaultPlan.fps, 165);
  assert.equal(computePlanFrameCount(defaultPlan), 6 * 165);

  const R = 13.0;
  const nativeVoxelSize = R / 500_000_000;
  const anchor: DirectorSceneAnchor = {
    baseRadius: R,
    nativeVoxelSize,
    targetPoint: [0, R, 0],
    targetNormal: [0, 1, 0],
    currentPos: [0, R * 2.5, 0],
    currentLookAt: [0, 0, 0],
    currentUp: [0, 1, 0],
    currentFovDeg: 52,
    sampleSurfaceRadius: (dx, dy, dz) => R + 0.4 * Math.sin(dx * 3 + dy * 2 - dz),
  };

  // 2. micro_to_planet: log-space streamDist strictly increases & transitions from telephoto micro to wide planet
  const microStart = evaluateDirectorPose(defaultPlan, 0, anchor);
  const microMid = evaluateDirectorPose(defaultPlan, 0.5, anchor);
  const microEnd = evaluateDirectorPose(defaultPlan, 1, anchor);

  assert.ok(
    microStart.streamDist <= nativeVoxelSize * 2.5,
    `Expected start streamDist near native voxel (~${nativeVoxelSize * 2}), got ${microStart.streamDist}`,
  );
  assert.ok(microMid.streamDist > microStart.streamDist * 100, 'Mid shot should pull far away from 1:1 voxel');
  assert.ok(microEnd.streamDist > R * 2.0, `Expected macro end distance > 2R, got ${microEnd.streamDist}`);
  assert.ok(microStart.fovDeg < 15, `Expected telephoto zoom at micro voxel end, got ${microStart.fovDeg}`);
  assert.ok(Math.abs(microEnd.fovDeg - defaultPlan.baseFovDeg) < 1.0);
  assert.ok(Math.abs(Math.hypot(...microMid.up) - 1) < 1e-4, 'Pose up vector must stay unit length');

  // 3. orbit_360: completes full 360° revolution back to same horizontal azimuth & sweeps sunlight
  const orbitPlan = { ...defaultPlan, action: 'orbit_360' as const, orbitSweepDeg: 360, sunSweepDeg: 90 };
  const orb0 = evaluateDirectorPose(orbitPlan, 0, anchor);
  const orbHalf = evaluateDirectorPose(orbitPlan, 0.5, anchor);
  const orb1 = evaluateDirectorPose(orbitPlan, 1, anchor);
  assert.ok(orb0.position[0] * orbHalf.position[0] + orb0.position[2] * orbHalf.position[2] < 0, 'Halfway through 360 orbit must be on opposite side');
  assert.ok(Math.hypot(orb0.position[0] - orb1.position[0], orb0.position[1] - orb1.position[1], orb0.position[2] - orb1.position[2]) < 1e-3, '360 orbit should close loop seamlessly');
  assert.equal(orb1.sunAzimuthDeltaDeg, 90);

  // 4. surface_flyover: maintains altitude clearance above sampled terrain height
  const flyPlan = { ...defaultPlan, action: 'surface_flyover' as const, planetEndDistMult: 1.35 };
  const flyPose = evaluateDirectorPose(flyPlan, 0.4, anchor);
  const dirLen = Math.hypot(...flyPose.position);
  const nx = flyPose.position[0] / dirLen;
  const ny = flyPose.position[1] / dirLen;
  const nz = flyPose.position[2] / dirLen;
  const groundR = anchor.sampleSurfaceRadius!(nx, ny, nz);
  assert.ok(dirLen > groundR + 1.0, `Expected flyover clearance above terrain (${groundR}), got r=${dirLen}`);

  // 5. keyframe_path: Catmull-Rom passes smoothly through captured keyframes
  const kfPlan = {
    ...defaultPlan,
    action: 'keyframe_path' as const,
    keyframes: [
      { id: '1', label: 'KF1', position: [0, 20, 0] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number], fovDeg: 40 },
      { id: '2', label: 'KF2', position: [20, 10, 10] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number], fovDeg: 55 },
      { id: '3', label: 'KF3', position: [0, 0, 25] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number], fovDeg: 65 },
    ],
  };
  const kfStart = evaluateDirectorPose(kfPlan, 0, anchor);
  const kfEnd = evaluateDirectorPose(kfPlan, 1, anchor);
  assert.ok(Math.hypot(kfStart.position[0] - 0, kfStart.position[1] - 20, kfStart.position[2] - 0) < 1e-4);
  assert.ok(Math.hypot(kfEnd.position[0] - 0, kfEnd.position[1] - 0, kfEnd.position[2] - 25) < 1e-4);

  // 6. WebmMuxer produces valid EBML + WebM VP9 container at 5760x3240 @ 165fps
  const muxer = new WebmMuxer({ width: 5760, height: 3240, fps: 165, codec: 'V_VP9' });
  const frameStepUs = 1_000_000 / 165;
  for (let i = 0; i < 6; i++) {
    const dummyChunk = new Uint8Array(64).fill(0x2a + i);
    muxer.addVideoChunk(dummyChunk, Math.round(i * frameStepUs), i % 3 === 0);
  }
  const webmBytes = muxer.finalize();
  // Starts with EBML Header ID 0x1A 0x45 0xDF 0xA3
  assert.deepEqual(Array.from(webmBytes.subarray(0, 4)), [0x1a, 0x45, 0xdf, 0xa3]);
  const ascii = new TextDecoder('latin1').decode(webmBytes);
  assert.ok(ascii.includes('webm'), 'WebM EBML DocType should be webm');
  assert.ok(ascii.includes('V_VP9'), 'WebM Tracks should declare V_VP9');
  assert.ok(webmBytes.length > 450, 'Muxed WebM output should contain header, tracks, and frame blocks');

  // 7. buildTarArchive emits 512-byte ustar aligned archive with EOF padding
  const tar = buildTarArchive([
    { name: 'frame_00001.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    { name: 'frame_00002.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]) },
  ]);
  assert.equal(tar.length % 512, 0);
  const tarHeaderText = new TextDecoder('latin1').decode(tar.subarray(0, 265));
  assert.ok(tarHeaderText.startsWith('frame_00001.png'));
  assert.ok(tarHeaderText.includes('ustar'));
});

test('Tractor Beam tool registry, ray/drag-plane math, Newtonian gravity load & sag coupling, and SPH tidal fluid stretch', () => {
  // 1. Tool registry & custom template support
  const tractorDef = BUILTIN_TOOLS.find((t) => t.id === 'tractorBeam');
  assert.ok(tractorDef, 'tractorBeam tool should be registered in BUILTIN_TOOLS');
  assert.equal(tractorDef.iconName, 'magnet');
  assert.equal(tractorDef.attributes.behavior, 'tractorBeam');
  const tractorPreset = TOOL_BEHAVIOR_PRESETS.find((p) => p.behavior === 'tractorBeam');
  assert.equal(tractorPreset?.defaultIcon, 'magnet');

  const customTractor = createCustomToolTemplate('tractorBeam', { name: '重型潮汐牵引器' });
  assert.equal(customTractor.attributes.behavior, 'tractorBeam');
  assert.equal(customTractor.isCustom, true);

  // 2. Ray-point proximity & camera drag plane intersection
  const rayHit = computeRayPointDistanceSq(0, 25, 0, 0, -1, 0, 1.2, 14, 0);
  assert.equal(rayHit.hit, true);
  assert.ok(Math.abs(rayHit.t - 11) < 1e-6);
  assert.ok(Math.abs(rayHit.distSq - 1.44) < 1e-6);

  const dragPt = { x: 0, y: 0, z: 0 };
  const planeOk = intersectCursorWithDragPlane(
    0,
    30,
    0,
    0.2,
    -1,
    0,
    0,
    15,
    0,
    0,
    -1,
    0,
    2,
    100,
    13,
    dragPt,
  );
  assert.equal(planeOk, true);
  assert.ok(Math.abs(dragPt.y - 15) < 1e-4);
  assert.ok(Math.abs(dragPt.x - 3.0) < 1e-4);

  // 3. Newtonian inverse-square & Shell Theorem load + realistic gravitational sag
  const R = DEFAULT_PLANET_RADIUS;
  const g1Params = { referenceRadius: R, surfaceGravity: EARTH_SURFACE_GRAVITY };
  const g0Params = { referenceRadius: R, surfaceGravity: 0 };
  const g3Params = { referenceRadius: R, surfaceGravity: EARTH_SURFACE_GRAVITY * 3 };

  const beamParams = {
    planetRadius: R,
    beamPower: 1.8,
    gravityCompFactor: 0.44,
    maxAccelG: 5.8,
    massKg: 2.0,
  };
  const out0 = { fx: 0, fy: 0, fz: 0, beamForceN: 0, gravityWeightN: 0, localGravityMs2: 0, loadRatio: 0, saturated: false };
  const out1 = { ...out0 };
  const out3 = { ...out0 };

  // At rest in equilibrium below target: 0g needs 0 force at target; 3g demands ~3x gravityWeightN than 1g
  computeTractorSpringForce(0, R, 0, 0, 0, 0, 0, R, 0, 0, 0, 0, g0Params, beamParams, 1.0, out0);
  assert.equal(out0.gravityWeightN, 0);
  assert.ok(out0.beamForceN < 1e-6);

  // Simulate steady hover integration under 0g vs 1g vs 3g toward target at (0, R + 3, 0)
  const simulateHoverY = (gp: { referenceRadius: number; surfaceGravity: number }) => {
    let py = R + 3;
    let vy = 0;
    const res = { ...out0 };
    const gv = { x: 0, y: 0, z: 0 };
    const dt = 0.015;
    for (let s = 0; s < 160; s++) {
      computeGravityVector(0, py, 0, gp, gv);
      computeTractorSpringForce(0, py, 0, 0, vy, 0, 0, R + 3, 0, 0, 0, 0, gp, beamParams, 1.0, res);
      vy += (gv.y + res.fy / beamParams.massKg) * dt;
      py += vy * dt;
    }
    return { steadyY: py, res };
  };

  const sim0 = simulateHoverY(g0Params);
  const sim1 = simulateHoverY(g1Params);
  const sim3 = simulateHoverY(g3Params);
  const sag0 = R + 3 - sim0.steadyY;
  const sag1 = R + 3 - sim1.steadyY;
  const sag3 = R + 3 - sim3.steadyY;
  assert.ok(Math.abs(sag0) < 1e-4, `Expected zero gravitational sag in 0g, got ${sag0}`);
  assert.ok(sag1 > 0.01, `Expected downward gravitational sag in 1g, got ${sag1}`);
  assert.ok(sag3 > sag1 * 2.2, `Expected 3g sag (${sag3}) > 2.2x 1g sag (${sag1})`);

  // Inverse-square weight attenuation at 2*R0 altitude vs surface R0, and Shell Theorem inside (0.5*R0)
  computeTractorSpringForce(0, R, 0, 0, 0, 0, 0, R, 0, 0, 0, 0, g1Params, beamParams, 1.0, out1);
  computeTractorSpringForce(0, R * 2, 0, 0, 0, 0, 0, R * 2, 0, 0, 0, 0, g1Params, beamParams, 1.0, out3);
  assert.ok(Math.abs(out3.gravityWeightN - out1.gravityWeightN / 4) < 1e-3, 'Gravity weight at 2*R0 must drop by 1/4');

  const outInner = { ...out0 };
  computeTractorSpringForce(0, R * 0.5, 0, 0, 0, 0, 0, R * 0.5, 0, 0, 0, 0, g1Params, beamParams, 1.0, outInner);
  assert.ok(Math.abs(outInner.gravityWeightN - out1.gravityWeightN * 0.5) < 1e-3, 'Shell theorem inside at 0.5*R0 halves weight');

  const escNear = summarizeEscapeStatus(0, R + 2, 0, computeEscapeVelocity(R + 2, g1Params) * 0.9, g1Params);
  assert.equal(escNear.nearEscape, true);

  // 4. Stretch interpolation + FluidSim real-time upward lifting, tidal elongation & release drop
  const stretchPt0 = evaluateStretchedAnchorPoint(0, 14, 0, 0, 22, 0, 0, 0.72, { x: 0, y: 0, z: 0 });
  const stretchPt1 = evaluateStretchedAnchorPoint(0, 14, 0, 0, 22, 0, 1, 0.72, { x: 0, y: 0, z: 0 });
  assert.ok(stretchPt1.y - stretchPt0.y > 5.0);

  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, radius: R, voxelRadius: 18 });
  const fluid = new FluidSim();
  for (let k = 0; k < 28; k++) {
    fluid.spawnParticle(
      (k % 5 - 2) * 0.25,
      R + 0.8 + Math.floor(k / 5) * 0.22,
      ((k % 3) - 1) * 0.25,
    );
  }
  const captured = fluid.captureParticlesForTractor(0, R + 1.2, 0, 3.0, 0, 1, 0, 64);
  assert.equal(captured, 28);

  let minU = 1;
  let maxU = 0;
  for (let i = 0; i < fluid.activeCount; i++) {
    if (fluid.tractorStretchU[i] < minU) minU = fluid.tractorStretchU[i];
    if (fluid.tractorStretchU[i] > maxU) maxU = fluid.tractorStretchU[i];
  }
  assert.ok(maxU - minU > 0.75, 'Captured particles should span [0, 1] along stretch axis');

  // Step fluid upward while dragging tractor beam high above planet surface
  for (let s = 0; s < 35; s++) {
    const progress = s / 34;
    const headY = R + 2.0 + progress * 7.5;
    const anchorY = R + 1.2 + progress * 2.5;
    fluid.step(0.02, planet, g1Params, 2, {
      anchorX: 0,
      anchorY,
      anchorZ: 0,
      targetX: 0,
      targetY: headY,
      targetZ: 0,
      dragVelX: 0,
      dragVelY: 6.0,
      dragVelZ: 0,
      radius: 3.0,
      beamPower: 2.8,
      stretchStrength: 0.74,
    });
  }

  let avgYDragged = 0;
  let minYLifted = Infinity;
  let maxYLifted = -Infinity;
  for (let i = 0; i < fluid.activeCount; i++) {
    avgYDragged += fluid.py[i];
    if (fluid.py[i] < minYLifted) minYLifted = fluid.py[i];
    if (fluid.py[i] > maxYLifted) maxYLifted = fluid.py[i];
  }
  avgYDragged /= fluid.activeCount;
  assert.ok(avgYDragged > R + 3.0, `Expected fluid plume lifted above R+3 (${R + 3}), got ${avgYDragged}`);
  assert.ok(maxYLifted - minYLifted > 1.8, `Expected tidal elongation span > 1.8m, got ${maxYLifted - minYLifted}`);
  assert.ok(fluid.tractorTotalBeamForceN > 0 && fluid.tractorTotalGravityWeightN > 0);

  // Release beam: particles must fall back toward planet under Newtonian gravity
  fluid.releaseTractorCapture();
  assert.equal(fluid.tractorCapturedCount, 0);
  for (let s = 0; s < 55; s++) {
    fluid.step(0.02, planet, g1Params, 2, null);
  }
  let avgYDropped = 0;
  for (let i = 0; i < fluid.activeCount; i++) {
    avgYDropped += fluid.py[i];
  }
  avgYDropped /= fluid.activeCount;
  assert.ok(avgYDropped < avgYDragged - 1.5, `Released water should fall back under gravity (${avgYDropped} < ${avgYDragged})`);
});

test('Director Capture normalizes WebGL2 bottom-up vs WebGPU top-down RGBA readback and forces opaque alpha', () => {
  const width = 2;
  const height = 3;
  // Synthetic 2x3 image where row 0 is red-ish (alpha=0!), row 1 is green-ish (alpha=128), row 2 is blue-ish (alpha=255)
  const src = new Uint8Array([
    10, 20, 30, 0,    40, 50, 60, 12,
    70, 80, 90, 128,  100, 110, 120, 200,
    130, 140, 150, 0, 160, 170, 180, 255,
  ]);

  // WebGPU readback (flipY = false): preserves row order, forces alpha = 255
  const webgpuOut = normalizeReadbackRgbaToTopDown(src, width, height, false);
  assert.equal(webgpuOut.length, width * height * 4);
  assert.equal(webgpuOut[0], 10);
  assert.equal(webgpuOut[3], 255);
  assert.equal(webgpuOut[7], 255);
  assert.equal(webgpuOut[11], 255);
  assert.equal(webgpuOut[16], 130);
  assert.equal(webgpuOut[19], 255);

  // WebGL2 readback (flipY = true): row 2 from bottom becomes row 0 at top, forces alpha = 255
  const reusableOut = new Uint8ClampedArray(width * height * 4);
  const webglOut = normalizeReadbackRgbaToTopDown(src, width, height, true, reusableOut);
  assert.equal(webglOut, reusableOut);
  assert.equal(webglOut[0], 130);
  assert.equal(webglOut[1], 140);
  assert.equal(webglOut[2], 150);
  assert.equal(webglOut[3], 255);
  assert.equal(webglOut[4], 160);
  assert.equal(webglOut[7], 255);
  // Middle row preserved
  assert.equal(webglOut[8], 70);
  assert.equal(webglOut[11], 255);
  // Original row 0 moved to bottom row 2
  assert.equal(webglOut[16], 10);
  assert.equal(webglOut[19], 255);

  const lumaStats = analyzeRgbaFrameLuma(webglOut, 1);
  assert.equal(lumaStats.sampleCount, 6);
  assert.equal(lumaStats.nonZeroRgbSamples, 6);
  assert.equal(lumaStats.alphaMin, 255);
  assert.ok(lumaStats.meanLuma > 50);
});

test('Director offline simulation substepping runs uncapped physics across long/fast-forward frame intervals', () => {
  assert.deepEqual(computeOfflineSubsteps(0, 0.02), { subSteps: 0, subDt: 0 });
  assert.deepEqual(computeOfflineSubsteps(-0.5, 0.02), { subSteps: 0, subDt: 0 });

  // 30 FPS with 2.4x time scale => simDt = 0.08s => 4 substeps of 0.02s
  const plan = computeOfflineSubsteps(0.08, 0.02);
  assert.equal(plan.subSteps, 4);
  assert.ok(Math.abs(plan.subDt - 0.02) < 1e-9);
  assert.ok(Math.abs(plan.subSteps * plan.subDt - 0.08) < 1e-9);

  // Compare FluidSim multi-substepped 0.08s offline integration vs single clamped 0.03s tick
  const R = 14;
  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, radius: R, voxelRadius: 18 });
  const gParams = { referenceRadius: R, surfaceGravity: EARTH_SURFACE_GRAVITY };

  const fluidOffline = new FluidSim();
  const fluidClamped = new FluidSim();
  fluidOffline.spawnParticle(0, R + 6, 0);
  fluidClamped.spawnParticle(0, R + 6, 0);

  for (let frame = 0; frame < 10; frame++) {
    const { subSteps, subDt } = computeOfflineSubsteps(0.08, 0.02);
    for (let s = 0; s < subSteps; s++) {
      fluidOffline.step(subDt, planet, gParams, 2, null);
    }
    // Live clamped behavior used to cap dt at 0.03s
    fluidClamped.step(Math.min(0.08, 0.03), planet, gParams, 2, null);
  }

  // After 10 frames (0.8s elapsed vs 0.3s clamped), offline particle should have fallen noticeably further
  assert.ok(
    fluidOffline.py[0] < fluidClamped.py[0] - 0.5,
    `Offline substepped fluid (${fluidOffline.py[0]}) should advance full sim interval past clamped (${fluidClamped.py[0]})`,
  );
});

test('PerfMonitor classifies WebGPU vs WebGL2 downgrade states, software rasterizers, and GPU timer sources', () => {
  const hwWebGpu = classifyBackendDiagnostic({
    isWebGPUBackend: true,
    navigatorGpuAvailable: true,
    gpuTimestampSupported: true,
    adapterLabel: 'Apple M3 Max GPU',
    maxTextureDim: 16384,
  });
  assert.equal(hwWebGpu.backend, 'WebGPU');
  assert.equal(hwWebGpu.isDowngraded, false);
  assert.equal(hwWebGpu.downgradeSeverity, 'none');
  assert.equal(hwWebGpu.gpuTimestampSource, 'WebGPU timestamp-query');

  const webglFallback = classifyBackendDiagnostic({
    isWebGPUBackend: false,
    navigatorGpuAvailable: false,
    gpuTimestampSupported: true,
    adapterLabel: 'ANGLE (NVIDIA GeForce RTX 4080)',
  });
  assert.equal(webglFallback.backend, 'WebGL2');
  assert.equal(webglFallback.isDowngraded, true);
  assert.equal(webglFallback.downgradeSeverity, 'warn');
  assert.equal(webglFallback.isSoftwareRenderer, false);
  assert.equal(webglFallback.gpuTimestampSource, 'WebGL2 EXT_disjoint_timer_query');
  assert.ok(webglFallback.downgradeReason.includes('WebGL2'));

  const swiftshaderWebgl = classifyBackendDiagnostic({
    isWebGPUBackend: false,
    navigatorGpuAvailable: true,
    gpuTimestampSupported: false,
    adapterLabel: 'Google SwiftShader (ANGLE Vulkan)',
  });
  assert.equal(swiftshaderWebgl.backend, 'WebGL2');
  assert.equal(swiftshaderWebgl.isDowngraded, true);
  assert.equal(swiftshaderWebgl.isSoftwareRenderer, true);
  assert.equal(swiftshaderWebgl.downgradeSeverity, 'critical');
  assert.equal(swiftshaderWebgl.gpuTimestampSource, '不可用 (仅CPU提交计时)');
});

test('RollingPerfTracker computes GPU time, CPU stage breakdown, P95, and 1% low FPS across ring wrap', () => {
  const tracker = new RollingPerfTracker(16);
  for (let i = 0; i < 24; i++) {
    const spike = i === 18 ? 32 : 16;
    tracker.recordCpuFrame({
      frameIntervalMs: spike,
      cpuTickMs: 3.5,
      simStepMs: 1.2,
      meshBuildMs: 1.1,
      renderSubmitMs: 0.9,
    });
    tracker.recordGpuTime(i === 18 ? 14.5 : 4.2);
  }

  const history = tracker.getOrderedHistory();
  assert.equal(history.length, 16, 'Ring buffer must stay capped at capacity 16');

  const diag = classifyBackendDiagnostic({
    isWebGPUBackend: true,
    navigatorGpuAvailable: true,
    gpuTimestampSupported: true,
    adapterLabel: 'Test GPU',
  });
  const snap = tracker.buildSnapshot({
    backendInfo: diag,
    drawCalls: 42,
    renderPasses: 2,
    triangles: 120000,
    points: 0,
    lines: 120,
    geometriesCount: 88,
    texturesCount: 6,
    renderTargetsCount: 1,
    gpuMemoryBytes: 64 * 1024 * 1024,
    jsHeapUsedMb: 128.5,
    jsHeapLimitMb: 4096,
    pixelRatio: 2,
    canvasWidth: 2560,
    canvasHeight: 1440,
  });

  assert.ok(snap.gpuTimeMs !== null && snap.gpuTimeMs > 3.5 && snap.gpuTimeMs < 15);
  assert.equal(snap.gpuTimeLastMs, 4.2);
  assert.ok(snap.gpuTimeP95Ms !== null && snap.gpuTimeP95Ms >= 4.2);
  assert.ok(snap.frameTimeP95Ms >= 16);
  assert.ok(snap.fps1PercentLow <= snap.fps);
  assert.equal(snap.drawCalls, 42);
  assert.equal(snap.triangles, 120000);
  assert.equal(snap.history.length, 16);
});

test('RenderQuality presets & software fallback downgrade guard behave deterministically', () => {
  const highHw = buildRenderQualityConfig('high', false);
  assert.equal(highHw.preset, 'high');
  assert.equal(highHw.pbrEnhanced, true);
  assert.ok(highHw.pbrReliefDepth > 1.0);
  assert.equal(highHw.rayTracingMode, 'ssr');
  assert.equal(highHw.volumetricFog, true);
  assert.equal(highHw.atmoScattering, true);
  assert.equal(highHw.shadowQuality, 'high');

  // Software rasterizer auto-downgrades balanced/high to performance,
  // while still honoring explicit cinematic / offline_raytraced overrides.
  const highSw = buildRenderQualityConfig('high', true);
  assert.equal(highSw.preset, 'performance');
  assert.equal(highSw.rayTracingMode, 'off');
  assert.equal(highSw.volumetricFog, false);

  const offlineSw = buildRenderQualityConfig('offline_raytraced', true);
  assert.equal(offlineSw.preset, 'offline_raytraced');
  assert.ok(offlineSw.pbrReliefDepth >= 1.4);
  assert.equal(offlineSw.rayTracingMode, 'ssgi_ssr');
  assert.equal(offlineSw.volumetricSteps, 40);
  assert.equal(offlineSw.offlineAccumSamples, 4);
});

test('RenderQuality resolveDirectorOfflineQuality elevates live settings for time-for-quality offline rendering', () => {
  const livePerf = buildRenderQualityConfig('performance', false);
  assert.equal(livePerf.pbrReliefDepth, 0);
  const inherited = resolveDirectorOfflineQuality(livePerf, {
    overrideMode: 'inherit',
    accumSamples: 4,
  });
  assert.equal(inherited.rayTracingMode, 'off');
  assert.equal(inherited.offlineAccumSamples, 4);

  const elevated = resolveDirectorOfflineQuality(livePerf, {
    overrideMode: 'offline_raytraced',
    accumSamples: 8,
    rayTracing: true,
    volumetrics: true,
    shadowQuality: 'ultra',
    pbrEnhanced: true,
  });
  assert.equal(elevated.preset, 'offline_raytraced');
  assert.ok(elevated.pbrReliefDepth >= 1.4);
  assert.equal(elevated.rayTracingMode, 'ssgi_ssr');
  assert.equal(elevated.aoEnabled, true);
  assert.equal(elevated.volumetricFog, true);
  assert.equal(elevated.atmoScattering, true);
  assert.equal(elevated.shadowQuality, 'ultra');
  assert.equal(elevated.contactShadows, true);
  assert.equal(elevated.offlineAccumSamples, 8);

  const defPlan = createDefaultDirectorPlan();
  assert.ok(defPlan.offlineQuality);
  assert.deepEqual(defPlan.offlineQuality, createDefaultDirectorQuality());
});

test('RenderQuality shadow map sizing and tight dynamic frustum focusing tighten on close-up voxels', () => {
  assert.equal(resolveShadowMapSize('standard', 8192, false), 1024);
  assert.equal(resolveShadowMapSize('high', 8192, false), 2048);
  assert.equal(resolveShadowMapSize('ultra', 8192, false), 4096);
  // Clamped safely to hardware limit
  assert.equal(resolveShadowMapSize('ultra', 3000, false), 2048);
  assert.equal(resolveShadowMapSize('ultra', 8192, true), 2048);

  // Close-up voxel focus tightens halfSpan & shifts frustum center toward surface target
  const closeFrustum = computeTightShadowFrustum(13, 0.02, 0, 13, 0, 0.8, 'ultra');
  const orbitFrustum = computeTightShadowFrustum(13, 0.02, 0, 13, 0, 32, 'ultra');
  assert.ok(
    closeFrustum.halfSpan < orbitFrustum.halfSpan * 0.25,
    `Expected close frustum (${closeFrustum.halfSpan}) << orbit (${orbitFrustum.halfSpan})`,
  );
  assert.ok(closeFrustum.centerY > 10);
  assert.ok(Math.abs(orbitFrustum.centerY) < 1e-6);
});

test('RenderQuality Halton subpixel jittering and RGBA accumulator produce clean SSAA averages', () => {
  assert.equal(halton(1, 2), 0.5);
  assert.equal(halton(2, 2), 0.25);
  assert.equal(halton(3, 2), 0.75);

  const single = computeSubpixelJitterOffset(0, 1);
  assert.deepEqual(single, { offsetX: 0, offsetY: 0 });

  for (let i = 0; i < 8; i++) {
    const j = computeSubpixelJitterOffset(i, 8);
    assert.ok(j.offsetX >= -0.5 && j.offsetX <= 0.5);
    assert.ok(j.offsetY >= -0.5 && j.offsetY <= 0.5);
  }

  const acc = createRgbaAccumulator(2);
  accumulateRgbaSample(acc, new Uint8ClampedArray([10, 20, 30, 0, 100, 150, 200, 128]));
  accumulateRgbaSample(acc, new Uint8ClampedArray([20, 40, 50, 255, 120, 170, 220, 255]));
  const finalRgba = finalizeAccumulatedRgba(acc, 2);
  assert.deepEqual(Array.from(finalRgba), [15, 30, 40, 255, 110, 160, 210, 255]);
});

test('Character size controller keeps default eye well under atmosphere shell and scales monotonically', () => {
  assert.equal(clampPlayerScale(undefined), DEFAULT_PLAYER_SCALE);
  assert.equal(clampPlayerScale(0.001), MIN_PLAYER_SCALE);
  assert.equal(clampPlayerScale(99), MAX_PLAYER_SCALE);

  const planetR = 13.0;
  const atmoScaleHeight = planetR * DEFAULT_ATMOS_CONFIG.scaleHeightRatio;
  const defM = computeCharacterScaleMetrics(1.0, DEFAULT_PLAYER_SCALE, 1.0, 0.02);
  assert.ok(
    defM.eyeHeight + defM.footRadius < atmoScaleHeight * 0.4,
    `Expected default player standing eye (${defM.eyeHeight + defM.footRadius}m) well under atmosphere scale height (${atmoScaleHeight}m)`,
  );

  const tinyM = computeCharacterScaleMetrics(1.0, 0.1, 1.0, 0.02);
  const giantM = computeCharacterScaleMetrics(1.0, 2.0, 1.0, 0.02);
  assert.ok(tinyM.charScale < defM.charScale && defM.charScale < giantM.charScale);
  assert.ok(tinyM.footRadius < defM.footRadius && defM.footRadius < giantM.footRadius);
  assert.ok(
    tinyM.defaultExplorerCamDist < defM.defaultExplorerCamDist &&
      defM.defaultExplorerCamDist < giantM.defaultExplorerCamDist,
  );
  assert.ok(tinyM.walkSpeed < defM.walkSpeed && defM.walkSpeed < giantM.walkSpeed);
});

test('First-person eye pose aligns with local gravity normal and supports upward sky pitch', () => {
  const pose = computeFirstPersonEyePose([0, 13, 0], [0, 1, 0], [0, 0, -1], 0.65, 0.42);
  assert.ok(Math.abs(pose.eyePos[0]) < 1e-9);
  assert.ok(Math.abs(pose.eyePos[1] - 13.42) < 1e-6);
  assert.ok(Math.abs(pose.eyePos[2]) < 1e-9);

  // Looking upward into atmosphere: positive dot with up vector & unit direction
  const mag = Math.hypot(pose.lookDir[0], pose.lookDir[1], pose.lookDir[2]);
  assert.ok(Math.abs(mag - 1.0) < 1e-6);
  assert.ok(pose.lookDir[1] > 0.55, 'Upward first-person pitch should gaze cleanly into sky');
  assert.ok(pose.lookDir[2] < -0.5);

  // Works identically at tilted arbitrary sphere coordinate (non-Y-up)
  const nLen = Math.hypot(1, 1, 1);
  const up: [number, number, number] = [1 / nLen, 1 / nLen, 1 / nLen];
  const tilted = computeFirstPersonEyePose([10, 10, 10], up, [1, 0, -1], 0.0, 0.5);
  const dotUp =
    tilted.lookDir[0] * up[0] + tilted.lookDir[1] * up[1] + tilted.lookDir[2] * up[2];
  assert.ok(Math.abs(dotUp) < 1e-5, 'Horizon first-person look should remain perpendicular to radial up');
});




