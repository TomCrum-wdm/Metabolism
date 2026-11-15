// Scientifically accurate Newtonian planetary gravity & spherical tangent frame math.
// Outside reference radius R0: g(r) = g0 * (R0 / r)^2 (inverse-square law)
// Inside uniform planet core r < R0: g(r) = g0 * (r / R0) (Newton's Shell Theorem / Gauss's Law)

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PlanetaryGravityParams {
  referenceRadius: number; // R0 in meters
  surfaceGravity: number;  // g0 in m/s^2 at r = R0 (e.g. 9.81 * scale)
}

export const DEFAULT_PLANET_RADIUS = 13.0;
export const EARTH_SURFACE_GRAVITY = 9.81;

/**
 * Computes scalar gravitational acceleration magnitude (always >= 0) at distance r from planet center.
 * Follows Newton's Law of Universal Gravitation outside R0 and Newton's Shell Theorem inside R0.
 */
export function computeGravityMagnitude(
  r: number,
  params: PlanetaryGravityParams,
): number {
  const { referenceRadius: R0, surfaceGravity: g0 } = params;
  if (r <= 1e-6 || R0 <= 1e-6 || g0 <= 0) return 0;
  if (r >= R0) {
    const ratio = R0 / r;
    return g0 * ratio * ratio;
  }
  return g0 * (r / R0);
}

/**
 * Computes the 3D gravitational acceleration vector pointing radially toward planet center (0,0,0).
 */
export function computeGravityVector(
  px: number,
  py: number,
  pz: number,
  params: PlanetaryGravityParams,
  out: Vec3Like,
): Vec3Like {
  const rSq = px * px + py * py + pz * pz;
  if (rSq <= 1e-10) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const r = Math.sqrt(rSq);
  const mag = computeGravityMagnitude(r, params);
  const invR = -mag / r;
  out.x = px * invR;
  out.y = py * invR;
  out.z = pz * invR;
  return out;
}

/**
 * Escape velocity at radius r >= R0: v_esc = sqrt(2 * g0 * R0^2 / r).
 * Inside R0, potential energy difference gives v_esc = sqrt(g0 * R0 * (3 - (r/R0)^2)).
 */
export function computeEscapeVelocity(
  r: number,
  params: PlanetaryGravityParams,
): number {
  const { referenceRadius: R0, surfaceGravity: g0 } = params;
  if (R0 <= 1e-6 || g0 <= 0) return 0;
  const clampedR = Math.max(0, r);
  if (clampedR >= R0) {
    return Math.sqrt((2 * g0 * R0 * R0) / clampedR);
  }
  const frac = clampedR / R0;
  return Math.sqrt(g0 * R0 * (3 - frac * frac));
}

/**
 * Parallel-transports a tangent forward vector onto the sphere surface tangent plane
 * defined by local radial up = normalize(pos), eliminating north/south pole gimbal lock.
 */
export function parallelTransportTangentFrame(
  px: number,
  py: number,
  pz: number,
  prevForward: Vec3Like,
  outUp: Vec3Like,
  outForward: Vec3Like,
  outRight: Vec3Like,
): void {
  const len = Math.hypot(px, py, pz);
  if (len < 1e-6) {
    outUp.x = 0; outUp.y = 1; outUp.z = 0;
  } else {
    outUp.x = px / len;
    outUp.y = py / len;
    outUp.z = pz / len;
  }

  // Project prevForward onto tangent plane perpendicular to outUp
  const dot =
    prevForward.x * outUp.x +
    prevForward.y * outUp.y +
    prevForward.z * outUp.z;

  let fx = prevForward.x - dot * outUp.x;
  let fy = prevForward.y - dot * outUp.y;
  let fz = prevForward.z - dot * outUp.z;
  let fLen = Math.hypot(fx, fy, fz);

  if (fLen < 1e-5) {
    // Fallback orthogonal axis when perfectly aligned with pole
    const ax = Math.abs(outUp.y) < 0.9 ? 0 : 1;
    const ay = Math.abs(outUp.y) < 0.9 ? 1 : 0;
    const az = 0;
    fx = ay * outUp.z - az * outUp.y;
    fy = az * outUp.x - ax * outUp.z;
    fz = ax * outUp.y - ay * outUp.x;
    fLen = Math.hypot(fx, fy, fz);
  }

  outForward.x = fx / fLen;
  outForward.y = fy / fLen;
  outForward.z = fz / fLen;

  // Right = forward x up (right-handed Y-up: +Z forward? Actually forward x up = right)
  outRight.x = outForward.y * outUp.z - outForward.z * outUp.y;
  outRight.y = outForward.z * outUp.x - outForward.x * outUp.z;
  outRight.z = outForward.x * outUp.y - outForward.y * outUp.x;
  const rLen = Math.hypot(outRight.x, outRight.y, outRight.z) || 1;
  outRight.x /= rLen;
  outRight.y /= rLen;
  outRight.z /= rLen;
}
