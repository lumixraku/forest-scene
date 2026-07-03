import * as THREE from 'three';

// A mountain brook: strongly meandering in plan, terraced in elevation.
// t=1 is upstream (far, high); the water steps down pool-by-pool toward t=0,
// flowing toward (and past) the camera like the reference footage.
export const STREAM_HALF_WIDTH = 7.0; // widest half-width (pools)

const points = [
  [-150, 14],
  [-110, -8],
  [-70, -20],
  [-40, -8],
  [-10, -22],
  [30, -8],
  [70, -26],
  [110, -10],
  [150, -20],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export const streamCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

const N = 300;
export const streamSamples = streamCurve.getSpacedPoints(N);

// ---- terraced elevation profile ----
export const DROPS = [
  { t: 0.10, h: 1.6 },
  { t: 0.22, h: 1.5 },
  { t: 0.34, h: 1.8 },
  { t: 0.46, h: 1.6 },
  { t: 0.58, h: 1.8 },
  { t: 0.72, h: 1.7 },
  { t: 0.86, h: 1.6 },
];
export const DROP_LEN = 0.008; // ~2.5 world units — short, steep sills

const TOTAL_DROP = DROPS.reduce((a, d) => a + d.h, 0);

// smooth average grade — used for terrain far from the water so the hillsides
// don't inherit the sharp terrace steps
export function levelSmoothAt(t) {
  return -0.4 + TOTAL_DROP * t;
}

// water level of the pool/chute at parameter t
export function levelAt(t) {
  let lvl = -0.4;
  for (const d of DROPS) {
    if (t > d.t + DROP_LEN * 0.5) {
      lvl += d.h;
    } else if (t > d.t - DROP_LEN * 0.5) {
      const k = (t - (d.t - DROP_LEN * 0.5)) / DROP_LEN;
      lvl += d.h * (k * k * (3 - 2 * k));
    }
  }
  return lvl;
}

// cascade intensity 0..1 — 1 on the chute, fading through the plunge pool.
// Kept tight so the still pools between drops stay calm green water.
export function cascadeAt(t) {
  let s = 0;
  for (const d of DROPS) {
    const u = (t - d.t) / DROP_LEN;
    let v = 0;
    if (u >= -0.5 && u <= 0.7) v = 1;
    else if (u < -0.5 && u > -1.6) v = 1 - (-u - 0.5) / 1.1; // plunge pool below
    else if (u > 0.7 && u < 1.1) v = 1 - (u - 0.7) / 0.4;
    s = Math.max(s, v);
  }
  return s;
}

// channel half-width: wide pools pinching into narrow necks every 20-40 units
export function halfWidthAt(t) {
  return 3.0
    + 3.6 * (0.5 + 0.5 * Math.sin(t * 47.0 + 1.2))
    + 1.6 * (0.5 + 0.5 * Math.sin(t * 101.0 + 4.0));
}

// 0 = widest pool, 1 = narrowest neck (extra rushing foam there)
export function narrownessAt(t) {
  return 1 - (halfWidthAt(t) - 3.0) / 5.2;
}

// nearest point on the stream: distance (with bank wobble) + curve parameter
export function streamAt(x, z) {
  let min = Infinity;
  let ti = 0;
  for (let i = 0; i < streamSamples.length; i++) {
    const p = streamSamples[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d = dx * dx + dz * dz;
    if (d < min) { min = d; ti = i; }
  }
  const t = ti / (streamSamples.length - 1);
  const d = Math.sqrt(min) + Math.sin(x * 0.16) * 0.9 + Math.cos(z * 0.2) * 0.7;
  return { d, t };
}

export function waterLevelAt(x, z) {
  return levelAt(streamAt(x, z).t);
}

export function distToStream(x, z) {
  return streamAt(x, z).d;
}
