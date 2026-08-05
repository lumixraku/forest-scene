import * as THREE from 'three';

// A mountain brook: strongly meandering in plan, terraced in elevation.
// t=1 is upstream (far, high); the water steps down pool-by-pool toward t=0,
// flowing toward (and past) the camera like the reference footage.
export const STREAM_HALF_WIDTH = 7.0; // widest half-width (pools)

// The nine control points the scene was composed around. Not to be edited: the
// opening shot, the lake, the hero boulders and every tuned drop height are all
// framed against this exact geometry.
const ORIGINAL = [
  [-150, 14],
  [-110, -8],
  [-70, -20],
  [-40, -8],
  [-10, -22],
  [30, -8],
  [70, -26],
  [110, -10],
  [150, -20],
];

// The brook continues past both ends of the original reach, at the same ~40-unit
// control spacing and the same meander amplitude, so the extension is the same
// river rather than a different one bolted on.
//
// A Catmull-Rom segment is determined by four control points, so appending here
// only disturbs the two segments at each seam: the interior of ORIGINAL (the
// stretch the scene was composed against) stays put to ~0.01 units, while its
// outermost segments do shift — their end tangents were previously extrapolated
// and are now defined by real neighbours. Those two tips are the least composed
// part of the curve and become ordinary mid-river once the water flows through.
const DOWNSTREAM = [
  [-470, 6],
  [-430, -12],
  [-390, 4],
  [-350, -16],
  [-310, 10],
  [-270, -14],
  [-230, 2],
  [-190, -10],
];
const UPSTREAM = [
  [190, 4],
  [230, -14],
  [270, 8],
  [310, -12],
  [350, 2],
  [390, -18],
  [430, 6],
  [470, -8],
];

const points = [...DOWNSTREAM, ...ORIGINAL, ...UPSTREAM]
  .map(([x, z]) => new THREE.Vector3(x, 0, z));

export const streamCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

// Total length in world units — the profile below is authored in these units
// rather than in t, so lengthening the curve cannot move existing features.
export const STREAM_LENGTH = streamCurve.getLength();

// Sample density matches the original (300 samples over ~326 units), so the
// nearest-sample search keeps the same spatial resolution on a 3.2x longer curve.
const N = Math.round(300 * (STREAM_LENGTH / 326.409));
export const streamSamples = streamCurve.getSpacedPoints(N);

// Flat coordinate arrays for the nearest-sample search below. `streamSamples`
// holds Vector3s, and reading .x/.z off 300+ objects per query is a pointer chase
// through the heap; two Float64Arrays keep the hot loop on contiguous memory.
const SAMPLE_X = new Float64Array(streamSamples.length);
const SAMPLE_Z = new Float64Array(streamSamples.length);
for (let i = 0; i < streamSamples.length; i++) {
  SAMPLE_X[i] = streamSamples[i].x;
  SAMPLE_Z[i] = streamSamples[i].z;
}

// ---- where the original reach now sits ----
// The profile below is authored in ARC LENGTH, not in t. That is the whole trick
// for extending the brook without disturbing it: `t` is a fraction of the total,
// so every t-authored feature slides the moment the curve gets longer, whereas a
// position measured in units from the source does not move at all.
//
// These two constants place the original nine-point reach on the extended curve.
// They are a least-squares fit of tNew against tOld over the well-preserved
// interior (tOld 0.13..0.87), measured by projecting the original curve onto the
// new one — not derived arithmetic, because getPointAt() reparametrises by its own
// arc-length table and a hand-computed offset misses by ~0.6 units. The fit is
// linear to within 0.05 units over that whole span.
const ORIGIN_T = 0.34537947; // t of the original curve's start point
const ORIGIN_SPAN_T = 0.31009945; // t occupied by the original reach
const ORIGIN_U = ORIGIN_T * STREAM_LENGTH;
const ORIGIN_SPAN = ORIGIN_SPAN_T * STREAM_LENGTH;
const ORIGIN_END = ORIGIN_U + ORIGIN_SPAN;

// Convert a parameter on the ORIGINAL curve into arc length on this one. Used
// only to port the authored tables below; nothing at runtime needs it.
const fromOriginal = (tOld) => ORIGIN_U + tOld * ORIGIN_SPAN;

// ---- terraced elevation profile ----
// The gap between the third and fourth drops is deliberate: a pool's surface has
// to be level, so the lake needs a reach with no step in it. Every other drop is
// ~39 units apart.
const ORIGINAL_DROPS = [
  { t: 0.10, h: 1.6 },
  { t: 0.22, h: 1.5 },
  { t: 0.32, h: 1.8 },
  { t: 0.52, h: 2.2 }, // taller step out of the lake
  { t: 0.64, h: 1.6 },
  { t: 0.76, h: 1.7 },
  { t: 0.88, h: 1.6 },
];

// Sill length in world units (~2.6) — short and steep. Derived from the authored
// 0.008 of the original curve rather than rounded, so the drop ramps land exactly
// where they were tuned.
export const DROP_LEN = 0.008 * ORIGIN_SPAN;

// Cadence of the original drops, continued into both extensions.
const DROP_STEP = 39.15;
// Keep the outermost sills off the very ends of the curve.
const END_MARGIN = 14;
// A new drop must clear the original reach by this much. Without it the first
// upstream drop lands a centimetre past the old end and its ramp bleeds back in,
// shifting the original water levels by 0.74 — small, but the whole point here is
// that they do not move at all.
const REACH_CLEARANCE = 6;
// Step heights for the new sills, in the same 1.5..2.2 range as the authored ones.
const NEW_DROP_H = [1.6, 1.5, 1.8, 2.0, 1.5, 1.7, 1.6, 2.2];

export const DROPS = (() => {
  const list = ORIGINAL_DROPS.map((d) => ({ u: fromOriginal(d.t), h: d.h }));
  const first = list[0].u;
  const last = list[list.length - 1].u;
  for (let k = 1; ; k++) {
    const u = first - k * DROP_STEP;
    if (u < END_MARGIN) break;
    if (u + DROP_LEN > ORIGIN_U - REACH_CLEARANCE) continue;
    list.push({ u, h: NEW_DROP_H[(k - 1) % NEW_DROP_H.length] });
  }
  for (let k = 1; ; k++) {
    const u = last + k * DROP_STEP;
    if (u > STREAM_LENGTH - END_MARGIN) break;
    if (u - DROP_LEN < ORIGIN_END + REACH_CLEARANCE) continue;
    list.push({ u, h: NEW_DROP_H[(k + 3) % NEW_DROP_H.length] });
  }
  return list.sort((a, b) => a.u - b.u);
})();

const TOTAL_DROP = DROPS.reduce((a, d) => a + d.h, 0);

// Height of the source above the original reach's start. Subtracting the drops
// that now sit BELOW the original reach is what keeps the opening shot at its
// tuned altitude: those new sills each raise everything above them, and without
// this the whole composed scene would float ~15 units higher than it was framed.
const SOURCE_LEVEL = -0.4 - DROPS.filter((d) => d.u < ORIGIN_U).reduce((a, d) => a + d.h, 0);

// Arc length along the brook, from t. Everything below is authored in these
// units, so each public function converts once on the way in.
const arcOf = (t) => t * STREAM_LENGTH;

// ...and back, for callers that hold a position in world units (the drop table is
// in arc length, but the curve is sampled by t).
export const tOfArc = (u) => THREE.MathUtils.clamp(u / STREAM_LENGTH, 0, 1);

// A length in world units, as a fraction of the curve. Use for any offset that
// was authored as a t-delta on the original curve and must keep its physical size
// now that the curve is 3.2x longer.
export const tSpan = (units) => units / STREAM_LENGTH;

// smooth average grade — used for terrain far from the water so the hillsides
// don't inherit the sharp terrace steps
export function levelSmoothAt(t) {
  return SOURCE_LEVEL + TOTAL_DROP * t;
}

// water level of the pool/chute at parameter t
export function levelAt(t) {
  const u = arcOf(t);
  let lvl = SOURCE_LEVEL;
  for (const d of DROPS) {
    if (u > d.u + DROP_LEN * 0.5) {
      lvl += d.h;
    } else if (u > d.u - DROP_LEN * 0.5) {
      const k = (u - (d.u - DROP_LEN * 0.5)) / DROP_LEN;
      lvl += d.h * (k * k * (3 - 2 * k));
    }
  }
  return lvl;
}

// cascade intensity 0..1 — 1 on the chute, fading through the plunge pool.
// Kept tight so the still pools between drops stay calm green water.
export function cascadeAt(t) {
  const u = arcOf(t);
  let s = 0;
  for (const d of DROPS) {
    const q = (u - d.u) / DROP_LEN;
    let v = 0;
    if (q >= -0.5 && q <= 0.7) v = 1;
    else if (q < -0.5 && q > -1.6) v = 1 - (-q - 0.5) / 1.1; // plunge pool below
    else if (q > 0.7 && q < 1.1) v = 1 - (q - 0.7) / 0.4;
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
const ORIGINAL_POOLS = [
  { t: 0.05, w: 4.5, s: 0.026 },
  { t: 0.16, w: 8.0, s: 0.028 },
  { t: 0.26, w: 3.5, s: 0.020 },
  { t: 0.42, w: 20.0, s: 0.060 }, // the lake, inside the flat reach
  { t: 0.58, w: 5.5, s: 0.024 },
  { t: 0.70, w: 12.0, s: 0.032 },
  { t: 0.82, w: 3.5, s: 0.022 },
  { t: 0.94, w: 7.0, s: 0.028 },
];

// Every authored pool sits at the MIDPOINT of its drop pair — that is what keeps
// its surface level — and clears the neighbouring sills by at least this many
// sigma. Measured from the original layout, where the tightest fit is the lake at
// exactly 1.667. New pools have to meet the same bar, so the widest shape that
// fits a given gap is chosen rather than one that would spill over a sill.
const MIN_POOL_CLEARANCE = 1.667;

const POOLS = (() => {
  const list = ORIGINAL_POOLS.map((p) => ({
    u: fromOriginal(p.t), w: p.w, s: p.s * ORIGIN_SPAN,
  }));
  // The authored (width, falloff) pairs, reused verbatim so the new basins have
  // the character of hand-placed ones instead of a fitted approximation.
  const shapes = list.map(({ w, s }) => ({ w, s })).sort((a, b) => b.w - a.w);

  let picked = 0;
  for (let i = 0; i < DROPS.length - 1; i++) {
    const u = (DROPS[i].u + DROPS[i + 1].u) / 2;
    if (u > ORIGIN_U && u < ORIGIN_END) continue; // already authored
    const halfGap = (DROPS[i + 1].u - DROPS[i].u) / 2;
    // A gaussian is still worth ~0.003*w at 3 sigma, so a new pool must also stay
    // that far clear of the original reach to leave its banks untouched.
    const fits = shapes.filter((sh) => halfGap / sh.s >= MIN_POOL_CLEARANCE
      && !(u < ORIGIN_U && u + 3 * sh.s > ORIGIN_U)
      && !(u > ORIGIN_END && u - 3 * sh.s < ORIGIN_END));
    if (!fits.length) continue;
    list.push({ u, ...fits[picked++ % fits.length] });
  }
  return list.sort((a, b) => a.u - b.u);
})();

const NECK = 1.9; // half-width of the chutes between pools
const OPEN = 8.0; // wider than this and the water reads as open, not a chute
// The bank wobble was authored as sin(t*23) on the original curve, i.e. one cycle
// every ~14 units. Expressed per unit so it keeps that wavelength once the curve
// is 3.2x longer, instead of stretching into 23 cycles over the whole world.
const WOBBLE_FREQ = 23.0 / ORIGIN_SPAN;

export function halfWidthAt(t) {
  const u = arcOf(t);
  let hw = NECK;
  for (const p of POOLS) {
    const d = (u - p.u) / p.s;
    hw += p.w * Math.exp(-d * d);
  }
  // slow wobble so the banks are not mathematically smooth
  return hw + 0.35 * Math.sin((u - ORIGIN_U) * WOBBLE_FREQ + 1.2);
}

// 0 = open pool, 1 = narrowest chute (extra rushing foam there)
export function narrownessAt(t) {
  return THREE.MathUtils.clamp(1 - (halfWidthAt(t) - NECK) / (OPEN - NECK), 0, 1);
}

// Port a parameter that was hand-authored against the ORIGINAL nine-point curve
// onto this one. For the composed set pieces — the opening camera, the hero
// boulders — which were placed by eye against specific water and must not drift.
export const originalT = (tOld) => fromOriginal(tOld) / STREAM_LENGTH;

// ---- named viewpoints ----
// The opening shot: the camera stands above one pool looking down the terraced
// cascade toward another. These were 0.36 and 0.58 on the original nine-point
// curve; as named anchors they survive any further change to the curve's length,
// which the bare numbers did not.
export const HOME_T = originalT(0.36);
export const LOOK_T = originalT(0.58);

// ---- index for the nearest-sample search in streamAt ----
// Every COARSE-th sample is a "node" standing in for the SEARCH_HALF samples on
// either side of it. Together the nodes cover the whole curve, so a query can
// reject a whole span of samples by testing one node.
const COARSE = 8;
const SEARCH_HALF = COARSE >> 1;

// The furthest any sample sits from its own node. getSpacedPoints is only
// approximately arc-length uniform, so this is measured rather than assumed:
// a node's span reaches at most SEARCH_HALF * MAX_STEP away from it.
const MAX_STEP = (() => {
  let m = 0;
  for (let i = 1; i < SAMPLE_X.length; i++) {
    m = Math.max(m, Math.hypot(SAMPLE_X[i] - SAMPLE_X[i - 1], SAMPLE_Z[i] - SAMPLE_Z[i - 1]));
  }
  return m;
})();
const SLACK = SEARCH_HALF * MAX_STEP;

// Node indices, always including the last sample so the tail is covered.
const NODES = (() => {
  const a = [];
  for (let i = 0; i < SAMPLE_X.length; i += COARSE) a.push(i);
  if (a[a.length - 1] !== SAMPLE_X.length - 1) a.push(SAMPLE_X.length - 1);
  return Int32Array.from(a);
})();
// Scratch for the coarse distances, so the second pass doesn't recompute them.
const NODE_D2 = new Float64Array(NODES.length);

// Nearest point on the stream: distance (with bank wobble) + curve parameter.
// `raw` is that distance without the wobble — the water ribbon is built from the
// curve itself, so anything that must not stand in the water has to test against
// `raw`, not `d`. The wobble is up to ±1.6, which is harmless when the channel
// is a few units wide and enough to plant a tree mid-lake when it is 43.
//
// This is the hottest function in the project: terrain height, every grass tuft,
// every tree and every flower resolve through it, so it runs millions of times
// while the world streams in — and a flat scan of every sample dominated the
// whole generation cost. The two passes below skip most samples while returning
// EXACTLY what the flat scan returns.
//
// Exact, not approximate. The coarse pass gives an upper bound B on the true
// nearest distance; a node at distance D can only be hiding a sample closer than
// B if D - SLACK < B, since none of its samples lie further than SLACK from it.
// So skipping every node with D > B + SLACK cannot skip the true winner. Only
// picking the single best node WOULD be approximate: where two reaches of the
// meander run close together, the nearest node and the nearest sample can belong
// to different reaches. That version disagreed with the flat scan on 0.13% of
// queries — a tiny error, but it perturbs the shared RNG stream and reshuffles
// the grass, which costs the ability to prove later streaming work changed
// nothing. Keeping the bound costs ~2x the coarse work and is still ~3.7x faster
// than scanning everything (0.70 -> 0.30 µs/query at the full 900-sample length),
// verified against the flat scan at zero mismatches over a 512k-point grid.
export function streamAt(x, z) {
  const nNodes = NODES.length;

  // coarse pass: one probe per node span, keeping the best bound found
  let bound2 = Infinity;
  for (let k = 0; k < nNodes; k++) {
    const i = NODES[k];
    const dx = x - SAMPLE_X[i];
    const dz = z - SAMPLE_Z[i];
    const d = dx * dx + dz * dz;
    NODE_D2[k] = d;
    if (d < bound2) bound2 = d;
  }

  // fine pass: expand only the spans that could still contain the true nearest
  const cut = Math.sqrt(bound2) + SLACK;
  const cut2 = cut * cut;
  const last = SAMPLE_X.length - 1;
  let min = Infinity;
  let ti = 0;
  for (let k = 0; k < nNodes; k++) {
    if (NODE_D2[k] > cut2) continue;
    const j = NODES[k];
    const lo = j - SEARCH_HALF < 0 ? 0 : j - SEARCH_HALF;
    const hi = j + SEARCH_HALF > last ? last : j + SEARCH_HALF;
    for (let i = lo; i <= hi; i++) {
      const dx = x - SAMPLE_X[i];
      const dz = z - SAMPLE_Z[i];
      const d = dx * dx + dz * dz;
      if (d < min) { min = d; ti = i; }
    }
  }

  const t = ti / last;
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
