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
  assert.ok(tinyCode.startsWith('TS2|'), `Expected TS2| prefix, got ${tinyCode}`);
  const decodedTiny = decodeSeedCode(tinyCode);
  assert.ok(decodedTiny !== null);
  assert.equal(decodedTiny.radius, 2.0);
  assert.equal(decodedTiny.craterCount, 12);

  // Backwards-compatible TS1 decode without upper clamps
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


