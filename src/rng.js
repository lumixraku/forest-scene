// Deterministic randomness for the whole scene.
//
// Every placement routine in this project calls bare `Math.random()` — a few
// hundred call sites across trees, foliage, grass and stream. So the seeding is
// done by REPLACING `Math.random` rather than by threading a generator through
// all of them.
//
// The scene used to install one global sequence at startup and let the modules
// run through it in order. That is only deterministic while the generation order
// is fixed, which stops being true the moment terrain is streamed: a cell built
// when you walk north draws different numbers than the same cell built when you
// approach from the south, so re-entering an area would regrow it differently and
// the world would visibly flicker as you move.
//
// `withSeed` fixes that by giving each cell its OWN sequence, derived from its
// coordinates. Position in the world determines the numbers, so a cell rebuilds
// identically no matter when or in what order it is visited.

// mulberry32 — the same generator the scene has always used.
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLD_SEED = 20250614;

// Install the global sequence. Shared geometry built once at startup (trunk
// profiles, crown lathes, rock shapes) draws from this, exactly as before.
export function installGlobalRandom() {
  Math.random = mulberry32(WORLD_SEED);
}

// Mix cell coordinates and a layer tag into a well-distributed 32-bit seed.
// Coordinates are signed and small, so they must be avalanched rather than just
// added: `cx * 73856093 ^ cz * 19349663` alone leaves neighbouring cells with
// correlated seeds, which shows up as visible diagonal banding in the layout.
export function cellSeed(cx, cz, layer = 0) {
  let h = Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cz | 0, 0x165667b1) ^ Math.imul(layer | 0, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

// Run `fn` with `Math.random` bound to a sequence derived from `seed`, then put
// the previous one back. Restoring in `finally` matters: a throw inside a cell
// build would otherwise leave the whole scene stuck on that cell's generator.
export function withSeed(seed, fn) {
  const prev = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}
