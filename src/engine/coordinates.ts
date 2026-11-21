export type CoordSystemId =
  | 'geo_dd'
  | 'geo_dms'
  | 'ecef_xyz'
  | 'spherical_rtp'
  | 'local_enu'
  | 'utm_tm'
  | 'voxel_ijk';

export interface CoordSystemSpec {
  id: CoordSystemId;
  code: string;
  name: string;
  shortName: string;
  desc: string;
  axisLabels: [string, string, string];
  axisUnits: [string, string, string];
}

export const COORD_SYSTEM_SPECS: ReadonlyArray<CoordSystemSpec> = [
  {
    id: 'geo_dd',
    code: 'GEO-DD',
    name: '行星经纬高 (十进制度)',
    shortName: '经纬高 DD',
    desc: '行星球面大地坐标：纬度 φ / 经度 λ / 正高 h=r-R₀',
    axisLabels: ['纬度 Lat', '经度 Lon', '高程 Elev'],
    axisUnits: ['°', '°', 'm'],
  },
  {
    id: 'geo_dms',
    code: 'GEO-DMS',
    name: '行星经纬高 (度分秒)',
    shortName: '度分秒 DMS',
    desc: '传统测绘度分秒格式 DD°MM\'SS.S" 与基准海拔高程',
    axisLabels: ['纬度 Lat', '经度 Lon', '海拔 Alt'],
    axisUnits: ['', '', 'm'],
  },
  {
    id: 'ecef_xyz',
    code: 'ECEF-XYZ',
    name: '星心空间直角坐标系',
    shortName: '星心 XYZ',
    desc: '以星球质心为原点的三维右手笛卡尔直角坐标 (X, Y, Z)',
    axisLabels: ['X (本初向)', 'Y (极轴北)', 'Z (东经90°)'],
    axisUnits: ['m', 'm', 'm'],
  },
  {
    id: 'spherical_rtp',
    code: 'SPH-rθφ',
    name: '极地天球球坐标系',
    shortName: '球极坐标',
    desc: '矢径 r (至星心) / 余纬 θ (极距角) / 方位角 φ (0~360°)',
    axisLabels: ['矢径 r', '极距角 θ', '方位角 φ'],
    axisUnits: ['m', '°', '°'],
  },
  {
    id: 'local_enu',
    code: 'ENU-站心',
    name: '局部站心切平面坐标 (ENU)',
    shortName: '站心 ENU',
    desc: '以选定测绘基准点为原点的东(E)/北(N)/天顶(U)局域施工坐标系',
    axisLabels: ['东向 East', '北向 North', '天顶 Up'],
    axisUnits: ['m', 'm', 'm'],
  },
  {
    id: 'utm_tm',
    code: 'P-UTM',
    name: '行星横轴墨卡托 (UTM 6°带)',
    shortName: '行星 UTM',
    desc: '按行星半径 R₀ 等比标定的 6° 分带等角横轴墨卡托平面投影网格',
    axisLabels: ['分带 Zone', '东偏 E', '北距 N'],
    axisUnits: ['', 'm', 'm'],
  },
  {
    id: 'voxel_ijk',
    code: 'VOX-IJK',
    name: '原生体素晶格地址 (IJK)',
    shortName: '体素 IJK',
    desc: '星球八叉树/体素场原生离散整数索引 (i, j, k)',
    axisLabels: ['格点 I', '格点 J', '格点 K'],
    axisUnits: ['vx', 'vx', 'vx'],
  },
];

export interface CoordDatum {
  planetRadius: number;
  nativeVoxelSize: number;
  enuOrigin: [number, number, number];
}

export interface CoordComponent {
  label: string;
  value: string;
  unit: string;
  numericValue: number;
}

export interface CoordReadout {
  system: CoordSystemId;
  code: string;
  components: [CoordComponent, CoordComponent, CoordComponent];
  compact: string;
  extraLabel?: string;
  utmZone?: string;
  scaleFactor?: number;
  convergenceDeg?: number;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const UTM_K0 = 0.9996;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapLonDeg(lonDeg: number): number {
  let d = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (d <= -180) d += 360;
  return d;
}

export function wrapAzimuthDeg(azDeg: number): number {
  const d = ((azDeg % 360) + 360) % 360;
  return d;
}

export function formatDms(degVal: number, posHemi: string, negHemi: string): string {
  const hemi = degVal >= 0 ? posHemi : negHemi;
  const abs = Math.abs(degVal);
  let d = Math.floor(abs);
  const remMin = (abs - d) * 60;
  let m = Math.floor(remMin);
  let s = (remMin - m) * 60;
  if (s >= 59.95) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`;
}

export function dmsToDecimal(deg: number, min: number, sec: number, sign: 1 | -1 = 1): number {
  return sign * (Math.abs(deg) + Math.abs(min) / 60 + Math.abs(sec) / 3600);
}

/**
 * Matches TerraSphere engine convention:
 * x = r * cos(lat) * cos(lon)
 * y = r * sin(lat)   (North pole +Y)
 * z = r * cos(lat) * sin(lon)
 */
export function worldToLonLatRadius(
  x: number,
  y: number,
  z: number,
): { latDeg: number; lonDeg: number; radius: number } {
  const radius = Math.hypot(x, y, z);
  if (radius < 1e-9) {
    return { latDeg: 0, lonDeg: 0, radius: 0 };
  }
  const ny = clamp(y / radius, -1, 1);
  const latDeg = Math.asin(ny) * RAD2DEG;
  const lonDeg = wrapLonDeg(Math.atan2(z, x) * RAD2DEG);
  return { latDeg, lonDeg, radius };
}

export function lonLatRadiusToWorld(
  latDeg: number,
  lonDeg: number,
  radius: number,
): [number, number, number] {
  const lat = clamp(latDeg, -90, 90) * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);
  return [
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  ];
}

/**
 * Compute orthonormal East-North-Up basis vectors at an ECEF world origin.
 */
export function computeEnuBasis(origin: [number, number, number]): {
  east: [number, number, number];
  north: [number, number, number];
  up: [number, number, number];
} {
  const [ox, oy, oz] = origin;
  const r = Math.hypot(ox, oy, oz);
  if (r < 1e-6) {
    return {
      east: [0, 0, 1],
      north: [0, 1, 0],
      up: [1, 0, 0],
    };
  }
  const ux = ox / r;
  const uy = oy / r;
  const uz = oz / r;

  // World pole axis is +Y = (0, 1, 0). East = normalize(Up x PoleAxis) when Up=(ux,uy,uz):
  // Let's check: at lat=0, lon=0 -> Up=(1,0,0).
  // East (+lon direction) is d/d(lon)[cos(lon), 0, sin(lon)] at lon=0 -> (0, 0, 1).
  // Cross product (0,1,0) x (1,0,0) = (0, 0, -1), so East = Pole x Up gives (0,0,-1); Wait:
  // d(pos)/dlon = (-cos(lat)*sin(lon), 0, cos(lat)*cos(lon)).
  // At lon=0: (0, 0, 1). Notice (ux, uy, uz) x (0, 1, 0) = (-uz, 0, ux).
  // At Up=(1,0,0): (-0, 0, 1) = (0, 0, 1)!
  let ex = -uz;
  let ey = 0;
  let ez = ux;
  let eLen = Math.hypot(ex, ey, ez);
  if (eLen < 1e-6) {
    // At exact poles, align East with +Z
    ex = 0;
    ey = 0;
    ez = 1;
    eLen = 1;
  }
  ex /= eLen;
  ey /= eLen;
  ez /= eLen;

  // North = Up x East
  // Wait: verify at lat=0, lon=0 -> Up=(1,0,0), East=(0,0,1):
  // Up x East = (1,0,0) x (0,0,1) = (0, -1, 0) -- wait!
  // Let's compute East x Up = (0,0,1) x (1,0,0) = (0, 1, 0) = +Y (North)!
  const nx = ey * uz - ez * uy;
  const ny = ez * ux - ex * uz;
  const nz = ex * uy - ey * ux;
  const nLen = Math.hypot(nx, ny, nz) || 1;

  return {
    east: [ex, ey, ez],
    north: [nx / nLen, ny / nLen, nz / nLen],
    up: [ux, uy, uz],
  };
}

export function worldToEnu(
  worldPos: [number, number, number],
  origin: [number, number, number],
): [number, number, number] {
  const dx = worldPos[0] - origin[0];
  const dy = worldPos[1] - origin[1];
  const dz = worldPos[2] - origin[2];
  const { east, north, up } = computeEnuBasis(origin);
  return [
    dx * east[0] + dy * east[1] + dz * east[2],
    dx * north[0] + dy * north[1] + dz * north[2],
    dx * up[0] + dy * up[1] + dz * up[2],
  ];
}

export function enuToWorld(
  eastM: number,
  northM: number,
  upM: number,
  origin: [number, number, number],
): [number, number, number] {
  const { east, north, up } = computeEnuBasis(origin);
  return [
    origin[0] + eastM * east[0] + northM * north[0] + upM * up[0],
    origin[1] + eastM * east[1] + northM * north[1] + upM * up[1],
    origin[2] + eastM * east[2] + northM * north[2] + upM * up[2],
  ];
}

export interface PlanetaryUtmResult {
  zoneNumber: number;
  hemisphere: 'N' | 'S';
  zoneCode: string;
  centralMeridianDeg: number;
  eastingM: number;
  northingM: number;
  elevationM: number;
  scaleFactor: number;
  convergenceDeg: number;
}

/**
 * Exact spherical Transverse Mercator (UTM 6° zoning) normalized cleanly to planetary radius R₀.
 * False easting & false northing scale linearly with R₀ relative to a standard UTM strip:
 * falseEasting = 0.08 * R₀ (avoids negative eastings inside the 6° zone while staying intuitive in meters),
 * falseNorthingSouth = Math.PI * R₀.
 */
export function worldToPlanetaryUtm(
  x: number,
  y: number,
  z: number,
  planetRadius: number,
  forcedZone?: number,
): PlanetaryUtmResult {
  const R = Math.max(0.1, planetRadius);
  const { latDeg, lonDeg, radius } = worldToLonLatRadius(x, y, z);
  const clampedLatDeg = clamp(latDeg, -84, 84);
  const zoneNumber =
    forcedZone && forcedZone >= 1 && forcedZone <= 60
      ? Math.round(forcedZone)
      : clamp(Math.floor((wrapLonDeg(lonDeg) + 180) / 6) + 1, 1, 60);
  const centralMeridianDeg = (zoneNumber - 1) * 6 - 180 + 3;
  const hemisphere: 'N' | 'S' = latDeg >= 0 ? 'N' : 'S';

  const lat = clampedLatDeg * DEG2RAD;
  const dLon = wrapLonDeg(lonDeg - centralMeridianDeg) * DEG2RAD;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);

  // Spherical Transverse Mercator exact formulas
  const B = clamp(cosLat * Math.sin(dLon), -0.999999, 0.999999);
  const xProj = 0.5 * UTM_K0 * R * Math.log((1 + B) / (1 - B));
  const yProj = UTM_K0 * R * Math.atan2(Math.tan(lat), Math.cos(dLon));

  const falseEasting = R * 0.25;
  const falseNorthing = hemisphere === 'S' ? Math.PI * R : 0;

  const eastingM = falseEasting + xProj;
  const northingM = falseNorthing + yProj;
  const denom = Math.sqrt(Math.max(1e-8, 1 - B * B));
  const scaleFactor = UTM_K0 / denom;
  const convergenceDeg = Math.atan2(Math.tan(dLon), sinLat === 0 ? 1e-9 : 1 / sinLat) * RAD2DEG;
  // Exact spherical grid convergence: atan(tan(dLon) * sin(lat))
  const exactConvDeg = Math.atan(Math.tan(dLon) * sinLat) * RAD2DEG;

  return {
    zoneNumber,
    hemisphere,
    zoneCode: `${String(zoneNumber).padStart(2, '0')}${hemisphere}`,
    centralMeridianDeg,
    eastingM,
    northingM,
    elevationM: radius - R,
    scaleFactor,
    convergenceDeg: Number.isFinite(exactConvDeg) ? exactConvDeg : convergenceDeg,
  };
}

export function planetaryUtmToWorld(
  zoneNumber: number,
  hemisphere: 'N' | 'S',
  eastingM: number,
  northingM: number,
  elevationM: number,
  planetRadius: number,
): [number, number, number] {
  const R = Math.max(0.1, planetRadius);
  const zNum = clamp(Math.round(zoneNumber), 1, 60);
  const centralMeridianDeg = (zNum - 1) * 6 - 180 + 3;
  const falseEasting = R * 0.25;
  const falseNorthing = hemisphere === 'S' ? Math.PI * R : 0;

  const xProj = eastingM - falseEasting;
  const yProj = northingM - falseNorthing;

  const D = yProj / (UTM_K0 * R);
  const xi = xProj / (UTM_K0 * R);
  const coshXi = Math.cosh(xi);
  const sinhXi = Math.sinh(xi);

  const latRad = Math.asin(clamp(Math.sin(D) / coshXi, -1, 1));
  const dLonRad = Math.atan2(sinhXi, Math.cos(D));
  const latDeg = latRad * RAD2DEG;
  const lonDeg = wrapLonDeg(centralMeridianDeg + dLonRad * RAD2DEG);

  return lonLatRadiusToWorld(latDeg, lonDeg, R + elevationM);
}

export function worldToCoord(
  worldPos: [number, number, number],
  system: CoordSystemId,
  datum: CoordDatum,
): CoordReadout {
  const [x, y, z] = worldPos;
  const R = Math.max(0.1, datum.planetRadius);
  const voxSize = Math.max(1e-5, datum.nativeVoxelSize);

  if (system === 'geo_dd') {
    const { latDeg, lonDeg, radius } = worldToLonLatRadius(x, y, z);
    const elev = radius - R;
    const latHemi = latDeg >= 0 ? 'N' : 'S';
    const lonHemi = lonDeg >= 0 ? 'E' : 'W';
    const latStr = `${Math.abs(latDeg).toFixed(3)}°${latHemi}`;
    const lonStr = `${Math.abs(lonDeg).toFixed(3)}°${lonHemi}`;
    const elevStr = `${elev >= 0 ? '+' : ''}${elev.toFixed(2)}`;
    return {
      system,
      code: 'GEO-DD',
      components: [
        { label: 'Lat', value: latStr, unit: '', numericValue: latDeg },
        { label: 'Lon', value: lonStr, unit: '', numericValue: lonDeg },
        { label: 'Elev', value: elevStr, unit: 'm', numericValue: elev },
      ],
      compact: `${latStr} ${lonStr} (${elevStr}m)`,
    };
  }

  if (system === 'geo_dms') {
    const { latDeg, lonDeg, radius } = worldToLonLatRadius(x, y, z);
    const elev = radius - R;
    const latStr = formatDms(latDeg, 'N', 'S');
    const lonStr = formatDms(lonDeg, 'E', 'W');
    const elevStr = `${elev >= 0 ? '+' : ''}${elev.toFixed(2)}`;
    return {
      system,
      code: 'GEO-DMS',
      components: [
        { label: 'Lat', value: latStr, unit: '', numericValue: latDeg },
        { label: 'Lon', value: lonStr, unit: '', numericValue: lonDeg },
        { label: 'Alt', value: elevStr, unit: 'm', numericValue: elev },
      ],
      compact: `${latStr} ${lonStr} ${elevStr}m`,
    };
  }

  if (system === 'ecef_xyz') {
    return {
      system,
      code: 'ECEF-XYZ',
      components: [
        { label: 'X', value: x.toFixed(3), unit: 'm', numericValue: x },
        { label: 'Y', value: y.toFixed(3), unit: 'm', numericValue: y },
        { label: 'Z', value: z.toFixed(3), unit: 'm', numericValue: z },
      ],
      compact: `X ${x.toFixed(2)} Y ${y.toFixed(2)} Z ${z.toFixed(2)}m`,
    };
  }

  if (system === 'spherical_rtp') {
    const { latDeg, lonDeg, radius } = worldToLonLatRadius(x, y, z);
    const colatDeg = 90 - latDeg;
    const azDeg = wrapAzimuthDeg(lonDeg);
    return {
      system,
      code: 'SPH-rθφ',
      components: [
        { label: 'r', value: radius.toFixed(3), unit: 'm', numericValue: radius },
        { label: 'θ', value: colatDeg.toFixed(2), unit: '°', numericValue: colatDeg },
        { label: 'φ', value: azDeg.toFixed(2), unit: '°', numericValue: azDeg },
      ],
      compact: `r=${radius.toFixed(2)}m θ=${colatDeg.toFixed(1)}° φ=${azDeg.toFixed(1)}°`,
    };
  }

  if (system === 'local_enu') {
    const [e, n, u] = worldToEnu(worldPos, datum.enuOrigin);
    const horiz = Math.hypot(e, n);
    return {
      system,
      code: 'ENU-站心',
      components: [
        { label: 'E', value: `${e >= 0 ? '+' : ''}${e.toFixed(3)}`, unit: 'm', numericValue: e },
        { label: 'N', value: `${n >= 0 ? '+' : ''}${n.toFixed(3)}`, unit: 'm', numericValue: n },
        { label: 'U', value: `${u >= 0 ? '+' : ''}${u.toFixed(3)}`, unit: 'm', numericValue: u },
      ],
      compact: `E${e >= 0 ? '+' : ''}${e.toFixed(2)} N${n >= 0 ? '+' : ''}${n.toFixed(2)} U${u >= 0 ? '+' : ''}${u.toFixed(2)}m`,
      extraLabel: `平面距 ${horiz.toFixed(2)}m`,
    };
  }

  if (system === 'utm_tm') {
    const utm = worldToPlanetaryUtm(x, y, z, R);
    return {
      system,
      code: 'P-UTM',
      components: [
        { label: 'Zone', value: utm.zoneCode, unit: '', numericValue: utm.zoneNumber },
        { label: 'E', value: utm.eastingM.toFixed(2), unit: 'm', numericValue: utm.eastingM },
        { label: 'N', value: utm.northingM.toFixed(2), unit: 'm', numericValue: utm.northingM },
      ],
      compact: `[${utm.zoneCode}] E ${utm.eastingM.toFixed(2)}m · N ${utm.northingM.toFixed(2)}m`,
      extraLabel: `k=${utm.scaleFactor.toFixed(5)} · γ=${utm.convergenceDeg.toFixed(2)}°`,
      utmZone: utm.zoneCode,
      scaleFactor: utm.scaleFactor,
      convergenceDeg: utm.convergenceDeg,
    };
  }

  // voxel_ijk
  const i = Math.round(x / voxSize);
  const j = Math.round(y / voxSize);
  const k = Math.round(z / voxSize);
  return {
    system: 'voxel_ijk',
    code: 'VOX-IJK',
    components: [
      { label: 'I', value: String(i), unit: 'vx', numericValue: i },
      { label: 'J', value: String(j), unit: 'vx', numericValue: j },
      { label: 'K', value: String(k), unit: 'vx', numericValue: k },
    ],
    compact: `(${i}, ${j}, ${k}) vx`,
    extraLabel: `Δv=${voxSize >= 0.01 ? voxSize.toFixed(3) : voxSize.toExponential(2)}m`,
  };
}

export function worldToAllCoords(
  worldPos: [number, number, number],
  datum: CoordDatum,
): Record<CoordSystemId, CoordReadout> {
  return {
    geo_dd: worldToCoord(worldPos, 'geo_dd', datum),
    geo_dms: worldToCoord(worldPos, 'geo_dms', datum),
    ecef_xyz: worldToCoord(worldPos, 'ecef_xyz', datum),
    spherical_rtp: worldToCoord(worldPos, 'spherical_rtp', datum),
    local_enu: worldToCoord(worldPos, 'local_enu', datum),
    utm_tm: worldToCoord(worldPos, 'utm_tm', datum),
    voxel_ijk: worldToCoord(worldPos, 'voxel_ijk', datum),
  };
}

/**
 * Inverse transform from any supported CRS triple back to planetary world XYZ.
 */
export function coordToWorld(
  system: CoordSystemId,
  c1: number,
  c2: number,
  c3: number,
  datum: CoordDatum,
  opts?: { utmZone?: number; utmHemi?: 'N' | 'S' },
): [number, number, number] {
  const R = Math.max(0.1, datum.planetRadius);
  const voxSize = Math.max(1e-5, datum.nativeVoxelSize);

  switch (system) {
    case 'geo_dd':
    case 'geo_dms':
      return lonLatRadiusToWorld(c1, c2, R + c3);
    case 'ecef_xyz':
      return [c1, c2, c3];
    case 'spherical_rtp': {
      const radius = Math.max(0, c1);
      const latDeg = 90 - clamp(c2, 0, 180);
      const lonDeg = wrapLonDeg(c3);
      return lonLatRadiusToWorld(latDeg, lonDeg, radius);
    }
    case 'local_enu':
      return enuToWorld(c1, c2, c3, datum.enuOrigin);
    case 'utm_tm': {
      const zone = opts?.utmZone ?? clamp(Math.round(c1), 1, 60);
      const hemi = opts?.utmHemi ?? (c3 >= 0 ? 'N' : 'S');
      return planetaryUtmToWorld(zone, hemi, c2, c3, 0, R);
    }
    case 'voxel_ijk':
      return [c1 * voxSize, c2 * voxSize, c3 * voxSize];
  }
}

export interface SphericalSurveyMetrics {
  geodesicArcM: number;
  chordDistanceM: number;
  centralAngleDeg: number;
  forwardAzimuthDeg: number;
  backAzimuthDeg: number;
}

/**
 * Great-circle arc distance, chord distance & forward/back spherical azimuth between A and B.
 */
export function computeSphericalSurveyMetrics(
  a: [number, number, number],
  b: [number, number, number],
  planetRadius: number,
): SphericalSurveyMetrics {
  const R = Math.max(0.1, planetRadius);
  const ra = Math.hypot(a[0], a[1], a[2]) || R;
  const rb = Math.hypot(b[0], b[1], b[2]) || R;
  const ax = a[0] / ra;
  const ay = a[1] / ra;
  const az = a[2] / ra;
  const bx = b[0] / rb;
  const by = b[1] / rb;
  const bz = b[2] / rb;

  const dot = clamp(ax * bx + ay * by + az * bz, -1, 1);
  const centralAngleRad = Math.acos(dot);
  const geodesicArcM = R * centralAngleRad;
  const chordDistanceM = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

  const llA = worldToLonLatRadius(a[0], a[1], a[2]);
  const llB = worldToLonLatRadius(b[0], b[1], b[2]);
  const lat1 = llA.latDeg * DEG2RAD;
  const lat2 = llB.latDeg * DEG2RAD;
  const dLon = (llB.lonDeg - llA.lonDeg) * DEG2RAD;

  const fwdAz = wrapAzimuthDeg(
    Math.atan2(
      Math.sin(dLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
    ) * RAD2DEG,
  );
  const backAz = wrapAzimuthDeg(
    Math.atan2(
      Math.sin(-dLon) * Math.cos(lat1),
      Math.cos(lat2) * Math.sin(lat1) - Math.sin(lat2) * Math.cos(lat1) * Math.cos(-dLon),
    ) * RAD2DEG,
  );

  return {
    geodesicArcM,
    chordDistanceM,
    centralAngleDeg: centralAngleRad * RAD2DEG,
    forwardAzimuthDeg: fwdAz,
    backAzimuthDeg: backAz,
  };
}
