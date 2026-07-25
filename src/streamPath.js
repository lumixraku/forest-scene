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
// The gap between 0.32 and 0.52 is deliberate: a pool's surface has to be level,
// so the lake needs a reach with no step in it. Every other drop is ~0.12 apart.
export const DROPS = [
  { t: 0.10, h: 1.6 },
  { t: 0.22, h: 1.5 },
  { t: 0.32, h: 1.8 },
  { t: 0.52, h: 2.2 }, // taller step out of the lake
  { t: 0.64, h: 1.6 },
  { t: 0.76, h: 1.7 },
  { t: 0.88, h: 1.6 },
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

// Channel half-width. The brook is a chain of pools strung between the cascade
// lips: every drop is a narrow chute, and between the drops the water opens out
// into a basin — the one at t≈0.40 wide enough to read as a small lake before
// pinching back down and carrying on.
//
// Authored as explicit pools rather than summed sine waves. Two sines at t*47
// and t*101 oscillate ~7 and ~16 times over the curve, which never holds a
// stretch open long enough to read as a pool — it just looks like a
// constant-width channel with a wobble on it.
// Each pool sits between two drops, and no pool may spill across one: the water
// surface steps down at a drop, so a basin straddling one would be sliced into
// two levels — which submerges the trees along the lower half of its bank.
const POOLS = [
  { t: 0.05, w: 4.5, s: 0.026 },
  { t: 0.16, w: 8.0, s: 0.028 },
  { t: 0.26, w: 3.5, s: 0.020 },
  { t: 0.42, w: 20.0, s: 0.060 }, // the lake, inside the 0.32-0.52 flat reach
  { t: 0.58, w: 5.5, s: 0.024 },
  { t: 0.70, w: 12.0, s: 0.032 },
  { t: 0.82, w: 3.5, s: 0.022 },
  { t: 0.94, w: 7.0, s: 0.028 },
];
const NECK = 1.9; // half-width of the chutes between pools
const OPEN = 8.0; // wider than this and the water reads as open, not a chute

export function halfWidthAt(t) {
  let hw = NECK;
  for (const p of POOLS) {
    const d = (t - p.t) / p.s;
    hw += p.w * Math.exp(-d * d);
  }
  // slow wobble so the banks are not mathematically smooth
  return hw + 0.35 * Math.sin(t * 23.0 + 1.2);
}

// 0 = open pool, 1 = narrowest chute (extra rushing foam there)
export function narrownessAt(t) {
  return THREE.MathUtils.clamp(1 - (halfWidthAt(t) - NECK) / (OPEN - NECK), 0, 1);
}

// nearest point on the stream: distance (with bank wobble) + curve parameter.
// `raw` is that distance without the wobble — the water ribbon is built from the
// curve itself, so anything that must not stand in the water has to test against
// `raw`, not `d`. The wobble is up to ±1.6, which is harmless when the channel
// is a few units wide and enough to plant a tree mid-lake when it is 43.
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
  const raw = Math.sqrt(min);
  const d = raw + Math.sin(x * 0.16) * 0.9 + Math.cos(z * 0.2) * 0.7;
  return { d, t, raw };
}

// How far the water surface reaches past halfWidthAt — the ribbon is tucked
// under both banks by this much.
export const WATER_EDGE_PAD = 1.8;

// Is this spot under water (plus a margin of dry footing)? Use for anything
// planted on the ground; the terrain carve alone is not a reliable test once the
// channel is wide, because it is driven by the wobbled distance.
export function inWater(x, z, margin = 1.0) {
  const { t, raw } = streamAt(x, z);
  return raw < halfWidthAt(t) + WATER_EDGE_PAD + margin;
}

export function waterLevelAt(x, z) {
  return levelAt(streamAt(x, z).t);
}

export function distToStream(x, z) {
  return streamAt(x, z).d;
}
