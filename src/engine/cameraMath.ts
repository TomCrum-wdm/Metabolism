function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface DetailCameraOptics {
  /** Safe world-space physical distance from camera to detailTarget (never penetrates surface) */
  physicalDist: number;
  /** Effective distance passed to SVO streaming (reflects combined physical + optical zoom) */
  effectiveStreamDist: number;
  /** Vertical PerspectiveCamera FOV in degrees (narrows smoothly for telephoto micro-inspection) */
  fovDeg: number;
  /** Apparent total magnification relative to baseRadius * 2 viewing baseline */
  magnification: number;
}

/**
 * Computes non-penetrating physical camera standoff and optical telephoto FOV for
 * the Detail Camera so zooming into millimeter/micron voxels magnifies cleanly without
 * passing inside adjacent geometry or collapsing depth-buffer precision.
 */
export function computeDetailCameraOptics(
  desiredViewDist: number,
  baseRadius: number,
  nativeVoxelSize: number,
  baseFovDeg = 55,
): DetailCameraOptics {
  const safeBaseFov = clamp(baseFovDeg, 20, 110);
  const minPhysicalStandoff = Math.max(
    nativeVoxelSize * 8.0,
    baseRadius * 0.0015,
    1e-4,
  );
  const opticalTransitionDist = Math.max(
    minPhysicalStandoff * 4.0,
    baseRadius * 0.04,
  );

  const clampedViewDist = clamp(
    desiredViewDist,
    Math.max(nativeVoxelSize * 0.45, 1e-8),
    baseRadius * 6.0,
  );

  let physicalDist = clampedViewDist;
  let opticalMag = 1.0;

  if (clampedViewDist < opticalTransitionDist) {
    // Smoothly approach minPhysicalStandoff asymptotically while ramping optical FOV magnification
    const blended = Math.sqrt(clampedViewDist * opticalTransitionDist);
    physicalDist = clamp(
      Math.max(minPhysicalStandoff, blended),
      minPhysicalStandoff,
      opticalTransitionDist,
    );
    opticalMag = clamp(physicalDist / clampedViewDist, 1.0, 18.0);
  }

  const tanHalf = Math.tan(((safeBaseFov * 0.5) * Math.PI) / 180);
  const fovRad = 2 * Math.atan(tanHalf / opticalMag);
  const fovDeg = clamp((fovRad * 180) / Math.PI, 3.0, safeBaseFov);

  const baselineDist = Math.max(baseRadius * 1.6, 1e-4);
  const magnification = Math.max(0.25, baselineDist / clampedViewDist);

  return {
    physicalDist,
    effectiveStreamDist: clampedViewDist,
    fovDeg,
    magnification,
  };
}

/**
 * Computes healthy PerspectiveCamera [near, far] planes keeping far/near within 24-bit
 * depth precision even at micro voxel magnification.
 */
export function computeSafeClipPlanes(
  surfaceClearanceDist: number,
  focusDist: number,
  planetRadius: number,
  opticalFovDeg = 55,
): { near: number; far: number } {
  const refDist = Math.max(1e-7, Math.min(surfaceClearanceDist, focusDist));
  const fovBoost = clamp(55 / Math.max(opticalFovDeg, 3), 1, 18);
  // Telephoto detail view stands physically farther back so near can remain comfortable
  const near = clamp(refDist * 0.25 * Math.min(fovBoost, 3.0), 1e-5, 0.35 * (planetRadius / 13));
  const baseFar = Math.max(300, planetRadius * 28);
  const horizonDist =
    Math.sqrt(Math.max(0, focusDist * (2 * planetRadius + focusDist))) +
    planetRadius * 0.4;
  const maxSafeRatioFar = near * 1.8e5;
  const far = clamp(
    Math.min(baseFar, Math.max(horizonDist * 3.5, focusDist * 16), maxSafeRatioFar),
    Math.max(near * 2e4, focusDist * 4),
    baseFar,
  );
  return { near, far };
}

/**
 * Evaluates smooth cubic ease-out position/look interpolation for the Landing Camera descent.
 */
export function evaluateLandingDescentPose(
  tRaw: number,
  startPos: readonly [number, number, number],
  endPos: readonly [number, number, number],
  sitePos: readonly [number, number, number],
  endLook: readonly [number, number, number],
): {
  pos: [number, number, number];
  look: [number, number, number];
  done: boolean;
} {
  const t = clamp(tRaw, 0, 1);
  if (t >= 1) {
    return {
      pos: [endPos[0], endPos[1], endPos[2]],
      look: [endLook[0], endLook[1], endLook[2]],
      done: true,
    };
  }

  // Ease-out cubic for smooth braking before touchdown
  const e = 1 - Math.pow(1 - t, 3);
  const px = startPos[0] + (endPos[0] - startPos[0]) * e;
  const py = startPos[1] + (endPos[1] - startPos[1]) * e;
  const pz = startPos[2] + (endPos[2] - startPos[2]) * e;

  // Sweep look target from landing beacon onto forward eye-level horizon during final 45%
  const lookBlend = clamp((t - 0.45) / 0.55, 0, 1);
  const le = lookBlend * lookBlend * (3 - 2 * lookBlend);
  const lx = sitePos[0] + (endLook[0] - sitePos[0]) * le;
  const ly = sitePos[1] + (endLook[1] - sitePos[1]) * le;
  const lz = sitePos[2] + (endLook[2] - sitePos[2]) * le;

  return {
    pos: [px, py, pz],
    look: [lx, ly, lz],
    done: false,
  };
}

/**
 * Parallel-transports a camera horizontal forward vector onto the local gravity tangent plane
 * perpendicular to `up`, optionally rotating by `deltaYawRad` around `up`.
 * Completely free of cardinal-axis cross-product discontinuities anywhere on S^2.
 */
export function transportCameraForwardOnSphere(
  up: readonly [number, number, number],
  prevForward: readonly [number, number, number],
  deltaYawRad = 0,
): { forward: [number, number, number]; right: [number, number, number] } {
  const uLen = Math.hypot(up[0], up[1], up[2]) || 1;
  const ux = up[0] / uLen;
  const uy = up[1] / uLen;
  const uz = up[2] / uLen;

  const dot = prevForward[0] * ux + prevForward[1] * uy + prevForward[2] * uz;
  let fx = prevForward[0] - dot * ux;
  let fy = prevForward[1] - dot * uy;
  let fz = prevForward[2] - dot * uz;
  let fLen = Math.hypot(fx, fy, fz);

  if (fLen < 1e-6) {
    // Only reached if prevForward was strictly parallel to up; pick smooth perpendicular seed
    const ax = Math.abs(ux) < 0.8 ? 1 : 0;
    const ay = Math.abs(ux) < 0.8 ? 0 : 1;
    const az = 0;
    // axis x up
    fx = ay * uz - az * uy;
    fy = az * ux - ax * uz;
    fz = ax * uy - ay * ux;
    fLen = Math.hypot(fx, fy, fz) || 1;
  }

  fx /= fLen;
  fy /= fLen;
  fz /= fLen;

  if (Math.abs(deltaYawRad) > 1e-12) {
    // Rodrigues rotation around unit axis u (since u · f === 0): f' = f cosθ + (u × f) sinθ
    const c = Math.cos(deltaYawRad);
    const s = Math.sin(deltaYawRad);
    const cx = uy * fz - uz * fy;
    const cy = uz * fx - ux * fz;
    const cz = ux * fy - uy * fx;
    const rx = fx * c + cx * s;
    const ry = fy * c + cy * s;
    const rz = fz * c + cz * s;
    const rLen = Math.hypot(rx, ry, rz) || 1;
    fx = rx / rLen;
    fy = ry / rLen;
    fz = rz / rLen;
  }

  // Right = forward x up
  let rx = fy * uz - fz * uy;
  let ry = fz * ux - fx * uz;
  let rz = fx * uy - fy * ux;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  return {
    forward: [fx, fy, fz],
    right: [rx, ry, rz],
  };
}

/**
 * Separately damps radial (vertical gravity) vs tangential displacement so minor voxel-step
 * height jitter never shakes the player camera while preserving crisp planar tracking.
 */
export function stabilizeRadialAnchor(
  prevAnchor: readonly [number, number, number],
  targetPos: readonly [number, number, number],
  localUp: readonly [number, number, number],
  radialAlpha: number,
  tangentAlpha: number,
): [number, number, number] {
  const dx = targetPos[0] - prevAnchor[0];
  const dy = targetPos[1] - prevAnchor[1];
  const dz = targetPos[2] - prevAnchor[2];

  const radial = dx * localUp[0] + dy * localUp[1] + dz * localUp[2];
  const tx = dx - radial * localUp[0];
  const ty = dy - radial * localUp[1];
  const tz = dz - radial * localUp[2];

  return [
    prevAnchor[0] + tx * tangentAlpha + localUp[0] * radial * radialAlpha,
    prevAnchor[1] + ty * tangentAlpha + localUp[1] * radial * radialAlpha,
    prevAnchor[2] + tz * tangentAlpha + localUp[2] * radial * radialAlpha,
  ];
}

/**
 * Guards the planetary gravity up-vector when traversing near the hollow planet core (r -> 0)
 * so passing through a through-planet tunnel never triggers a violent 180° camera flip.
 */
export function resolveSphericalCoreUp(
  pos: readonly [number, number, number],
  prevUp: readonly [number, number, number],
  coreGuardRadius: number,
): [number, number, number] {
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  if (r < Math.max(coreGuardRadius, 1e-5)) {
    const pLen = Math.hypot(prevUp[0], prevUp[1], prevUp[2]) || 1;
    return [prevUp[0] / pLen, prevUp[1] / pLen, prevUp[2] / pLen];
  }
  return [pos[0] / r, pos[1] / r, pos[2] / r];
}

