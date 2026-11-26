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
  PLANET_PRESETS,
  VoxelPlanet,
} from './voxelPlanet';
import {
  CircularVoxelHistoryBuffer,
  VoxelHistoryEntry,
} from './voxelHistory';
import { FluidSim, MAX_FLUID_PARTICLES } from './fluidSim';
import {
  clampPlayerScale,
  computeCharacterScaleMetrics,
  computeDetailCameraOptics,
  computeFirstPersonEyePose,
  computeSafeClipPlanes,
  DEFAULT_PLAYER_SCALE,
  evaluateLandingDescentPose,
  formatPlayerScaleLabel,
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
  bakeShotActionIntoProject,
  computePlanFrameCount,
  computeProjectFrameRange,
  createDefaultDirectorPlan,
  createDefaultDirectorProject,
  DirectorSceneAnchor,
  evaluateCameraTrackPose,
  evaluateCubicBezierEasing,
  evaluateDirectorPose,
  evaluateEnvironmentTrack,
  evaluateFullTimelineAtTime,
  evaluateParameterTrack,
  evaluatePostFxTrack,
  formatSmpteTimecode,
  FPS_PRESETS,
  getLutColorMatrixParams,
  parseDirectorProjectJson,
  RESOLUTION_PRESETS,
  serializeDirectorProjectJson,
  upsertParamKeyframe,
  VISUAL_FILTER_META,
} from './director';
import { buildTarArchive, WebmMuxer } from './webmMuxer';
import {
  analyzeRgbaFrameLuma,
  computeCheckpointResumeStartFrame,
  computeOfflineSubsteps,
  computeRgbHistogram,
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
import {
  computeSphericalSurveyMetrics,
  CoordDatum,
  coordToWorld,
  dmsToDecimal,
  formatDms,
  lonLatRadiusToWorld,
  planetaryUtmToWorld,
  worldToAllCoords,
  worldToCoord,
  worldToPlanetaryUtm,
} from './coordinates';
import {
  exportBenchmarksToCsv,
  exportBoreholeToCsv,
  exportSurveyGeoJson,
  exportTransectToCsv,
  measureGeologicalAttitude,
  measureSurveyPolygonArea,
  sampleBoreholeColumn,
  sampleGeologicalTransect,
} from './geologySurvey';
import {
  buildFvmGridDescriptor,
  COMPOUND_CATALOG,
  compileReactionHypergraph,
  computeCellularBioTelemetry,
  computeCompoundMolarMassKgPerMol,
  computeMaterialElementalBreakdown,
  createCellularMetabolismHypergraph,
  createClosedEquilibriumHypergraph,
  createOpenAutocatalyticHypergraph,
  createPlanetaryCarbonWaterHypergraph,
  createPlanetaryHydrologyHypergraph,
  DEFAULT_GEOLOGICAL_EVOLUTION_CONFIG,
  DEFAULT_PLANETARY_FEEDBACK_CONFIG,
  EulerianFvmGrid,
  evaluateArrheniusRateConstant,
  evaluateFeedbackCandidatesFromCpuGrid,
  evaluateSymmetricFluxReactionStepCpuReference,
  evaluateTectonicAndFluvialCandidatesFromCpuGrid,
  evaluateTpWindowGate,
  FVM_RESOLUTION_PRESETS,
  MatterPhase,
  MetabolismSimRunner,
  PACKED_KINETICS_VEC4_COUNT,
  packHypergraphKineticsVec4,
  PERIODIC_ELEMENTS,
  PicCouplingRegistry,
  runLocalMicroCalibration,
  sampleFvmRenderColor,
  syncLocalBrushToCpuFvmGrid,
  verifyHypergraphElementBalance,
  VOXEL_MATERIAL_COMPOSITIONS,
} from './metabolism';

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

test('Cartographic projections round-trip cleanly and planetary atlas / slope / cross-section render valid RGBA buffers', () => {
  const projections: MapProjection[] = [
    'equirectangular',
    'mollweide',
    'sinusoidal',
    'robinson',
    'lambertAzimuthal',
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
    projection: 'robinson',
    atlas,
    sunDir: [1, 0, 0],
    atmosCfg: DEFAULT_ATMOS_CONFIG,
    thermalCfg: DEFAULT_THERMAL_CONFIG,
    simTimeSec: 0,
    centerLonDeg: 0,
    centerLatDeg: 0,
    gridStepDeg: 15,
  });
  assert.equal(mapPixels.length, 80 * 40 * 4);

  const slopePixels = renderPlanarMapImageData(80, 40, {
    mode: 'slope',
    projection: 'sinusoidal',
    atlas,
    sunDir: [1, 0, 0],
    atmosCfg: DEFAULT_ATMOS_CONFIG,
    thermalCfg: DEFAULT_THERMAL_CONFIG,
    simTimeSec: 0,
    centerLonDeg: 0,
    centerLatDeg: 0,
  });
  assert.equal(slopePixels.length, 80 * 40 * 4);

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

test('Character size controller keeps default eye well under atmosphere shell and scales monotonically across extreme 1e-12..1e12 range', () => {
  assert.equal(clampPlayerScale(undefined), DEFAULT_PLAYER_SCALE);
  assert.ok(MIN_PLAYER_SCALE <= 1e-12);
  assert.ok(MAX_PLAYER_SCALE >= 1e12);
  assert.equal(clampPlayerScale(1e-7), 1e-7);
  assert.equal(clampPlayerScale(1e6), 1e6);
  assert.equal(clampPlayerScale(1e-20), MIN_PLAYER_SCALE);
  assert.equal(clampPlayerScale(1e20), MAX_PLAYER_SCALE);

  const planetR = 13.0;
  const atmoScaleHeight = planetR * DEFAULT_ATMOS_CONFIG.scaleHeightRatio;
  const defM = computeCharacterScaleMetrics(1.0, DEFAULT_PLAYER_SCALE, 1.0, 0.02);
  assert.ok(
    defM.eyeHeight + defM.footRadius < atmoScaleHeight * 0.4,
    `Expected default player standing eye (${defM.eyeHeight + defM.footRadius}m) well under atmosphere scale height (${atmoScaleHeight}m)`,
  );

  const scales = [1e-12, 1e-7, 1e-4, 0.01, DEFAULT_PLAYER_SCALE, 1.0, 1e3, 1e6, 1e12];
  const metrics = scales.map((s) => computeCharacterScaleMetrics(1.0, s, 1.0, 0.02));
  for (let i = 1; i < metrics.length; i++) {
    const prev = metrics[i - 1];
    const curr = metrics[i];
    assert.ok(prev.charScale < curr.charScale, `charScale monotonic at ${scales[i]}`);
    assert.ok(prev.footRadius < curr.footRadius, `footRadius monotonic at ${scales[i]}`);
    assert.ok(prev.eyeHeight < curr.eyeHeight, `eyeHeight monotonic at ${scales[i]}`);
    assert.ok(
      prev.defaultExplorerCamDist < curr.defaultExplorerCamDist,
      `camDist monotonic at ${scales[i]}`,
    );
    assert.ok(prev.walkSpeed < curr.walkSpeed, `walkSpeed monotonic at ${scales[i]}`);
  }

  // Verify clip planes remain valid & maintain 24-bit depth ratio <= 2.5e5 at 1e-7 & 1e6 scales
  const microM = metrics[1]; // 1e-7
  const microClips = computeSafeClipPlanes(
    microM.eyeHeight,
    microM.defaultExplorerCamDist,
    planetR,
    55,
  );
  assert.ok(microClips.near > 0 && microClips.near < microM.eyeHeight);
  assert.ok(microClips.far > microClips.near * 1e3);
  assert.ok(microClips.far / microClips.near <= 2.5e5);

  const cosmicM = metrics[7]; // 1e6
  const cosmicClips = computeSafeClipPlanes(
    cosmicM.eyeHeight,
    cosmicM.defaultExplorerCamDist,
    planetR,
    55,
  );
  assert.ok(cosmicClips.near > 0 && cosmicClips.near < cosmicM.defaultExplorerCamDist);
  assert.ok(cosmicClips.far > cosmicM.defaultExplorerCamDist);
  assert.ok(cosmicClips.far / cosmicClips.near <= 2.5e5);

  assert.equal(formatPlayerScaleLabel(1e-7), '1.0e-7');
  assert.equal(formatPlayerScaleLabel(1e6), '1.0e6');
  assert.equal(formatPlayerScaleLabel(0.35), '0.35');
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

test('All 7 Planetary Coordinate Systems convert forward & inverse accurately including UTM zones and ENU frames', () => {
  const datum: CoordDatum = {
    planetRadius: 13.0,
    nativeVoxelSize: 13.0 / 18,
    enuOrigin: lonLatRadiusToWorld(35, 110, 13.0),
  };

  const samples: Array<[number, number, number]> = [
    lonLatRadiusToWorld(35.6895, 139.6917, 13.42), // Northern East
    lonLatRadiusToWorld(-33.8688, -70.6693, 12.65), // Southern West
    lonLatRadiusToWorld(0.0, 0.0, 13.0), // Prime meridian equator
    lonLatRadiusToWorld(78.2, -175.4, 14.1), // High latitude antimeridian
  ];

  for (const wp of samples) {
    const all = worldToAllCoords(wp, datum);

    for (const sys of ['geo_dd', 'ecef_xyz', 'spherical_rtp', 'local_enu'] as const) {
      const r = all[sys];
      const back = coordToWorld(
        sys,
        r.components[0].numericValue,
        r.components[1].numericValue,
        r.components[2].numericValue,
        datum,
      );
      const err = Math.hypot(back[0] - wp[0], back[1] - wp[1], back[2] - wp[2]);
      assert.ok(err < 1e-3, `CRS ${sys} round-trip error too large: ${err}`);
    }

    // Planetary UTM exact spherical TM forward/inverse round-trip
    const utm = worldToPlanetaryUtm(wp[0], wp[1], wp[2], datum.planetRadius);
    const utmBack = planetaryUtmToWorld(
      utm.zoneNumber,
      utm.hemisphere,
      utm.eastingM,
      utm.northingM,
      utm.elevationM,
      datum.planetRadius,
    );
    const utmErr = Math.hypot(utmBack[0] - wp[0], utmBack[1] - wp[1], utmBack[2] - wp[2]);
    assert.ok(utmErr < 1e-3, `Planetary UTM round-trip error ${utmErr}`);
    assert.ok(utm.scaleFactor >= 0.9996 && utm.scaleFactor < 1.05);

    // Voxel IJK lattice within +/- 0.51 voxel radius
    const vox = worldToCoord(wp, 'voxel_ijk', datum);
    const voxBack = coordToWorld(
      'voxel_ijk',
      vox.components[0].numericValue,
      vox.components[1].numericValue,
      vox.components[2].numericValue,
      datum,
    );
    const voxErr = Math.hypot(voxBack[0] - wp[0], voxBack[1] - wp[1], voxBack[2] - wp[2]);
    assert.ok(voxErr <= datum.nativeVoxelSize * 0.9);
  }

  // DMS format & parse check
  const dmsStr = formatDms(31.2304, 'N', 'S');
  assert.ok(dmsStr.startsWith('31°13\'') && dmsStr.endsWith('N'));
  assert.ok(Math.abs(dmsToDecimal(31, 13, 49.4, 1) - 31.2303889) < 1e-4);

  // Geodesic quarter-globe arc = (pi / 2) * R0
  const eq0: [number, number, number] = [13.0, 0, 0];
  const eq90: [number, number, number] = [0, 0, 13.0];
  const metrics = computeSphericalSurveyMetrics(eq0, eq90, 13.0);
  assert.ok(Math.abs(metrics.geodesicArcM - (Math.PI / 2) * 13.0) < 1e-5);
  assert.ok(Math.abs(metrics.centralAngleDeg - 90) < 1e-5);
  assert.ok(Math.abs(metrics.forwardAzimuthDeg - 90) < 1e-3);
});

test('Geological attitude, geodesic transect, radial borehole column, spherical polygon area, and CSV/GeoJSON exports work coherently', () => {
  const planet = new VoxelPlanet(202611);
  const fluid = new FluidSim();
  fluid.seedInitialLakes(planet);
  const gravParams = { referenceRadius: planet.baseRadius, surfaceGravity: EARTH_SURFACE_GRAVITY };
  const sunDir: [number, number, number] = [0.6, 0.7, 0.4];

  const [sx, sy, sz] = planet.spawnPosition;
  const sLen = Math.hypot(sx, sy, sz);
  const surfR = planet.findSurfaceRadiusAlongRay(sx / sLen, sy / sLen, sz / sLen);
  const pA: [number, number, number] = [(sx / sLen) * surfR, (sy / sLen) * surfR, (sz / sLen) * surfR];

  // Clinometer attitude
  const att = measureGeologicalAttitude(
    planet,
    fluid,
    gravParams,
    DEFAULT_ATMOS_CONFIG,
    DEFAULT_THERMAL_CONFIG,
    sunDir,
    0,
    pA[0],
    pA[1],
    pA[2],
  );
  assert.ok(att.slopeDeg >= 0 && att.slopeDeg <= 90);
  assert.ok(att.strikeDeg >= 0 && att.strikeDeg < 360);
  assert.ok(att.dipDirectionDeg >= 0 && att.dipDirectionDeg < 360);
  assert.ok(att.gravityMs2 > 5);

  // Transect profile
  const pBDir = lonLatRadiusToWorld(25, 45, planet.baseRadius);
  const transect = sampleGeologicalTransect(
    planet,
    fluid,
    pA,
    pBDir,
    DEFAULT_ATMOS_CONFIG,
    DEFAULT_THERMAL_CONFIG,
    sunDir,
    0,
    40,
  );
  assert.equal(transect.samples.length, 40);
  assert.ok(transect.surfacePathLengthM >= transect.spherical.geodesicArcM * 0.99);
  assert.ok(transect.maxElevM >= transect.minElevM);

  // Borehole column
  const borehole = sampleBoreholeColumn(
    planet,
    pA[0],
    pA[1],
    pA[2],
    DEFAULT_ATMOS_CONFIG,
    DEFAULT_THERMAL_CONFIG,
    sunDir,
    0,
    planet.baseRadius * 0.55,
  );
  assert.ok(borehole.strata.length >= 1);
  assert.ok(borehole.coreRecoveryPct >= 0 && borehole.coreRecoveryPct <= 100);
  assert.ok(borehole.bottomTempC >= borehole.surfaceTempC);

  // Girard spherical excess area: octant triangle on sphere R0 has area = (4*pi*R0^2)/8 = 0.5*pi*R0^2
  const R = planet.baseRadius;
  const poly = measureSurveyPolygonArea(R, [
    [R, 0, 0],
    [0, 0, R],
    [0, R, 0],
  ]);
  assert.ok(poly !== null);
  assert.ok(
    Math.abs(poly.sphericalAreaM2 - 0.5 * Math.PI * R * R) < 1e-3,
    `Expected octant spherical area ${(0.5 * Math.PI * R * R).toFixed(4)}, got ${poly.sphericalAreaM2.toFixed(4)}`,
  );

  // Export serializers
  const datum: CoordDatum = {
    planetRadius: R,
    nativeVoxelSize: planet.nativeVoxelSize,
    enuOrigin: pA,
  };
  const bm = {
    id: 'bm_1',
    code: 'BM-01',
    name: '控制点 BM-01',
    createdAt: 0,
    worldPos: pA,
    normal: att.normal,
    elevationM: att.elevationM,
    material: att.material,
    slopeDeg: att.slopeDeg,
    dipDirectionDeg: att.dipDirectionDeg,
    strikeDeg: att.strikeDeg,
    gravityMs2: att.gravityMs2,
    tempC: att.tempC,
    hasWater: false,
  };
  const csvBm = exportBenchmarksToCsv([bm], datum);
  assert.ok(csvBm.includes('BM-01') && csvBm.includes('UTM_Zone'));
  const csvTr = exportTransectToCsv(transect);
  assert.ok(csvTr.split('\n').length === 41);
  const csvBh = exportBoreholeToCsv(borehole);
  assert.ok(csvBh.includes('Stratum_No'));
  const geoJson = JSON.parse(exportSurveyGeoJson([bm], transect, datum)) as {
    type: string;
    features: unknown[];
  };
  assert.equal(geoJson.type, 'FeatureCollection');
  assert.equal(geoJson.features.length, 2);
});

test('Director NLE Multi-Track Engine: Cubic-Bezier easing, Camera/Env/PostFX tracks, shot baking, JSON round-trip, RGB histogram & checkpoint resume', () => {
  // 1. Cubic-Bezier easing (linear identity, ease-in-out monotonic, overshoot > 1)
  assert.equal(evaluateCubicBezierEasing([0, 0, 1, 1], 0), 0);
  assert.equal(evaluateCubicBezierEasing([0, 0, 1, 1], 1), 1);
  assert.ok(Math.abs(evaluateCubicBezierEasing([0, 0, 1, 1], 0.37) - 0.37) < 1e-4);

  const overshootMid = evaluateCubicBezierEasing([0.34, 1.38, 0.64, 1.0], 0.55);
  assert.ok(overshootMid > 1.0, `Expected overshoot bezier > 1.0 near t=0.55, got ${overshootMid}`);

  // 2. Default project & frame range + SMPTE timecodes
  const anchor: DirectorSceneAnchor = {
    baseRadius: 13,
    nativeVoxelSize: 13 / 128,
    targetPoint: [0, 13, 0],
    targetNormal: [0, 1, 0],
    currentPos: [0, 26, 20],
    currentLookAt: [0, 0, 0],
    currentUp: [0, 1, 0],
    currentFovDeg: 50,
  };
  const proj = createDefaultDirectorProject(anchor, 2026);
  proj.fps = 60;
  proj.durationSec = 4;
  proj.inTimeSec = 1;
  proj.outTimeSec = 3;
  const range = computeProjectFrameRange(proj);
  assert.equal(range.totalFrames, 240);
  assert.equal(range.startFrame, 60);
  assert.equal(range.endFrame, 179);
  assert.equal(formatSmpteTimecode(1.5, 60), '00:00:01:30');
  assert.equal(formatSmpteTimecode(1.0, 165), '00:00:01:000');

  // 3. Camera track: linear, catmull_rom, hold, and roll rotation
  const camTrack = [
    {
      ...proj.cameraTrack[0],
      timeSec: 0,
      position: [0, 20, 0] as [number, number, number],
      lookAt: [0, 0, 0] as [number, number, number],
      up: [0, 0, -1] as [number, number, number],
      fovDeg: 40,
      rollDeg: 0,
      shakeAmp: 0,
      interpMode: 'hold' as const,
      easing: [0, 0, 1, 1] as [number, number, number, number],
    },
    {
      ...proj.cameraTrack[1],
      timeSec: 2,
      position: [20, 20, 0] as [number, number, number],
      lookAt: [0, 0, 0] as [number, number, number],
      up: [0, 0, -1] as [number, number, number],
      fovDeg: 60,
      rollDeg: 30,
      shakeAmp: 0,
      interpMode: 'linear' as const,
      easing: [0, 0, 1, 1] as [number, number, number, number],
    },
  ];
  const heldPose = evaluateCameraTrackPose(camTrack, 1.5, anchor);
  assert.ok(Math.hypot(heldPose.position[0] - 0, heldPose.position[1] - 20) < 1e-4);
  assert.equal(heldPose.fovDeg, 40);

  // Switch first keyframe to linear and evaluate midpoint
  camTrack[0] = { ...camTrack[0], interpMode: 'linear' as const };
  const linPose = evaluateCameraTrackPose(camTrack, 1.0, anchor);
  assert.ok(Math.abs(linPose.position[0] - 10) < 1e-4);
  assert.ok(Math.abs(linPose.fovDeg - 50) < 1e-4);
  assert.ok(Math.abs((linPose.rollDeg ?? 0) - 15) < 1e-4);

  // 4. Environment & Post-FX keyframe interpolation + LUT matrix
  const envState = evaluateEnvironmentTrack(
    [
      {
        id: 'e0',
        timeSec: 0,
        sunElevationDeg: 10,
        sunAzimuthDeg: 0,
        atmoDensity: 0.8,
        scatterStrength: 1.0,
        cloudCoverage: 0.2,
        cloudAltitudeRatio: 0.14,
        windSpeed: 1.0,
        tempOffsetC: -5,
        easing: [0, 0, 1, 1],
      },
      {
        id: 'e1',
        timeSec: 4,
        sunElevationDeg: 50,
        sunAzimuthDeg: 120,
        atmoDensity: 1.6,
        scatterStrength: 1.4,
        cloudCoverage: 0.8,
        cloudAltitudeRatio: 0.22,
        windSpeed: 2.0,
        tempOffsetC: 15,
        easing: [0, 0, 1, 1],
      },
    ],
    2.0,
  );
  assert.ok(Math.abs(envState.sunElevationDeg - 30) < 1e-3);
  assert.ok(Math.abs(envState.sunAzimuthDeg - 60) < 1e-3);
  assert.ok(Math.abs(envState.cloudCoverage - 0.5) < 1e-3);
  assert.ok(Math.abs(envState.tempOffsetC - 5) < 1e-3);

  const pfxState = evaluatePostFxTrack(
    [
      {
        id: 'p0',
        timeSec: 0,
        lutPreset: 'natural',
        lutIntensity: 0.2,
        exposure: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        bloomStrength: 0.2,
        vignette: 0.1,
        filmGrain: 0.0,
        chromaticAberration: 0,
        aspectMask: 'none',
        easing: [0, 0, 1, 1],
      },
      {
        id: 'p1',
        timeSec: 2,
        lutPreset: 'cinema_teal_orange',
        lutIntensity: 1.0,
        exposure: 1.4,
        contrast: 1.2,
        saturation: 1.2,
        bloomStrength: 0.6,
        vignette: 0.5,
        filmGrain: 0.1,
        chromaticAberration: 0,
        aspectMask: '2.39:1',
        easing: [0, 0, 1, 1],
      },
    ],
    1.5,
  );
  assert.equal(pfxState.lutPreset, 'cinema_teal_orange');
  assert.equal(pfxState.aspectMask, '2.39:1');
  assert.ok(Math.abs(pfxState.exposure - 1.3) < 1e-3);

  const lutMat = getLutColorMatrixParams('cinema_teal_orange');
  assert.ok(lutMat.shadowTint[2] > lutMat.shadowTint[0], 'Teal shadows have stronger B than R');
  assert.ok(lutMat.highlightTint[0] > lutMat.highlightTint[2], 'Orange highlights have stronger R than B');

  // 5. Bake procedural action into NLE keyframes + serialize/parse round-trip
  const plan = createDefaultDirectorPlan();
  plan.durationSec = 5;
  plan.fps = 30;
  const baked = bakeShotActionIntoProject(proj, 'orbit_360', plan, anchor, envState, 7);
  assert.equal(baked.cameraTrack.length, 7);
  assert.equal(baked.envTrack.length, 2);
  const serialized = serializeDirectorProjectJson(baked);
  const restored = parseDirectorProjectJson(serialized);
  assert.ok(restored !== null);
  assert.equal(restored!.cameraTrack.length, 7);
  assert.equal(restored!.fps, 30);

  // 6. RGB Histogram & Checkpoint Resume Alignment
  const rgba = new Uint8ClampedArray(64 * 4);
  for (let i = 0; i < 64; i++) {
    rgba[i * 4] = i % 2 === 0 ? 250 : 20;
    rgba[i * 4 + 1] = 120;
    rgba[i * 4 + 2] = 60;
    rgba[i * 4 + 3] = 255;
  }
  const hist = computeRgbHistogram(rgba, 32, 1);
  assert.equal(hist.bins, 32);
  assert.equal(hist.alphaMin, 255);
  assert.ok(hist.meanLuma > 80 && hist.meanLuma < 200);

  assert.equal(
    computeCheckpointResumeStartFrame({ startFrame: 0, endFrame: 120, latestCheckpointFrame: 48 }),
    48,
  );
  assert.equal(
    computeCheckpointResumeStartFrame({ startFrame: 20, endFrame: 120, latestCheckpointFrame: 5 }),
    20,
  );
});

test('Per-parameter keyframing (cloudCoverage, solarIntensity, waterVolume, visualFilter) and FluidSim.setTargetParticleCount work reversibly', () => {
  const anchor: DirectorSceneAnchor = {
    baseRadius: 13,
    nativeVoxelSize: 13 / 64,
    targetPoint: [0, 13, 0],
    targetNormal: [0, 1, 0],
    currentPos: [0, 26, 20],
    currentLookAt: [0, 0, 0],
    currentUp: [0, 1, 0],
    currentFovDeg: 50,
  };
  const proj = createDefaultDirectorProject(anchor, 2026);
  proj.durationSec = 4;
  proj.fps = 30;
  proj.postFxTrack[0].visualFilter = 'compound_eye';
  proj.postFxTrack.push({
    ...proj.postFxTrack[0],
    id: 'pfx_1',
    timeSec: 4,
    visualFilter: 'constructivism',
  });

  // Upsert individual parameter keyframes on cloudCoverage, solarIntensity, waterVolume, filterScale
  let cloudKfs = upsertParamKeyframe(undefined, 0, 0.2, [0, 0, 1, 1]);
  cloudKfs = upsertParamKeyframe(cloudKfs, 4, 1.8, [0, 0, 1, 1]);
  // Updating an existing timestamp within 0.04s replaces rather than duplicating
  cloudKfs = upsertParamKeyframe(cloudKfs, 3.98, 1.9, [0, 0, 1, 1]);
  assert.equal(cloudKfs.length, 2);

  let sunKfs = upsertParamKeyframe(undefined, 0, 0.5, [0, 0, 1, 1]);
  sunKfs = upsertParamKeyframe(sunKfs, 4, 3.5, [0, 0, 1, 1]);

  let waterKfs = upsertParamKeyframe(undefined, 0, 0.4, [0, 0, 1, 1]);
  waterKfs = upsertParamKeyframe(waterKfs, 4, 2.2, [0, 0, 1, 1]);

  proj.paramTracks = {
    cloudCoverage: cloudKfs,
    solarIntensity: sunKfs,
    waterVolume: waterKfs,
    filterScale: upsertParamKeyframe(undefined, 2, 2.25, [0, 0, 1, 1]),
  };

  assert.ok(Math.abs(evaluateParameterTrack(cloudKfs, 2.0, 0.5, 0, 2.0) - 1.05) < 1e-4);

  const mid = evaluateFullTimelineAtTime(proj, anchor, 2.0);
  assert.ok(Math.abs(mid.env.cloudCoverage - 1.05) < 1e-4);
  assert.ok(Math.abs((mid.env.solarIntensity ?? 0) - 2.0) < 1e-4);
  assert.ok(Math.abs((mid.env.waterVolume ?? 0) - 1.3) < 1e-4);
  assert.ok(Math.abs((mid.pfx.filterScale ?? 0) - 2.25) < 1e-4);
  assert.equal(mid.pfx.visualFilter, 'compound_eye');

  const late = evaluateFullTimelineAtTime(proj, anchor, 3.8);
  assert.equal(late.pfx.visualFilter, 'constructivism');

  // Verify JSON serialization preserves paramTracks & visualFilter
  const json = serializeDirectorProjectJson(proj);
  const parsed = parseDirectorProjectJson(json);
  assert.ok(parsed !== null);
  assert.equal(parsed!.paramTracks?.cloudCoverage?.length, 2);
  assert.equal(parsed!.postFxTrack[1].visualFilter, 'constructivism');
  assert.equal(VISUAL_FILTER_META.length, 6);

  // Verify FluidSim.setTargetParticleCount precipitates and drains reversibly & clamps safely
  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 4242, radius: 11 });
  const fluid = new FluidSim();
  fluid.seedInitialLakes(planet);
  const baseCount = fluid.activeCount;
  assert.ok(baseCount > 200);

  const grew = fluid.setTargetParticleCount(planet, baseCount + 120, 7);
  assert.equal(grew, true);
  assert.equal(fluid.activeCount, Math.min(MAX_FLUID_PARTICLES, baseCount + 120));

  const shrank = fluid.setTargetParticleCount(planet, 80, 7);
  assert.equal(shrank, true);
  assert.equal(fluid.activeCount, 80);

  const clamped = fluid.setTargetParticleCount(planet, MAX_FLUID_PARTICLES + 500, 9);
  assert.equal(clamped, true);
  assert.equal(fluid.activeCount, MAX_FLUID_PARTICLES);
});

test('Metabolism Task 1 & 2: VoxelPlanet Chunk/Vox upgrades to Eulerian FVM control volumes and Reaction Hypergraph enforces numeric stoichiometry + T/P windows', () => {
  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, seed: 202611, radius: 13 });
  const beforeStats = planet.getVoxelStats();
  const grid = planet.upgradeChunksToEulerianFvm({ boundaryMode: 'open' });

  // Upgrading Vox control volumes must preserve existing graphical density/material layout
  const afterStats = planet.getVoxelStats();
  assert.equal(afterStats.densityBytes, beforeStats.densityBytes);
  assert.equal(afterStats.materialBytes, beforeStats.materialBytes);
  assert.ok(planet.fvmGrid === grid);

  // Vox control volume at planet surface exposes speciesConc, internalEnergy, flux, phase
  const surfIy = Math.floor(planet.worldToGrid(13.0));
  const midAxis = Math.floor(planet.cellsPerAxis / 2);
  const vox = planet.getVoxControlVolume(midAxis, surfIy, midAxis);
  assert.ok(vox !== null);
  assert.equal(vox!.active, true);
  assert.ok(vox!.speciesConc instanceof Float32Array);
  assert.equal(vox!.speciesConc.length, grid.hypergraph.numSpecies);
  assert.equal(vox!.flux.length, 3);
  assert.ok(vox!.internalEnergy > 0);
  assert.ok(Object.values(MatterPhase).includes(vox!.phase));

  // probeVoxelCell carries live fvmControlVolume telemetry
  const probe = planet.probeVoxelCell(0, 13.0, 0);
  assert.ok(probe.fvmControlVolume !== undefined);
  assert.equal(probe.fvmControlVolume!.active, true);
  assert.ok(probe.fvmControlVolume!.internalEnergy > 0);
  assert.equal(probe.fvmControlVolume!.speciesConc.length, grid.hypergraph.numSpecies);

  // Reaction Hypergraph: strictly numeric indices, stoichiometric mass balance, and T/P window gating
  const openHyper = createOpenAutocatalyticHypergraph();
  assert.equal(openHyper.isStoichMassConserved, true);
  for (let r = 0; r < openHyper.numReactions; r++) {
    assert.ok(
      Math.abs(openHyper.stoichMassResiduals[r]) < 1e-6,
      `Expected exact molar mass conservation for reaction ${r}`,
    );
  }

  // Kernel never parses chemical formula strings: changing formulaTag to arbitrary strings produces identical compilation
  const patchedSpecies = openHyper.species.map((s, idx) => ({
    ...s,
    formulaTag: `ARBITRARY_UI_TAG_${idx}`,
  }));
  const patchedRxns = openHyper.reactions.map((rx, idx) => ({
    ...rx,
    uiEquationLabel: `DO_NOT_PARSE_${idx}`,
  }));
  const recompiled = compileReactionHypergraph('recompiled', 'UI Label Only', patchedSpecies, patchedRxns);
  assert.deepEqual(Array.from(recompiled.stoichMatrix), Array.from(openHyper.stoichMatrix));

  // T/P validity window gating zeroes reactions outside [minTempK, maxTempK] x [minPressureAtm, maxPressureAtm]
  const rxn0 = openHyper.reactions[0];
  assert.equal(evaluateTpWindowGate(rxn0, 325, 1.2), 1);
  assert.equal(evaluateTpWindowGate(rxn0, rxn0.minTempK - 40, 1.2), 0);
  assert.equal(evaluateTpWindowGate(rxn0, 325, rxn0.maxPressureAtm + 50), 0);
});

test('Metabolism Task 3 & 4a: Fixed operator sequence (Flux -> Reaction) and Closed System relaxes to chemical equilibrium with strict mass conservation', () => {
  const runner = new MetabolismSimRunner('closed_equilibrium', 1, 4.0, 3.0);
  assert.equal(runner.grid.boundaryMode, 'closed');

  const initTel = runner.grid.lastTelemetry;
  const initMolesA = initTel.meanConcentrations[0];
  const initStdA = initTel.speciesSpatialStdDev[0];
  const initSigma = initTel.totalEntropyProdRate;
  assert.ok(initStdA > 0.2, `Expected non-uniform initial spatial gradient, got std=${initStdA}`);
  assert.ok(initSigma > 5.0, `Expected high initial non-equilibrium entropy production, got ${initSigma}`);

  let maxRelErr = 0;
  for (let i = 0; i < 420; i++) {
    const tel = runner.stepOnce(0.08);
    assert.equal(tel.conservation.conserved, true);
    if (tel.conservation.relativeError > maxRelErr) {
      maxRelErr = tel.conservation.relativeError;
    }
    assert.equal(tel.conservation.boundaryFeedMassKg, 0);
    assert.equal(tel.conservation.boundaryExhaustMassKg, 0);
  }
  assert.ok(maxRelErr < 1e-5, `Expected strict closed-system mass conservation < 1e-5, got ${maxRelErr}`);

  const endTel = runner.grid.lastTelemetry;
  const endStdA = endTel.speciesSpatialStdDev[0];
  assert.ok(endStdA < initStdA * 0.25, `Expected diffusion to smooth spatial gradient: ${endStdA} vs ${initStdA}`);
  assert.ok(endTel.meanConcentrations[0] < initMolesA, 'Expected A to convert into B and C');
  assert.ok(endTel.meanConcentrations[1] > 0.05 && endTel.meanConcentrations[2] > 0.05);
  assert.ok(
    endTel.totalEntropyProdRate < Math.min(0.5, initSigma * 0.01),
    `Expected closed system entropy production to decay >99% toward equilibrium: ${initSigma} -> ${endTel.totalEntropyProdRate}`,
  );
});

test('Metabolism Task 4b: Open dissipative autocatalytic system verifies mass balance and positive-feedback bifurcation', () => {
  const runner = new MetabolismSimRunner('open_autocatalytic', 1, 4.0, 3.0);
  assert.equal(runner.grid.boundaryMode, 'open');

  // Verify per-step open-boundary mass accounting: M_postReact - M_pre == Feed - Exhaust
  for (let i = 0; i < 40; i++) {
    const tel = runner.stepOnce(0.05);
    const c = tel.conservation;
    assert.equal(c.conserved, true);
    assert.ok(
      c.relativeError < 1e-5,
      `Expected open-system mass balance residual < 1e-5, got ${c.relativeError}`,
    );
  }

  // Run bifurcation sweep across feed rate F in [0.04, 0.85]
  const report = runner.runAutocatalyticBifurcationSweep();
  assert.ok(report.points.length >= 10);
  const lowPt = report.points[0];
  const highPt = report.points[report.points.length - 1];

  assert.equal(lowPt.regime, 'extinction', `Expected low-feed extinction branch at F=${lowPt.feedRatePerSec}`);
  assert.equal(highPt.regime, 'dissipative_branch', `Expected active dissipative branch at F=${highPt.feedRatePerSec}`);
  assert.ok(report.criticalFeedRate !== null, 'Expected a critical feed-rate bifurcation threshold');
  assert.ok(
    highPt.steadyAutocatalystX > lowPt.steadyAutocatalystX * 3.0,
    `Expected positive-feedback amplification of X: ${lowPt.steadyAutocatalystX} -> ${highPt.steadyAutocatalystX}`,
  );
  assert.ok(
    highPt.entropyProdRate > lowPt.entropyProdRate * 2.0,
    `Expected sustained entropy production on dissipative branch: ${highPt.entropyProdRate}`,
  );
});

test('Metabolism Task 5 & 6: PIC AABB Coupling Hooks calibrate macro kinetics without MD, and Read-Only Field Renderer decouples cleanly', () => {
  const registry = new PicCouplingRegistry();
  const zone = registry.registerZone({
    id: 'hydrothermal_aabb',
    label: '热泉耦合区',
    scaleKind: 'molecular_md_calibration',
    aabbMin: [-1.5, 2.0, -1.5],
    aabbMax: [1.5, 3.8, 1.5],
    active: true,
    description: 'AABB test marker',
  });

  const grid = new EulerianFvmGrid({
    chunksPerAxis: 1,
    worldHalf: 4.0,
    baseRadius: 3.0,
    hypergraph: createOpenAutocatalyticHypergraph(),
    boundaryMode: 'open',
  });
  grid.step(0.05);

  const boundary = registry.fineGrainToLagrangian(zone, grid, grid.hypergraph);
  assert.ok(boundary.sampledVoxCount > 0);
  assert.equal(boundary.speciesConcentrationsMolM3.length, grid.hypergraph.numSpecies);
  assert.equal(boundary.speciesGradientsMolM4.length, grid.hypergraph.numSpecies);

  const diffScale = new Float64Array(grid.hypergraph.numSpecies).fill(1.0);
  diffScale[1] = 1.35;
  const patch = registry.coarseGrainToEulerian(
    zone,
    {
      zoneId: zone.id,
      microSampleSteps: 0,
      effectiveDiffusivityScale: diffScale,
      calibratedArrhenius: [{ reactionIndex: 0, effectiveForwardA: 1.45, effectiveForwardEaJ: 2450 }],
    },
    grid.hypergraph,
  );
  assert.equal(patch.diffusivityScaleApplied[1], 1.35);
  assert.equal(grid.hypergraph.calibratedDiffusivityScale[1], 1.35);
  assert.equal(grid.hypergraph.calibratedForwardA[0], 1.45);

  // Read-only render field sampling must never mutate simulation revision or concentration arrays
  const revBefore = grid.revision;
  const view = grid.getReadOnlyRenderView();
  const concCopyBefore = Float32Array.from(grid.speciesConc);
  const rgb: [number, number, number] = [0, 0, 0];
  for (const ch of ['species', 'energy', 'phase', 'flux'] as const) {
    const ok = sampleFvmRenderColor(view, 0, 2.5, 0, ch, rgb);
    assert.equal(ok, true);
    assert.ok(rgb[0] >= 0 && rgb[1] >= 0 && rgb[2] >= 0);
  }
  assert.equal(grid.revision, revBefore);
  assert.deepEqual(Array.from(grid.speciesConc), Array.from(concCopyBefore));
});

test('Metabolism Stage 2 Pillar 1: Million-voxel GPU presets, numeric kinetics packing & symmetric Ping-Pong stencil parity', () => {
  // 1. Verify resolution presets up to 128^3 = 2,097,152 voxels
  assert.equal(FVM_RESOLUTION_PRESETS[24].totalVoxels, 13_824);
  assert.equal(FVM_RESOLUTION_PRESETS[64].totalVoxels, 262_144);
  assert.equal(FVM_RESOLUTION_PRESETS[96].totalVoxels, 884_736);
  assert.equal(FVM_RESOLUTION_PRESETS[128].totalVoxels, 2_097_152);
  assert.equal(FVM_RESOLUTION_PRESETS[128].recommendedBackend, 'webgpu');

  // 2. Verify numeric kinetics packing contains zero formula string dependency
  const openHyper = createOpenAutocatalyticHypergraph();
  const packedA = packHypergraphKineticsVec4(openHyper);
  assert.equal(packedA.length, PACKED_KINETICS_VEC4_COUNT * 4);
  const retagged = compileReactionHypergraph(
    'retagged',
    'Retagged',
    openHyper.species.map((sp, i) => ({ ...sp, formulaTag: `X_TAG_${i}` })),
    openHyper.reactions.map((rx, i) => ({ ...rx, uiEquationLabel: `NO_PARSE_${i}` })),
  );
  const packedB = packHypergraphKineticsVec4(retagged);
  assert.deepEqual(Array.from(packedA), Array.from(packedB));

  // 3. Exact symmetric 2-pass Ping-Pong stencil parity test (Closed Equilibrium)
  const closedGrid = new EulerianFvmGrid({
    chunksPerAxis: 1,
    worldHalf: 4.0,
    baseRadius: 3.0,
    hypergraph: createClosedEquilibriumHypergraph(),
    boundaryMode: 'closed',
    ambientTempK: 325,
    ambientPressureAtm: 1.0,
  });
  const n = closedGrid.cellsPerAxis;
  const N = closedGrid.totalCells;
  const statePing = new Float32Array(N * 4);
  const statePong = new Float32Array(N * 4);
  const auxPing = new Float32Array(N * 4);
  const auxPong = new Float32Array(N * 4);
  const velPor = new Float32Array(N * 4);
  const meta = new Float32Array(N * 4);
  const diag = new Float32Array(N * 4);

  for (let iz = 0; iz < n; iz++) {
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const idx = closedGrid.cellIndex(ix, iy, iz);
        const [wx] = closedGrid.cellCenterWorld(ix, iy, iz);
        const cA = wx >= 0 ? 1.85 : 0.35;
        statePing[idx * 4 + 0] = cA;
        statePing[idx * 4 + 1] = 0.05;
        statePing[idx * 4 + 2] = 0.0;
        const cpVol = 1800 + cA * 40 + 0.05 * 40;
        statePing[idx * 4 + 3] = cpVol * 325;
        auxPing[idx * 4 + 3] = 325;
        velPor[idx * 4 + 3] = 0.72;
        meta[idx * 4 + 0] = 1.0; // active
        meta[idx * 4 + 3] = 1.0; // pressure atm
      }
    }
  }

  const desc = buildFvmGridDescriptor(closedGrid);
  let maxErr = 0;
  let firstEntropy = 0;
  let lastEntropy = 0;
  let firstMeanA = 0;
  let lastMeanA = 0;

  for (let s = 0; s < 120; s++) {
    const res = evaluateSymmetricFluxReactionStepCpuReference(
      desc,
      closedGrid.hypergraph,
      statePing,
      statePong,
      auxPing,
      auxPong,
      velPor,
      meta,
      diag,
      {
        dtSec: 0.06,
        boundaryMode: 'closed',
        feedRatePerSec: 0,
        exhaustRatePerSec: 0,
        feedConcentrationMolM3: 0,
        ambientTempK: 325,
      },
    );
    if (res.relativeError > maxErr) maxErr = res.relativeError;
    if (s === 0) {
      firstEntropy = res.totalEntropyProdRate;
      firstMeanA = res.meanConcentrations[0];
    }
    lastEntropy = res.totalEntropyProdRate;
    lastMeanA = res.meanConcentrations[0];
    assert.ok(res.meanConcentrations.every((v) => Number.isFinite(v) && v >= 0));
  }
  assert.ok(maxErr < 1e-5, `Expected symmetric GPU-stencil parity mass conservation < 1e-5, got ${maxErr}`);
  assert.ok(lastMeanA < firstMeanA, 'Closed stencil should convert species A toward B+C');
  assert.ok(lastEntropy < firstEntropy * 0.15, `Closed entropy should decay toward equilibrium: ${firstEntropy} -> ${lastEntropy}`);
});

test('Metabolism Stage 2 Pillar 2: PIC AABB Local Micro-Calibrator updates macro diffusivity & Arrhenius kinetics without global MD', () => {
  const runner = new MetabolismSimRunner('open_autocatalytic', 2, 10.0, 7.0);
  runner.registerDefaultCouplingZones(7.0);
  runner.stepOnce(0.05);

  const zones = runner.couplingRegistry.listZones();
  assert.ok(zones.length >= 1);
  const zone = zones[0];

  const baseA0 = runner.grid.hypergraph.calibratedForwardA[0];
  const baseEa0 = runner.grid.hypergraph.calibratedForwardEaJ[0];

  const { boundary, patch, record } = runLocalMicroCalibration(
    zone,
    runner.couplingRegistry,
    runner.grid,
    runner.grid.hypergraph,
    { particleCount: 512, microSteps: 36, microDtSec: 0.0025, seed: 4242 },
  );

  assert.ok(boundary.sampledVoxCount > 0, 'Calibration must sample voxels strictly inside registered AABB');
  assert.ok(record.msdHinderedOverFree > 0.15 && record.msdHinderedOverFree <= 1.45);
  assert.ok(record.collisionEvents >= 0);
  assert.equal(patch.diffusivityScaleApplied.length, runner.grid.hypergraph.numSpecies);
  assert.ok(
    runner.grid.hypergraph.calibratedForwardA[0] !== baseA0 ||
      runner.grid.hypergraph.calibratedForwardEaJ[0] !== baseEa0,
    'Calibrated macroscopic Arrhenius parameters must update on hypergraph',
  );

  // Runner integration entrypoint records calibration history cleanly
  const rec2 = runner.runMicroCalibration(zone.id, {
    particleCount: 256,
    microSteps: 24,
    microDtSec: 0.0025,
    seed: 9999,
  });
  assert.ok(rec2 !== null);
  assert.equal(runner.calibrationHistoryCount, 1);
  assert.ok(runner.lastCalibrationRecord !== null);
});

test('Metabolism Stage 2 Pillar 3: Bidirectional Planetary Feedback (Exothermic Hotspots + Mineralization + Brush Porosity Sync)', () => {
  const R = 13.0;
  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, radius: R, voxelRadius: 18 });
  const runner = new MetabolismSimRunner('open_autocatalytic', 3, planet.worldHalf, R);
  runner.bindToPlanet(planet, [0.7, 0.5, 0.5], DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);

  // Locate a crustal surface voxel and boost local exothermic temperature & autocatalyst concentration
  const hit = planet.raycastTerrain(0, R + 8, 0, 0, -1, 0, 24);
  assert.ok(hit.hit, 'Should locate north pole terrain surface');

  const n = runner.grid.cellsPerAxis;
  let hotspotIx = Math.floor((hit.x + runner.grid.worldHalf) / runner.grid.voxelSize);
  let hotspotIy = Math.floor((hit.y + runner.grid.worldHalf) / runner.grid.voxelSize);
  let hotspotIz = Math.floor((hit.z + runner.grid.worldHalf) / runner.grid.voxelSize);
  hotspotIx = Math.max(0, Math.min(n - 1, hotspotIx));
  hotspotIy = Math.max(0, Math.min(n - 1, hotspotIy));
  hotspotIz = Math.max(0, Math.min(n - 1, hotspotIz));
  const cIdx = runner.grid.cellIndex(hotspotIx, hotspotIy, hotspotIz);
  runner.grid.activeMask[cIdx] = 1;
  runner.grid.temperatureK[cIdx] = runner.grid.ambientTempK + 180;
  const S = runner.grid.hypergraph.numSpecies;
  runner.grid.speciesConc[cIdx * S + 1] = 2.4; // High autocatalyst X

  const accum = new Float32Array(runner.grid.totalCells);
  const evalRes = evaluateFeedbackCandidatesFromCpuGrid(
    runner.grid,
    planet,
    { ...DEFAULT_PLANETARY_FEEDBACK_CONFIG, thermalGain: 1.5, mineralizationRate: 2.0 },
    accum,
    0.8,
  );

  // 1. Exothermic hotspot emitted and heats thermal field
  assert.ok(evalRes.hotspots.length >= 1, 'High metabolic temperature should emit persistent ThermalHotspots');
  assert.equal(evalRes.hotspots[0].source, 'metabolism');
  assert.ok(evalRes.peakDeltaC > 50);

  const deltaC = computeHotspotDeltaC(evalRes.hotspots[0].x, evalRes.hotspots[0].y, evalRes.hotspots[0].z, evalRes.hotspots);
  const coolTherm = sampleThermalField(
    hit.x, hit.y, hit.z, R, [0.7, 0.5, 0.5], DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG, 0, MaterialId.Basalt, 0, 0,
  );
  const hotTherm = sampleThermalField(
    hit.x, hit.y, hit.z, R, [0.7, 0.5, 0.5], DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG, 0, MaterialId.Basalt, 0, deltaC,
  );
  assert.ok(hotTherm.tempC > coolTherm.tempC + 20, 'Metabolic hotspot should measurably raise planetary surface temperature');

  // 2. Mineralization operation emitted and writes back to VoxelPlanet material
  assert.ok(evalRes.mineralOps.length >= 1, 'Supersaturated autocatalyst near surface should emit mineralization op');
  const op = evalRes.mineralOps[0];
  planet.applyBrush(op.wx, op.wy, op.wz, op.mode, op.radius, op.strength, op.material);
  const sampledAfter = planet.sampleNearestMaterial(op.wx, op.wy, op.wz);
  assert.ok(
    sampledAfter === MaterialId.Crystal || sampledAfter === MaterialId.Basalt,
    `Expected mineralized voxel at (${op.wx.toFixed(1)}, ${op.wy.toFixed(1)}, ${op.wz.toFixed(1)}) to become Crystal or Basalt, got ${sampledAfter}`,
  );

  // 3. Terrain sculpting brush excavates rock -> porosity refreshes upward cleanly
  const southHit = planet.raycastTerrain(0, -R - 8, 0, 0, 1, 0, 24);
  assert.ok(southHit.hit);
  planet.applyBrush(southHit.x, southHit.y - 0.6, southHit.z, 'carve', 2.4, 2.2, MaterialId.Air);
  const revBeforeSync = runner.grid.revision;
  const syncedVoxels = syncLocalBrushToCpuFvmGrid(runner.grid, planet, southHit.x, southHit.y - 0.6, southHit.z, 2.4);
  assert.ok(syncedVoxels > 0, 'Brush porosity sync should refresh affected FVM control volumes');
  assert.ok(runner.grid.revision > revBeforeSync);
});

test('Metabolism Stage 3: Full 118 Periodic Elements, Compound Molar Masses, and Voxel Mineralogy Composition', () => {
  // 1. All 118 IUPAC elements present in strict order 1..118 with valid atomic masses
  assert.equal(PERIODIC_ELEMENTS.length, 118);
  for (let i = 0; i < PERIODIC_ELEMENTS.length; i++) {
    const el = PERIODIC_ELEMENTS[i];
    assert.equal(el.atomicNumber, i + 1);
    assert.ok(el.atomicMassGPerMol > 0);
    assert.ok(el.symbol.length >= 1 && el.symbol.length <= 3);
  }

  // 2. Compound molar mass strictly equals sum of constituent element masses (no string parsing in solver)
  const glucose = COMPOUND_CATALOG.find((c) => c.id === 'C6H12O6');
  assert.ok(glucose);
  const expectedGlucoseKgMol = computeCompoundMolarMassKgPerMol({ C: 6, H: 12, O: 6 });
  assert.ok(Math.abs(glucose.molarMassKgPerMol - expectedGlucoseKgMol) < 1e-6);
  assert.ok(Math.abs(glucose.molarMassKgPerMol - 0.180156) < 0.001);

  // 3. Every Voxel MaterialId mineral composition weights sum to 1.0 & elemental mass breakdown sums to 100%
  for (const matId of [
    MaterialId.Air,
    MaterialId.Soil,
    MaterialId.Stone,
    MaterialId.Basalt,
    MaterialId.Crystal,
    MaterialId.Ice,
    MaterialId.Sandstone,
  ]) {
    const comp = VOXEL_MATERIAL_COMPOSITIONS[matId];
    assert.ok(comp && comp.components.length >= 1);
    const weightSum = comp.components.reduce((acc, m) => acc + m.weightFraction, 0);
    assert.ok(Math.abs(weightSum - 1.0) < 1e-5, `Material ${matId} mineral sum ${weightSum} != 1`);

    const breakdown = computeMaterialElementalBreakdown(matId);
    const pctSum = breakdown.reduce((acc, item) => acc + item.weightPercent, 0);
    assert.ok(Math.abs(pctSum - 100) < 1e-3, `Material ${matId} elemental pct sum ${pctSum} != 100`);
  }
});

test('Metabolism Stage 3: Planetary Carbon-Water, Cellular Metabolism & Hydrology Hypergraphs conserve atoms, mass & drive bioenergetics', () => {
  // 1. Atomic element conservation + molar mass conservation across all 3 real biogeochemical/cellular hypergraphs
  for (const hg of [
    createPlanetaryCarbonWaterHypergraph(),
    createCellularMetabolismHypergraph(),
    createPlanetaryHydrologyHypergraph(),
  ]) {
    const elemCheck = verifyHypergraphElementBalance(hg);
    assert.equal(elemCheck.isElementBalanced, true, `Element balance failed for ${hg.uiTitle}`);
    assert.equal(hg.isStoichMassConserved, true, `Hypergraph mass balance failed for ${hg.uiTitle}`);
    for (let r = 0; r < hg.numReactions; r++) {
      assert.ok(
        Math.abs(hg.stoichMassResiduals[r]) < 1e-6,
        `Mass residual too large for ${hg.reactions[r].uiName}: ${hg.stoichMassResiduals[r]}`,
      );
    }
  }

  // 2. Planetary Carbon-Water Cycle run: mass conserved, reaction rates populated, Vox chemical probe works
  const cwRunner = new MetabolismSimRunner('planetary_carbon_water', 2, 10.0, 7.0);
  for (let i = 0; i < 12; i++) {
    const tel = cwRunner.stepOnce(0.05);
    assert.equal(tel.conservation.conserved, true);
    assert.ok(tel.conservation.relativeError < 1e-5);
  }
  const cwSnap = cwRunner.getSummarySnapshot();
  assert.equal(cwSnap.telemetry.meanReactionRates.length, cwSnap.hypergraph.reactions.length);
  const voxProf = cwRunner.getVoxChemicalProfile(0, 7.0, 0);
  assert.equal(voxProf.speciesConcentrations.length, 6);
  assert.ok(voxProf.elementalBreakdown.length >= 2);

  // 3. Cellular Metabolism run: aerobic dominance when O2 rich; anaerobic fermentation share rises when O2 depleted
  const cellRunner = new MetabolismSimRunner('cellular_metabolism', 2, 10.0, 7.0);
  for (let i = 0; i < 8; i++) {
    cellRunner.stepOnce(0.05);
  }
  const aeroBio = computeCellularBioTelemetry(cellRunner.grid.hypergraph, cellRunner.grid.lastTelemetry);
  assert.ok(aeroBio.atpSynthesisRateMmolLs > 0);
  assert.ok(aeroBio.aerobicSharePct > 50, `Expected aerobic share > 50% with O2 present, got ${aeroBio.aerobicSharePct}`);

  // Deplete O2 across grid -> anaerobic glycolysis / lactate share increases substantially
  const S = cellRunner.grid.hypergraph.numSpecies;
  for (let c = 0; c < cellRunner.grid.totalCells; c++) {
    cellRunner.grid.speciesConc[c * S + 0] = 2.4; // rich glucose
    cellRunner.grid.speciesConc[c * S + 1] = 0.0; // anoxic O2
  }
  cellRunner.stepOnce(0.05);
  const anoxBio = computeCellularBioTelemetry(cellRunner.grid.hypergraph, cellRunner.grid.lastTelemetry);
  assert.ok(
    anoxBio.anaerobicSharePct > aeroBio.anaerobicSharePct,
    `Expected anaerobic share under hypoxia (${anoxBio.anaerobicSharePct}%) > normoxia (${aeroBio.anaerobicSharePct}%)`,
  );
});

test('Metabolism Stage 3: 6-Species GPU Ping-Pong Stencil Parity (Planetary Carbon-Water Cycle)', () => {
  const hg = createPlanetaryCarbonWaterHypergraph();
  const packed = packHypergraphKineticsVec4(hg);
  assert.equal(packed.length, PACKED_KINETICS_VEC4_COUNT * 4);

  const grid = new EulerianFvmGrid({
    chunksPerAxis: 1,
    worldHalf: 10.0,
    baseRadius: 7.0,
    hypergraph: hg,
    boundaryMode: 'closed',
  });
  const n = grid.cellsPerAxis;
  const desc = buildFvmGridDescriptor(grid);
  const total = desc.totalCells;
  const s012Ping = new Float32Array(total * 4);
  const s012Pong = new Float32Array(total * 4);
  const s345Ping = new Float32Array(total * 4);
  const s345Pong = new Float32Array(total * 4);
  const auxPing = new Float32Array(total * 4);
  const auxPong = new Float32Array(total * 4);
  const velPor = new Float32Array(total * 4);
  const meta = new Float32Array(total * 4);
  const diag = new Float32Array(total * 4);

  for (let iz = 0; iz < n; iz++) {
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const idx = ix + iy * n + iz * n * n;
        s012Ping[idx * 4 + 0] = 1.2; // CO2
        s012Ping[idx * 4 + 1] = 0.6; // H2O(g)
        s012Ping[idx * 4 + 2] = ix < 4 ? 2.0 : 0.8; // H2O(l)
        s012Ping[idx * 4 + 3] = 296 * 2200; // internal energy
        s345Ping[idx * 4 + 0] = ix < 4 ? 1.1 : 0.2; // CH2O
        s345Ping[idx * 4 + 1] = 0.9; // O2
        s345Ping[idx * 4 + 2] = 0.1; // CH4
        auxPing[idx * 4 + 3] = 296;
        velPor[idx * 4 + 3] = 0.7;
        meta[idx * 4 + 0] = 1.0;
        meta[idx * 4 + 1] = 1.0;
        meta[idx * 4 + 2] = 1.0;
      }
    }
  }

  let maxErr = 0;
  for (let s = 0; s < 10; s++) {
    const even = s % 2 === 0;
    const res = evaluateSymmetricFluxReactionStepCpuReference(
      desc,
      hg,
      even ? s012Ping : s012Pong,
      even ? s012Pong : s012Ping,
      even ? auxPing : auxPong,
      even ? auxPong : auxPing,
      velPor,
      meta,
      diag,
      {
        dtSec: 0.04,
        boundaryMode: 'closed',
        feedRatePerSec: 0,
        exhaustRatePerSec: 0,
        feedConcentrationMolM3: 0,
        ambientTempK: 296,
      },
      even ? s345Ping : s345Pong,
      even ? s345Pong : s345Ping,
    );
    if (res.relativeError > maxErr) maxErr = res.relativeError;
    assert.equal(res.meanConcentrations.length, 6);
    assert.ok(res.meanConcentrations.every((v) => Number.isFinite(v) && v >= 0));
  }
  assert.ok(maxErr < 1e-5, `Expected 6-species GPU stencil mass conservation < 1e-5, got ${maxErr}`);
});

test('Metabolism Stage 4: Mineral/Rate 6-channel FVM render view & VoxChemicalProfile live formula evaluations', () => {
  const runner = new MetabolismSimRunner('planetary_carbon_water', 2, 10.0, 7.0);
  for (let i = 0; i < 6; i++) {
    runner.stepOnce(0.05);
  }

  // 1. FvmRenderFieldView exposes porosity and entropyProdRate read-only buffers
  const view = runner.getReadOnlyRenderView();
  assert.equal(view.porosity.length, runner.grid.totalCells);
  assert.equal(view.entropyProdRate.length, runner.grid.totalCells);

  // 2. sampleFvmRenderColor supports 'mineral' (with MaterialId) & 'rate' channels cleanly
  const rgbMineral: [number, number, number] = [0, 0, 0];
  const rgbRate: [number, number, number] = [0, 0, 0];
  const hitMineral = sampleFvmRenderColor(view, 0, 7.0, 0, 'mineral', rgbMineral, MaterialId.Crystal);
  const hitRate = sampleFvmRenderColor(view, 0, 7.0, 0, 'rate', rgbRate);
  assert.equal(hitMineral, true);
  assert.equal(hitRate, true);
  assert.ok(rgbMineral.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));
  assert.ok(rgbRate.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));

  // 3. VoxChemicalProfile carries full thermodynamic & kinetic substitution fields matching core math
  const prof = runner.getVoxChemicalProfile(0, 7.0, 0);
  assert.ok(prof.cellVolumeM3 > 0);
  assert.ok(prof.heatCapacityJm3K >= 1800);
  assert.ok(prof.internalEnergyJm3 > 0);
  assert.ok(prof.voxelMassKg > 0);
  assert.equal(prof.reactionEvaluations.length, runner.grid.hypergraph.reactions.length);

  const rxn0 = runner.grid.hypergraph.reactions[0];
  const eval0 = prof.reactionEvaluations[0];
  const expectedTpGate = evaluateTpWindowGate(rxn0, prof.temperatureK, prof.pressureAtm);
  const expectedKf =
    evaluateArrheniusRateConstant(
      runner.grid.hypergraph.calibratedForwardA[0],
      runner.grid.hypergraph.calibratedForwardEaJ[0],
      rxn0.tempExponentBeta ?? 0,
      prof.temperatureK,
    ) * expectedTpGate;
  assert.ok(Math.abs(eval0.tpGate - expectedTpGate) < 1e-6);
  assert.ok(Math.abs(eval0.kf - expectedKf) < 1e-6);
  assert.ok(Number.isFinite(eval0.enthalpyRateWm3));
});

test('Metabolism Stage 5: Core-Mantle-Crust Stratification, Reversible Cutaway, Epic Landforms & pangaea_epic Preset', () => {
  const epicPreset = PLANET_PRESETS.find((p) => p.id === 'pangaea_epic');
  assert.ok(epicPreset, 'Expected pangaea_epic preset in PLANET_PRESETS');

  const planet = new VoxelPlanet({ ...epicPreset.config, voxelRadius: 18 });
  const R = planet.baseRadius;

  // 1. Stratified Core-Mantle-Crust materials
  const coreMat = planet.sampleNearestMaterial(0, 0, 0);
  const outerCoreMat = planet.sampleNearestMaterial(R * 0.23, 0, 0);
  const mantleSamples = [
    planet.sampleNearestMaterial(R * 0.72, 0, 0),
    planet.sampleNearestMaterial(-R * 0.72, 0, 0),
    planet.sampleNearestMaterial(0, R * 0.72, 0),
    planet.sampleNearestMaterial(0, 0, R * 0.72),
  ];
  assert.equal(coreMat, MaterialId.Crystal, 'Inner Core (r < 0.17 R0) should be crystalline Fe-Ni');
  assert.ok(
    outerCoreMat === MaterialId.Basalt || outerCoreMat === MaterialId.Crystal,
    'Outer Core / Deep Mantle should be molten Basalt or Crystal vein',
  );
  assert.ok(
    mantleSamples.every((m) => m === MaterialId.Stone || m === MaterialId.Crystal),
    'Upper Mantle / Lower Crust should consist of silicate Stone and rising Crystal plume conduits',
  );
  assert.ok(
    mantleSamples.includes(MaterialId.Stone),
    'Expected silicate Stone across Upper Mantle shell',
  );

  // 2. Epic basins & craters seeded cleanly with water
  assert.ok(
    planet.lakeBasinCenters.length >= 4,
    `Expected >= 4 crater+tectonic basin centers, got ${planet.lakeBasinCenters.length}`,
  );
  const fluid = new FluidSim();
  fluid.seedInitialLakes(planet);
  assert.ok(fluid.activeCount >= 200, `Expected water particles across lakes/basins, got ${fluid.activeCount}`);

  // 3. Reversible 90-deg spherical cutaway exposes core while preserving exact pre-cutaway restore
  const preDens = planet.sampleDensity(R * 0.45, R * 0.45, R * 0.45);
  assert.ok(preDens > 0, 'Crust/mantle quadrant should initially be solid');

  const toggledOn = planet.setInteriorCutaway(true);
  assert.equal(toggledOn, true);
  assert.equal(planet.isInteriorCutawayEnabled(), true);
  assert.ok(planet.sampleDensity(0, 0, 0) > 0, 'Inner core sphere must remain solid inside cutaway');
  assert.ok(
    planet.sampleDensity(R * 0.45, R * 0.45, R * 0.45) <= 0,
    'Exposed (+X,+Y,+Z) octant outside core must be carved open',
  );

  const toggledOff = planet.setInteriorCutaway(false);
  assert.equal(toggledOff, true);
  assert.equal(planet.isInteriorCutawayEnabled(), false);
  const postRestoreDens = planet.sampleDensity(R * 0.45, R * 0.45, R * 0.45);
  assert.ok(
    Math.abs(postRestoreDens - preDens) < 1e-5,
    `Expected exact restoration after disabling cutaway (${preDens} vs ${postRestoreDens})`,
  );
});

test('Metabolism Stage 5: FVM-Driven Volcanism, Tectonic Quakes, Plateau Uplift, Fluvial Erosion & Deep-Time Epochs', () => {
  const R = 13.0;
  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, radius: R, voxelRadius: 18 });
  const runner = new MetabolismSimRunner('planetary_carbon_water', 3, planet.worldHalf, R);
  runner.bindToPlanet(planet, [0.7, 0.5, 0.5], DEFAULT_ATMOS_CONFIG, DEFAULT_THERMAL_CONFIG);

  // 1. Trigger volcano: builds volcanic basalt cone, degasses heat & CO2 into FVM grid
  const rev0 = planet.voxelRevision;
  const gridRev0 = runner.grid.revision;
  const vRes = runner.triggerGeologicalEvent('volcano', planet, [R, 0, 0]);
  assert.ok(vRes.terrainOps.some((o) => o.mode === 'volcano'));
  assert.ok(vRes.hotspots.length >= 1 && vRes.hotspots[0].deltaC >= 400);
  assert.ok(planet.voxelRevision > rev0);
  assert.ok(runner.grid.revision > gridRev0);

  // 2. Trigger earthquake: records Mw >= 6.0 and fractures fault porosity
  const qRes = runner.triggerGeologicalEvent('quake', planet, [0, R, 0]);
  assert.ok(qRes.quakes.length === 1 && qRes.quakes[0].magnitudeMw >= 6.0);
  assert.ok(qRes.terrainOps.some((o) => o.mode === 'quake' && o.shape === 'cylinder'));

  // 3. Trigger uplift & fluvial erosion: spawns rain particles & modifies sandstone/stone
  const eRes = runner.triggerGeologicalEvent('erosion', planet, [0, 0, R]);
  assert.ok(eRes.fluidOps.some((f) => f.kind === 'spawn_rain'));

  // 4. Autonomous CPU FVM tectonic/fluvial evaluation responds cleanly to thermal & flux anomalies
  const idx = runner.grid.cellIndex(
    Math.floor(runner.grid.cellsPerAxis / 2),
    Math.min(runner.grid.cellsPerAxis - 1, Math.floor(runner.grid.cellsPerAxis * 0.78)),
    Math.floor(runner.grid.cellsPerAxis / 2),
  );
  runner.grid.activeMask[idx] = 1;
  runner.grid.temperatureK[idx] = runner.grid.ambientTempK + 210;
  runner.grid.pressureAtm[idx] = 6.5;
  runner.grid.fluxX[idx] = 0.25;
  const accum = new Float32Array(runner.grid.totalCells).fill(2.0);
  const autoGeo = evaluateTectonicAndFluvialCandidatesFromCpuGrid(
    runner.grid,
    planet,
    DEFAULT_PLANETARY_FEEDBACK_CONFIG,
    { ...DEFAULT_GEOLOGICAL_EVOLUTION_CONFIG, epochAcceleration: 25 },
    accum,
    1.0,
    5,
  );
  assert.ok(autoGeo.terrainOps.length >= 1, 'High FVM thermal/flux gradients should trigger autonomous geological ops');

  // 5. Deep-Time Epoch ("沧海桑田"): steps coupled solver and executes multi-process morphogenesis
  const epochRes = runner.runDeepTimeEpoch(10, planet);
  assert.ok(epochRes.stepsExecuted >= 3);
  assert.ok(epochRes.terrainOpsApplied >= 4);
  const snap = runner.getSummarySnapshot();
  assert.ok(snap.geologicalStats.geologicalAgeMyr >= 10);
  assert.ok(snap.geologicalStats.activeVolcanoCount >= 1);
  assert.ok(snap.geologicalStats.quakeCount >= 2);
  assert.ok(snap.geologicalStats.recentGeoEvents.length >= 3);
  assert.equal(snap.telemetry.conservation.conserved, true);
});

test('Distant Horizons LOD: surface horizon pyramid, strict timeBudgetMs cap, non-overlapping partition, and extended clip far', () => {
  // 1. Extended horizon clip plane reaches planetary limb while keeping 24-bit depth ratio healthy
  const dhClips = computeSafeClipPlanes(1.5, 1.6, 26.0, 62);
  assert.ok(
    dhClips.far >= 26.0 * 4.4,
    `Expected horizon far clip >= 4.4*R (114.4m), got ${dhClips.far}`,
  );
  assert.ok(
    dhClips.far / dhClips.near <= 2.5e5,
    `Expected depth ratio <= 2.5e5, got ${dhClips.far / dhClips.near}`,
  );

  // 2. Time-budgeted streaming caps work per pass cleanly and converges incrementally
  const epicPreset = PLANET_PRESETS.find((p) => p.id === 'pangaea_epic');
  assert.ok(epicPreset, 'Expected pangaea_epic preset');
  const epicCfg = {
    ...epicPreset!.config,
    seed: 661122,
  };
  const planet = new VoxelPlanet(epicCfg);
  assert.equal(planet.isHighResStreaming, true);

  const sy = planet.findSurfaceRadiusAlongRay(0, 1, 0);
  const camPos: [number, number, number] = [0, sy + 1.4, 0];
  const camFwd: [number, number, number] = [0, 0, -1];
  const focusPos: [number, number, number] = [0, sy, -2.5];

  const firstBudgeted = planet.streamHighResAround(
    focusPos[0],
    focusPos[1],
    focusPos[2],
    'blocky',
    40,
    2.8,
    camPos,
    camFwd,
    { lodMode: 'auto', lod0Dist: 38, timeBudgetMs: 0.01, distantHorizon: true },
  );
  assert.equal(firstBudgeted.active, true);
  assert.ok(firstBudgeted.pendingTotal > 0, 'Tiny timeBudgetMs should defer remaining builds to subsequent frames');
  assert.ok(
    firstBudgeted.rebuiltMeshes.length <= 12,
    `Expected timeBudgetMs=0.01 to yield quickly with <=12 built meshes, got ${firstBudgeted.rebuiltMeshes.length}`,
  );

  // 3. Converge Distant Horizons surface pyramid across horizon
  let lastBatch = firstBudgeted;
  for (let pass = 0; pass < 60 && lastBatch.pendingTotal > 0; pass++) {
    lastBatch = planet.streamHighResAround(
      focusPos[0],
      focusPos[1],
      focusPos[2],
      'blocky',
      48,
      2.8,
      camPos,
      camFwd,
      { lodMode: 'auto', lod0Dist: 38, distantHorizon: true },
    );
  }
  assert.equal(lastBatch.pendingTotal, 0, 'Distant Horizons pyramid should converge completely');
  assert.equal(lastBatch.hideMacro, true);

  // Verify non-overlapping dyadic partition invariant
  for (const kStr of lastBatch.desiredKeys) {
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
      assert.equal(
        lastBatch.desiredKeys.has(`${asm}:${ax},${ay},${az}`),
        false,
        `Overlapping Distant Horizons leaf ${kStr} and ancestor ${asm}:${ax},${ay},${az}`,
      );
    }
  }

  // Verify multi-tier LOD cascade covers foreground 1:1 blocks and wide horizon shells
  const scaleCounts = new Map<number, number>();
  let maxDistInForwardCone = 0;
  let forwardHighResCount = 0;
  for (const kStr of lastBatch.desiredKeys) {
    const ch = planet.sparseChunks.get(kStr);
    if (!ch || ch.isEmpty) continue;
    scaleCounts.set(ch.scaleMult, (scaleCounts.get(ch.scaleMult) ?? 0) + 1);
    const span = 8 * ch.stepSize;
    const dx = ch.originX + span * 0.5 - camPos[0];
    const dy = ch.originY + span * 0.5 - camPos[1];
    const dz = ch.originZ + span * 0.5 - camPos[2];
    const dist = Math.hypot(dx, dy, dz);
    const fwdDot = dist > 1e-4 ? (dx * camFwd[0] + dy * camFwd[1] + dz * camFwd[2]) / dist : 1;
    if (fwdDot > 0.25 && ch.scaleMult <= 4) {
      forwardHighResCount++;
      if (dist > maxDistInForwardCone) maxDistInForwardCone = dist;
    }
  }
  assert.ok((scaleCounts.get(1) ?? 0) >= 4, `Expected native 1:1 foreground chunks, got ${scaleCounts.get(1) ?? 0}`);
  assert.ok(scaleCounts.size >= 3, `Expected >=3 active LOD scales in Distant Horizons pyramid, got ${scaleCounts.size}`);
  assert.ok(forwardHighResCount >= 30, `Expected broad horizon dome in forward cone, got ${forwardHighResCount}`);
  assert.ok(maxDistInForwardCone >= 12.0, `Expected sweeping horizon reach >= 12m, got ${maxDistInForwardCone.toFixed(2)}m`);
});

function makeDummyHistoryEntry(id: number, label: string): VoxelHistoryEntry {
  return {
    id,
    label,
    timestamp: 1000 + id,
    center: [0, 13, 0],
    radius: 1.5,
    macro: {
      indices: new Uint32Array([id]),
      prevDensity: new Float32Array([0]),
      nextDensity: new Float32Array([id]),
      prevMaterial: new Uint8Array([MaterialId.Stone]),
      nextMaterial: new Uint8Array([MaterialId.Soil]),
      dirtyChunkIndices: new Uint32Array([0]),
    },
    sparseChunks: [],
    brushOpsChanged: false,
  };
}

test('CircularVoxelHistoryBuffer enforces fixed capacity wrap-around, redo branch truncation, and clear', () => {
  const ring = new CircularVoxelHistoryBuffer(3);
  assert.equal(ring.capacity, 3);
  assert.equal(ring.canUndo(), false);
  assert.equal(ring.canRedo(), false);
  assert.equal(ring.undo(), null);
  assert.equal(ring.redo(), null);

  // Push 4 entries into capacity-3 circular buffer: entry 1 should be overwritten
  ring.push(makeDummyHistoryEntry(1, 'op-1'));
  ring.push(makeDummyHistoryEntry(2, 'op-2'));
  ring.push(makeDummyHistoryEntry(3, 'op-3'));
  assert.equal(ring.getSize(), 3);
  assert.equal(ring.getHeadIndex(), 0);
  assert.equal(ring.getUndoCount(), 3);
  assert.equal(ring.getRedoCount(), 0);

  ring.push(makeDummyHistoryEntry(4, 'op-4'));
  assert.equal(ring.getSize(), 3);
  assert.equal(ring.getHeadIndex(), 1, 'Head should wrap modulo capacity=3 after oldest overwrite');
  assert.equal(ring.getUndoCount(), 3);
  assert.equal(ring.peekUndoLabel(), 'op-4');
  assert.deepEqual(
    ring.getUndoEntriesOrdered().map((e) => e.id),
    [2, 3, 4],
  );

  // Undo twice (op-4, op-3) and redo once (op-3)
  assert.equal(ring.undo()?.id, 4);
  assert.equal(ring.undo()?.id, 3);
  assert.equal(ring.getUndoCount(), 1);
  assert.equal(ring.getRedoCount(), 2);
  assert.equal(ring.peekUndoLabel(), 'op-2');
  assert.equal(ring.peekRedoLabel(), 'op-3');

  assert.equal(ring.redo()?.id, 3);
  assert.equal(ring.getUndoCount(), 2);
  assert.equal(ring.getRedoCount(), 1);
  assert.equal(ring.peekRedoLabel(), 'op-4');

  // New push truncates invalidated redo tail (op-4)
  ring.push(makeDummyHistoryEntry(5, 'op-5'));
  assert.equal(ring.canRedo(), false);
  assert.equal(ring.getRedoCount(), 0);
  assert.equal(ring.getUndoCount(), 3);
  assert.deepEqual(
    ring.getUndoEntriesOrdered().map((e) => e.id),
    [2, 3, 5],
  );

  // Undo past empty stops at op-2 and never leaks overwritten op-1
  assert.equal(ring.undo()?.id, 5);
  assert.equal(ring.undo()?.id, 3);
  assert.equal(ring.undo()?.id, 2);
  assert.equal(ring.canUndo(), false);
  assert.equal(ring.undo(), null);
  assert.equal(ring.getRedoCount(), 3);

  // Push after undoing everything resets stack to single entry
  ring.push(makeDummyHistoryEntry(6, 'op-6'));
  assert.equal(ring.getSize(), 1);
  assert.equal(ring.getUndoCount(), 1);
  assert.equal(ring.canRedo(), false);
  assert.equal(ring.peekUndoLabel(), 'op-6');

  ring.clear();
  assert.equal(ring.getSize(), 0);
  assert.equal(ring.canUndo(), false);
  assert.equal(ring.canRedo(), false);
});

test('VoxelPlanet sculpting undo/redo reverts and re-applies macro edits, continuous strokes, paint, and SVO sparse chunks', () => {
  // 1. Macro sculpting round-trip + stroke coalescing + redo truncation
  const planet = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, voxelRadius: 18, radius: 13 });
  const hit = planet.raycastTerrain(0, 26, 0, 0, -1, 0, 30);
  assert.equal(hit.hit, true);

  const baselineDensity = new Float32Array(planet.density);
  const baselineMaterial = new Uint8Array(planet.material);

  // Step 1: Single carve edit
  planet.applyBrush(hit.x, hit.y, hit.z, 'carve', 2.4, 2.0, MaterialId.Air);
  assert.equal(planet.canUndo(), true);
  assert.equal(planet.getHistorySnapshot().undoCount, 1);
  assert.ok(
    planet.sampleDensity(hit.x - hit.nx * 0.4, hit.y - hit.ny * 0.4, hit.z - hit.nz * 0.4) <
      0.5,
  );
  const afterCarveDensity = new Float32Array(planet.density);
  const afterCarveMaterial = new Uint8Array(planet.material);

  // Step 2: Continuous multi-step drag grouped into ONE stroke entry
  planet.beginHistoryStroke('连续拖拽塑形');
  planet.applyBrush(hit.x + 1.2, hit.y, hit.z, 'build', 1.8, 1.8, MaterialId.Crystal);
  planet.applyBrush(hit.x + 2.4, hit.y, hit.z, 'build', 1.8, 1.8, MaterialId.Crystal);
  planet.applyBrush(hit.x + 2.4, hit.y, hit.z, 'paint', 2.0, 1.0, MaterialId.Ice);
  const committedStroke = planet.commitHistoryStroke();
  assert.ok(committedStroke !== null);
  assert.equal(committedStroke?.label, '连续拖拽塑形');
  assert.equal(planet.getHistorySnapshot().undoCount, 2);

  const afterStrokeDensity = new Float32Array(planet.density);
  const afterStrokeMaterial = new Uint8Array(planet.material);

  // runWithoutHistory ignores background mutations without pushing history
  planet.runWithoutHistory(() => {
    assert.equal(planet.getHistorySnapshot().undoCount, 2);
  });

  // Undo continuous stroke -> exact match with post-carve state
  const undoStroke = planet.undo();
  assert.ok(undoStroke !== null);
  assert.equal(planet.getHistorySnapshot().undoCount, 1);
  assert.equal(planet.getHistorySnapshot().redoCount, 1);
  assert.deepEqual(planet.density, afterCarveDensity);
  assert.deepEqual(planet.material, afterCarveMaterial);

  // Redo continuous stroke -> exact match with post-stroke state
  const redoStroke = planet.redo();
  assert.ok(redoStroke !== null);
  assert.equal(planet.getHistorySnapshot().undoCount, 2);
  assert.equal(planet.getHistorySnapshot().redoCount, 0);
  assert.deepEqual(planet.density, afterStrokeDensity);
  assert.deepEqual(planet.material, afterStrokeMaterial);

  // Undo both operations back to baseline seed terrain
  assert.ok(planet.undo() !== null);
  assert.ok(planet.undo() !== null);
  assert.equal(planet.canUndo(), false);
  assert.equal(planet.getHistorySnapshot().redoCount, 2);
  assert.deepEqual(planet.density, baselineDensity);
  assert.deepEqual(planet.material, baselineMaterial);

  // Perform a new edit after undoing everything: old redo branch must be discarded
  planet.applyBrush(hit.x, hit.y, hit.z, 'crater', 2.6, 2.2, MaterialId.Basalt, {
    rimHeight: 0.75,
    rimMaterial: MaterialId.Sandstone,
  });
  assert.equal(planet.canRedo(), false);
  assert.equal(planet.getHistorySnapshot().undoCount, 1);
  assert.ok(planet.undo() !== null);
  assert.deepEqual(planet.density, baselineDensity);
  assert.deepEqual(planet.material, baselineMaterial);

  // Regenerate clears history
  planet.applyBrush(hit.x, hit.y, hit.z, 'build', 1.5, 1.5, MaterialId.Stone);
  assert.equal(planet.canUndo(), true);
  planet.generatePlanet(planet.seedConfig);
  assert.equal(planet.canUndo(), false);
  assert.equal(planet.canRedo(), false);

  // 2. High-res (>1B^3 SVO) sparse chunk + brushOps undo/redo
  const svo = new VoxelPlanet({ ...DEFAULT_SEED_CONFIG, voxelRadius: 512, radius: 13 });
  const svoHit = svo.raycastTerrain(0, 26, 0, 0, -1, 0, 30);
  assert.equal(svoHit.hit, true);
  const probeY = svoHit.y - svoHit.ny * 0.15;
  const origDens = svo.sampleDensity(svoHit.x, probeY, svoHit.z);
  assert.ok(origDens > 0);

  svo.applyBrush(svoHit.x, svoHit.y, svoHit.z, 'carve', 0.85, 2.4, MaterialId.Air);
  const carvedDens = svo.sampleDensity(svoHit.x, probeY, svoHit.z);
  assert.ok(carvedDens < origDens, 'SVO carve should lower density at probe point');

  const svoUndo = svo.undo();
  assert.ok(svoUndo !== null);
  const undoneDens = svo.sampleDensity(svoHit.x, probeY, svoHit.z);
  assert.ok(
    Math.abs(undoneDens - origDens) < 1e-5,
    `SVO undo should restore exact pre-carve density (${origDens}), got ${undoneDens}`,
  );

  const svoRedo = svo.redo();
  assert.ok(svoRedo !== null);
  const redoneDens = svo.sampleDensity(svoHit.x, probeY, svoHit.z);
  assert.ok(
    Math.abs(redoneDens - carvedDens) < 1e-5,
    `SVO redo should restore exact carved density (${carvedDens}), got ${redoneDens}`,
  );
});


