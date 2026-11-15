// Deterministic 3D gradient noise and fractal Brownian motion for planetary generation

const PERM = new Uint8Array(512);
const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

export function seedNoise(seed: number): void {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = (seed >>> 0) || 1337;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }
}

seedNoise(202611);

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number, z: number): number {
  const g = GRAD3[hash % 12];
  return g[0] * x + g[1] * y + g[2] * z;
}

export function noise3D(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;

  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const fz = z - Math.floor(z);

  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);

  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;

  const n000 = grad(PERM[AA], fx, fy, fz);
  const n100 = grad(PERM[BA], fx - 1, fy, fz);
  const n010 = grad(PERM[AB], fx, fy - 1, fz);
  const n110 = grad(PERM[BB], fx - 1, fy - 1, fz);
  const n001 = grad(PERM[AA + 1], fx, fy, fz - 1);
  const n101 = grad(PERM[BA + 1], fx - 1, fy, fz - 1);
  const n011 = grad(PERM[AB + 1], fx, fy - 1, fz - 1);
  const n111 = grad(PERM[BB + 1], fx - 1, fy - 1, fz - 1);

  return lerp(
    lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
    lerp(lerp(n001, n101, u), lerp(n011, n111, u), v),
    w,
  );
}

export function fbm3D(
  x: number,
  y: number,
  z: number,
  octaves = 4,
  lacunarity = 2.05,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3D(x * freq, y * freq, z * freq);
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return maxAmp > 0 ? sum / maxAmp : 0;
}

export function ridged3D(
  x: number,
  y: number,
  z: number,
  octaves = 3,
  lacunarity = 2.1,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1.0 - Math.abs(noise3D(x * freq, y * freq, z * freq));
    sum += amp * n * n;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return maxAmp > 0 ? sum / maxAmp : 0;
}
