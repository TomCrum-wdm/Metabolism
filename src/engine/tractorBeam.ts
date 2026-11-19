import {
  computeEscapeVelocity,
  computeGravityMagnitude,
  computeGravityVector,
  EARTH_SURFACE_GRAVITY,
  PlanetaryGravityParams,
  Vec3Like,
} from './gravity';

export interface TractorRayPickResult {
  hit: boolean;
  t: number;
  distSq: number;
}

export interface TractorBeamTelemetry {
  active: boolean;
  capturedFluidCount: number;
  capturedEntityCount: number;
  localGravityMs2: number;
  beamForceN: number;
  gravityWeightN: number;
  loadRatio: number;
  stretchDistanceM: number;
  peakSpeedMs: number;
  escapeVelocityMs: number;
  nearEscape: boolean;
}

export interface TractorForceParams {
  /** Base planet radius R0 in meters */
  planetRadius: number;
  /** Tool strength multiplier * brushStrength */
  beamPower: number;
  /** Compensates local gravity automatically before saturation (0..1) */
  gravityCompFactor: number;
  /** Maximum acceleration multiple relative to reference surface gravity */
  maxAccelG: number;
  /** Particle / object mass in kg for Newtonian force readout */
  massKg: number;
}

export interface TractorForceResult {
  fx: number;
  fy: number;
  fz: number;
  beamForceN: number;
  gravityWeightN: number;
  localGravityMs2: number;
  loadRatio: number;
  saturated: boolean;
}

export function createIdleTractorTelemetry(): TractorBeamTelemetry {
  return {
    active: false,
    capturedFluidCount: 0,
    capturedEntityCount: 0,
    localGravityMs2: EARTH_SURFACE_GRAVITY,
    beamForceN: 0,
    gravityWeightN: 0,
    loadRatio: 0,
    stretchDistanceM: 0,
    peakSpeedMs: 0,
    escapeVelocityMs: 16.0,
    nearEscape: false,
  };
}

/**
 * Computes the shortest squared distance from a 3D point P to ray (O + t*D), t >= 0.
 * Zero allocations.
 */
export function computeRayPointDistanceSq(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
  out?: TractorRayPickResult,
): TractorRayPickResult {
  const rx = px - ox;
  const ry = py - oy;
  const rz = pz - oz;
  const t = Math.max(0, rx * dx + ry * dy + rz * dz);
  const cx = ox + dx * t - px;
  const cy = oy + dy * t - py;
  const cz = oz + dz * t - pz;
  const distSq = cx * cx + cy * cy + cz * cz;
  if (out) {
    out.hit = true;
    out.t = t;
    out.distSq = distSq;
    return out;
  }
  return { hit: true, t, distSq };
}

/**
 * Intersects a cursor ray (O + t*D) with a drag plane passing through `planeOrigin`
 * with unit normal `planeNormal`, clamping distance inside reasonable planetary bounds.
 */
export function intersectCursorWithDragPlane(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  planeX: number,
  planeY: number,
  planeZ: number,
  nx: number,
  ny: number,
  nz: number,
  minRayDist: number,
  maxRayDist: number,
  planetBaseRadius: number,
  out: Vec3Like,
): boolean {
  const denom = dx * nx + dy * ny + dz * nz;
  if (Math.abs(denom) < 1e-4) {
    return false;
  }
  const num = (planeX - ox) * nx + (planeY - oy) * ny + (planeZ - oz) * nz;
  let t = num / denom;
  if (t < minRayDist) t = minRayDist;
  if (t > maxRayDist) t = maxRayDist;

  let tx = ox + dx * t;
  let ty = oy + dy * t;
  let tz = oz + dz * t;

  // Keep drag point from collapsing directly onto planet singularity (0,0,0)
  const r = Math.hypot(tx, ty, tz);
  const minCoreR = Math.max(0.08 * planetBaseRadius, 1e-4);
  if (r < minCoreR && r > 1e-8) {
    const s = minCoreR / r;
    tx *= s;
    ty *= s;
    tz *= s;
  } else if (r <= 1e-8) {
    tx = 0;
    ty = minCoreR;
    tz = 0;
  }

  out.x = tx;
  out.y = ty;
  out.z = tz;
  return true;
}

const _gravScratch: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * Computes an individual particle/object's stretched target coordinate along the elastic
 * tractor filament spanning [anchorLag -> targetHead] using stretch fraction u in [0, 1].
 */
export function evaluateStretchedAnchorPoint(
  anchorX: number,
  anchorY: number,
  anchorZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  stretchU: number,
  stretchStrength = 0.68,
  out: Vec3Like,
): Vec3Like {
  const u = stretchU < 0 ? 0 : stretchU > 1 ? 1 : stretchU;
  // Blend between lagging anchor and cursor head so particles elongate along the drag vector
  const blend = (1 - stretchStrength) + stretchStrength * u;
  out.x = anchorX + (targetX - anchorX) * blend;
  out.y = anchorY + (targetY - anchorY) * blend;
  out.z = anchorZ + (targetZ - anchorZ) * blend;
  return out;
}

/**
 * Computes Newtonian tractor beam spring-damper force coupled with the planet's
 * real inverse-square / Shell Theorem gravity field g(r).
 *
 * Because the physics integrator adds gravity g(r) separately, returning a finite-capacity
 * tractor force with partial gravity compensation produces:
 * - Zero sag & zero tension in 0g
 * - Realistic gravitational sag & higher beam load in 1g..4g
 * - Inverse-square weight reduction as objects are lifted into high orbit (r > R0)
 */
export function computeTractorSpringForce(
  px: number,
  py: number,
  pz: number,
  vx: number,
  vy: number,
  vz: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  dragVelX: number,
  dragVelY: number,
  dragVelZ: number,
  gravityParams: PlanetaryGravityParams,
  beamParams: TractorForceParams,
  captureWeight: number,
  out: TractorForceResult,
): TractorForceResult {
  const scale = Math.max(beamParams.planetRadius / 13.0, 0.005);
  computeGravityVector(px, py, pz, gravityParams, _gravScratch);
  const localG = Math.hypot(_gravScratch.x, _gravScratch.y, _gravScratch.z);
  const mass = Math.max(beamParams.massKg, 0.05);
  const weightN = mass * localG;

  // Natural frequency & critical damping tuned cleanly across planet scales
  const power = Math.max(0.2, beamParams.beamPower) * Math.max(0.1, captureWeight);
  const omega = (6.8 + 4.4 * Math.sqrt(power)) / Math.sqrt(Math.max(scale, 0.15));
  const stiffness = omega * omega;
  const damping = 2.0 * 0.88 * omega;

  const ex = targetX - px;
  const ey = targetY - py;
  const ez = targetZ - pz;

  const rvx = vx - dragVelX;
  const rvy = vy - dragVelY;
  const rvz = vz - dragVelZ;

  // Spring pull + velocity matching + partial Newtonian gravity compensation (-comp * g)
  const comp = Math.max(0, Math.min(1, beamParams.gravityCompFactor));
  let ax = ex * stiffness - rvx * damping - _gravScratch.x * comp;
  let ay = ey * stiffness - rvy * damping - _gravScratch.y * comp;
  let az = ez * stiffness - rvz * damping - _gravScratch.z * comp;

  // Enforce physical beam capacity ceiling so extreme gravity or overloaded mass visibly sags
  const refG = Math.max(EARTH_SURFACE_GRAVITY, gravityParams.surfaceGravity * 0.45);
  const maxAccel = Math.max(beamParams.maxAccelG, 1.5) * refG * Math.max(0.35, power) * scale;
  const aMag = Math.hypot(ax, ay, az);
  let saturated = false;
  if (aMag > maxAccel && aMag > 1e-6) {
    const s = maxAccel / aMag;
    ax *= s;
    ay *= s;
    az *= s;
    saturated = true;
  }

  const fx = ax * mass;
  const fy = ay * mass;
  const fz = az * mass;
  const beamForceN = Math.hypot(fx, fy, fz);
  const loadRatio = weightN > 1e-4 ? beamForceN / weightN : beamForceN > 1e-3 ? 1 : 0;

  out.fx = fx;
  out.fy = fy;
  out.fz = fz;
  out.beamForceN = beamForceN;
  out.gravityWeightN = weightN;
  out.localGravityMs2 = localG;
  out.loadRatio = loadRatio;
  out.saturated = saturated;
  return out;
}

export function summarizeEscapeStatus(
  px: number,
  py: number,
  pz: number,
  speedMs: number,
  gravityParams: PlanetaryGravityParams,
): { localGravityMs2: number; escapeVelocityMs: number; nearEscape: boolean } {
  const r = Math.hypot(px, py, pz);
  const localGravityMs2 = computeGravityMagnitude(r, gravityParams);
  const escapeVelocityMs = computeEscapeVelocity(r, gravityParams);
  const nearEscape = escapeVelocityMs > 1e-3 && speedMs >= escapeVelocityMs * 0.85;
  return { localGravityMs2, escapeVelocityMs, nearEscape };
}
