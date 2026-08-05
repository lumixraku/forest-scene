import * as THREE from 'three';

// A mountain brook: strongly meandering in plan, terraced in elevation.
// t=1 is upstream (far, high); the water steps down pool-by-pool toward t=0,
// flowing toward (and past) the camera like the reference footage.
export const STREAM_HALF_WIDTH = 7.0; // widest half-width (pools)

// The brook now crosses the whole 3x3 field, entering at the far upstream corner
// and leaving at the far downstream one. The middle nine-hundred-unit span
// (-150..150) keeps its original control points EXACTLY, so the chunk the camera
// opens in has the same channel, the same pools and the same framing it always
// had; the new points only extend the curve outward past that.
//
// Because the curve is longer, the same `t` no longer lands in the same place: t
// used to run 0..1 over 300 units and now runs over ~900. Everything authored
// against t — the terrace drops, the pools, the camera's own start position —
// is therefore expressed relative to the middle span below rather than as bare
// numbers.
// The extensions drift in z as well as x, so the brook enters at one corner of
// the 3x3 and leaves at the opposite one instead of running straight down the
// middle row. Keeping z near 0 would have left the four corner chunks and the
// two side chunks with no water in them at all — six of nine chunks with no
// terrain focus, since the whole valley shape is derived from distance to the
// stream. The small irregular steps in z on top of the drift are the meander;
// without them the extensions read as two straight canals bolted to a winding
// middle.
const points = [
  [-450, 384],
  [-410, 336],
  [-370, 310],
  [-330, 254],
  [-290, 218],
  [-250, 162],
  [-210, 108],
  [-190, 48],
  // ---- the original authored span begins here ----
  [-150, 14],
  [-110, -8],
  [-70, -20],
  [-40, -8],
  [-10, -22],
  [30, -8],
  [70, -26],
  [110, -10],
  [150, -20],
  // ---- and ends here ----
  [190, -60],
  [210, -104],
  [250, -150],
  [290, -196],
  [330, -238],
  [370, -292],
  [410, -330],
  [450, -384],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export const streamCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

// Where the original 300-unit scene sits in the new, longer parameter range.
//
// This has to be measured, not counted. The obvious answer is "8 of 24
// segments, so 8/24", and it is wrong: every `t` in this module comes from
// getSpacedPoints / getPointAt, which are parameterised by ARC LENGTH, while
// segment index is parameterised by control point. The diagonal extensions cover
// more distance per segment than the winding middle does, so the old span is
// really ~0.25 of the arc length, and 8/24 put its boundary 40 units past the
// authored control point.
function arcParamOf(target) {
  const STEPS = 4000;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const p = streamCurve.getPointAt(u);
    const d = (p.x - target[0]) ** 2 + (p.z - target[1]) ** 2;
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}
export const MID_T0 = arcParamOf([-150, 14]);
export const MID_T1 = arcParamOf([150, -20]);
// Map a "middle-span" parameter (0..1 over the original scene) to curve t.
export const midT = (u) => MID_T0 + (MID_T1 - MID_T0) * u;

// Sample density scales with the curve: 300 samples over 300 units was one per
// unit, and keeping that pitch over ~2700 units of arc length is what holds
// streamAt's precision — too coarse and `raw` overshoots, which plants trees in
// the water and tears the bank foam.
const N = 2400;
export const streamSamples = streamCurve.getSpacedPoints(N);

// ---- terraced elevation profile ----
// The gap between 0.32 and 0.52 is deliberate: a pool's surface has to be level,
// so the lake needs a reach with no step in it. Every other drop is ~0.12 apart.
// The terrace pattern the middle span was authored with, in middle-span
// parameter (0..1 over the original 300-unit scene).
const MID_DROPS = [
  { u: 0.10, h: 1.6 },
  { u: 0.22, h: 1.5 },
  { u: 0.32, h: 1.8 },
  { u: 0.52, h: 2.2 }, // taller step out of the lake
  { u: 0.64, h: 1.6 },
  { u: 0.76, h: 1.7 },
  { u: 0.88, h: 1.6 },
];
const SPAN = MID_T1 - MID_T0; // 1/3 — one chunk's worth of curve parameter

// Repeat that pattern up and down the extended curve so the whole valley keeps
// descending at the SAME physical cadence — a step roughly every 40 units. The
// rep=0 copy is the original span, reproduced exactly.
//
// Two reps each way, not one. The middle span is ~0.25 of the arc length while
// each extension is ~0.37, so one repetition per side covers only as far as
// t=0.13 and t=0.88 and left the outermost stretch of the brook with no terraces
// and no pools at all — a flat, constant-width canal running off both corners.
// The out-of-range copies are harmless: levelAt and halfWidthAt only ever
// evaluate t in 0..1, so a drop authored past either end simply never applies.
const REPS = [-2, -1, 0, 1, 2];
export const DROPS = REPS
  .flatMap((rep) => MID_DROPS.map((d) => ({ t: midT(d.u) + rep * SPAN, h: d.h })))
  .sort((a, b) => a.t - b.t);
// ~2.5 world units, same as before — but t now covers 3x the arc length, so the
// parameter width of one sill is a third of what it was.
export const DROP_LEN = 0.008 * SPAN;

const TOTAL_DROP = DROPS.reduce((a, d) => a + d.h, 0);
// Sum of the drops BELOW the middle span. The original scene's downstream end
// sat at -0.4, and it has to stay there or the middle chunk's water, banks and
// terrain all shift vertically. So the datum is pushed down by however much the
// new downstream extension descends, and the extension goes BELOW the old scene
// rather than lifting it.
const BELOW_MID = DROPS.filter((d) => d.t < MID_T0).reduce((a, d) => a + d.h, 0);
const BASE = -0.4 - BELOW_MID;

// smooth average grade — used for terrain far from the water so the hillsides
// don't inherit the sharp terrace steps
export function levelSmoothAt(t) {
  return BASE + TOTAL_DROP * t;
}

// water level of the pool/chute at parameter t
export function levelAt(t) {
  let lvl = BASE;
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
// Again authored in middle-span parameter, then repeated. `s` is a parameter
// width, so it scales with SPAN along with everything else — left at its old
// value each pool would have stretched to three times its physical length and
// the lake would have swallowed a third of the valley.
const MID_POOLS = [
  { u: 0.05, w: 4.5, s: 0.026 },
  { u: 0.16, w: 8.0, s: 0.028 },
  { u: 0.26, w: 3.5, s: 0.020 },
  { u: 0.42, w: 20.0, s: 0.060 }, // the lake, inside the 0.32-0.52 flat reach
  { u: 0.58, w: 5.5, s: 0.024 },
  { u: 0.70, w: 12.0, s: 0.032 },
  { u: 0.82, w: 3.5, s: 0.022 },
  { u: 0.94, w: 7.0, s: 0.028 },
];
// The upstream and downstream copies get their pool widths shuffled between the
// authored values rather than repeating the lake verbatim in all three chunks —
// one 40-unit lake per 300 units is a landmark, three identical ones in a row
// read as a tiled texture. Widths only; the spacing pattern stays.
const REP_W = {
  '-2': [8.0, 4.5, 3.5, 20.0, 7.0, 12.0, 3.5, 5.5],
  '-1': [5.5, 12.0, 3.5, 8.0, 4.5, 20.0, 3.5, 7.0],
  '1': [7.0, 4.5, 3.5, 12.0, 5.5, 20.0, 3.5, 8.0],
  '2': [4.5, 8.0, 3.5, 20.0, 12.0, 5.5, 3.5, 7.0],
};
const POOLS = REPS.flatMap((rep) =>
  MID_POOLS.map((p, i) => ({
    t: midT(p.u) + rep * SPAN,
    w: rep === 0 ? p.w : REP_W[rep][i],
    s: p.s * SPAN,
  }))
);
const NECK = 1.9; // half-width of the chutes between pools
const OPEN = 8.0; // wider than this and the water reads as open, not a chute

export function halfWidthAt(t) {
  let hw = NECK;
  for (const p of POOLS) {
    const d = (t - p.t) / p.s;
    hw += p.w * Math.exp(-d * d);
  }
  // Slow wobble so the banks are not mathematically smooth. Divided by SPAN to
  // hold its PHYSICAL wavelength: this frequency is in parameter space, and t now
  // covers three times the arc length, so the bare 23.0 would have stretched
  // every wobble to three times its authored length.
  return hw + 0.35 * Math.sin((t / SPAN) * 23.0 + 1.2);
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
// Exact nearest-sample lookup table over the whole field.
//
// Built ONCE at module load by brute force — for every cell centre, the truly
// nearest sample index. 2400 samples over a 24-unit grid spanning 1000 units is
// ~4.2M distance tests, about 30ms at startup, and it makes every subsequent query
// a hash lookup plus a short local refine.
//
// The table has to hold the EXACT nearest, not a nearby guess. A cheaper
// neighbour-claiming pass leaves cells seeded from the wrong stretch of water
// wherever the brook doubles back on itself, and a local hill-climb cannot escape
// that basin: measured 178 units of distance error at (368, 391), where the curve
// passes within a few tens of units of an earlier bend.
// Beyond this distance from the water, the seed table's answer is taken as final
// (see streamAt). 120 clears the furthest saturation point of anything that reads
// the distance — terrainHeight's valley-side ramp ends at 95, and the widest
// species band and scatter threshold are both under 100 — with room to spare.
const FAR_EXACT = 120;

const SEED_CELL = 24;
// The early-out compares the SEED's distance, not the true one. A seed can be off
// by up to half a cell diagonal in each axis, so the cutoff is pushed out by that
// much to guarantee everything inside FAR_EXACT still takes the exact path.
const FAR_CUTOFF = FAR_EXACT + SEED_CELL * Math.SQRT2;
// The table has to cover enough ground that ANY query outside it is provably
// farther from the brook than FAR_CUTOFF — then a query off the edge can take the
// early-out safely and there is no need for a fallback path.
//
// The curve itself lives inside ±450, so a box of 450 + FAR_CUTOFF + one cell
// guarantees it: a point beyond the edge is at least (SEED_MAX - 450) away from any
// sample, which is comfortably past the cutoff. This matters now that the world is
// unbounded — the player can walk to x=5000, and the old ±520 box fell back to a
// full 2400-sample scan out there, which is exactly the 98%-of-CPU path this table
// was built to avoid.
const SEED_MIN = -(450 + FAR_CUTOFF + SEED_CELL * 2);
const SEED_MAX = 450 + FAR_CUTOFF + SEED_CELL * 2;
const SEED_DIM = Math.ceil((SEED_MAX - SEED_MIN) / SEED_CELL) + 1;
const seedTable = new Int16Array(SEED_DIM * SEED_DIM);
{
  for (let gz = 0; gz < SEED_DIM; gz++) {
    const cz = SEED_MIN + gz * SEED_CELL;
    for (let gx = 0; gx < SEED_DIM; gx++) {
      const cx = SEED_MIN + gx * SEED_CELL;
      let best = 0, bd = Infinity;
      for (let i = 0; i < streamSamples.length; i++) {
        const p = streamSamples[i];
        const d = (cx - p.x) * (cx - p.x) + (cz - p.z) * (cz - p.z);
        if (d < bd) { bd = d; best = i; }
      }
      seedTable[gz * SEED_DIM + gx] = best;
    }
  }
}

// Clamped to the table's edge rather than reporting a miss. Everything outside the
// box is far enough from the brook to take the early-out (see SEED_MIN), and the
// edge cell's nearest sample is the right seed for anything beyond it in that
// direction — the curve does not continue past the box, so distance only grows.
function seedIndex(x, z) {
  const gx = Math.min(SEED_DIM - 1, Math.max(0, Math.round((x - SEED_MIN) / SEED_CELL)));
  const gz = Math.min(SEED_DIM - 1, Math.max(0, Math.round((z - SEED_MIN) / SEED_CELL)));
  return seedTable[gz * SEED_DIM + gx];
}

// Spatial hash over the samples, so the exhaustive search below only has to look
// at the buckets near the query rather than all 2400 samples.
const BUCKET = 24;
const sampleGrid = new Map();
const gkey = (gx, gz) => gx * 73856093 ^ gz * 19349663;
for (let i = 0; i < streamSamples.length; i++) {
  const p = streamSamples[i];
  const k = gkey(Math.floor(p.x / BUCKET), Math.floor(p.z / BUCKET));
  let list = sampleGrid.get(k);
  if (!list) sampleGrid.set(k, (list = []));
  list.push(i);
}

// Last result, keyed by coordinate. The scatter loops query the SAME point two or
// three times in a row — grass calls streamAt, then terrainHeight (which calls it
// again), then inWater (a third time) — so a one-entry cache removes two thirds of
// the calls without any caller having to thread the result through.
let lastX = NaN;
let lastZ = NaN;
let lastResult = null;

export function streamAt(x, z) {
  if (x === lastX && z === lastZ) return lastResult;
  const out = streamAtUncached(x, z);
  lastX = x;
  lastZ = z;
  lastResult = out;
  return out;
}

function streamAtUncached(x, z) {
  // Seed with the table's exact answer for the nearest cell centre, then confirm it
  // with a ring walk over the spatial hash.
  //
  // Both halves are load-bearing. The ring walk alone was the original code, and it
  // could not terminate early for a query far from the water: `min` stayed Infinity
  // until a ring finally reached the brook, so every intermediate ring was scanned
  // in full. The brook is a thin diagonal across 900 units, so the far corners
  // (~500 units out, 20+ rings, ~1900 cell lookups) are the common case rather than
  // the exception — profiling put streamAt at 98% of a 10.5s chunk build.
  //
  // Seeding it alone is not enough either. A local hill-climb from the seed is fast
  // but WRONG where the brook doubles back on itself: the true nearest sample can be
  // 900 indices away along the curve while sitting a few units away in space, and a
  // climb cannot cross the gap between the two branches. Measured 178 units of
  // distance error before the ring walk went back in.
  //
  // Together the seed makes `min` tight from the first iteration, so the radius test
  // cuts the walk off after a ring or two, and the walk still guarantees the exact
  // nearest. Cost falls to the near-bank case everywhere; results are unchanged.
  const N = streamSamples.length;
  // Always a valid index — seedIndex clamps to the table edge, and the table is
  // sized so anything past its edge takes the early-out below.
  let ti = seedIndex(x, z);
  let min;
  {
    const p = streamSamples[ti];
    min = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
  }
  // Far from the water, the table's answer is used AS the answer and the ring walk
  // is skipped entirely.
  //
  // This is where the cost actually was. Seeding does not help a distant query on
  // its own: the seed sets `min` to the true distance, and if that is 500 units then
  // the radius test only bites at ring 21, so the walk still scans ~1900 cells.
  // Proving which sample is nearest genuinely requires searching out to it.
  //
  // But past this radius nothing in the scene can tell the difference. Every
  // distance-driven term in terrainHeight has saturated by d=95 (the valley-side
  // smoothstep tops out there, roughness by 22, knolls by 34, and the channel carve
  // only applies within bank width), and every caller that thresholds on distance
  // does so well inside it. What still matters far out is `t`, which the table
  // carries exactly for the cell centre and which drifts slowly at this range.
  // Verified below against brute force: inside FAR_EXACT the result is exact.
  // The test is on the SEED's distance, which can overstate the true distance by up
  // to a cell diagonal — so the cutoff carries that slop, or queries whose true
  // distance is just inside FAR_EXACT would take the early-out and come back
  // approximate. Measured 7.3 units of error at a true distance of 112.9 before the
  // margin went in.
  if (min > FAR_CUTOFF * FAR_CUTOFF) {
    const t = ti / (N - 1);
    const raw = Math.sqrt(min);
    return { d: raw + Math.sin(x * 0.16) * 0.9 + Math.cos(z * 0.2) * 0.7, t, raw };
  }
  const gx = Math.floor(x / BUCKET);
  const gz = Math.floor(z / BUCKET);
  for (let ring = 0; ring < 64; ring++) {
    // Everything in this ring is at least (ring-1)*BUCKET away, so once that floor
    // exceeds the best distance found, no further ring can improve on it.
    if (min < Infinity) {
      const floorD = (ring - 1) * BUCKET;
      if (floorD > 0 && floorD * floorD > min) break;
    }
    let any = false;
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // ring shell only — the interior was covered by earlier iterations
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const list = sampleGrid.get(gkey(gx + dx, gz + dz));
        if (!list) continue;
        any = true;
        for (const i of list) {
          const p = streamSamples[i];
          const ddx = x - p.x;
          const ddz = z - p.z;
          const d = ddx * ddx + ddz * ddz;
          if (d < min) { min = d; ti = i; }
        }
      }
    }
    // keep widening while nothing has been found at all
    if (!any && min === Infinity) continue;
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
