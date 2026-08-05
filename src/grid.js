// The world as an unbounded grid of square chunks, and the seeded randomness
// that makes a chunk's contents depend on WHERE it is rather than WHEN it loaded.
//
// The scene used to be one 300-unit square built in a fixed order at startup,
// and `main.js` leaned on that: it replaced Math.random with a seeded generator
// so the layout came out identical on every reload. That trick works only while
// the call ORDER is fixed. Chunks stream in and out by camera distance, so the
// order now depends on where the player walks — under a single global sequence
// the same patch of ground would grow three maples on one visit and a bare
// meadow on the next, and unloading a chunk and coming back would reshuffle it.
//
// So randomness is addressed by chunk instead. Each (cx, cz) plus a subsystem
// salt seeds its own generator, which makes a chunk's contents a pure function
// of its coordinates: load order, reload count and walking direction cannot
// affect it. `withChunkRng` swaps Math.random for the duration of one build so
// the existing modules keep calling Math.random and need no rewrite.

// 300 matches the ground plane the scene was authored around, so the middle
// chunk keeps the composition the camera opens on. Chunks tile exactly at this
// spacing: terrainHeight is a continuous function of world x/z, so abutting
// ground planes meet without a seam as long as the pitch matches the plane size.
export const CHUNK = 300;
export const HALF = CHUNK / 2;

// How far out from the camera's own chunk to consider, in chunks. This is a
// WINDOW ON AN UNBOUNDED GRID, not the size of the world: chunk coordinates run
// as far as the player walks, and this only says how much of it to think about at
// once. 2 gives a 5x5 candidate set, which is wider than the furthest step radius
// so nothing pops in at the edge of view.
export const WINDOW = 2;

// The chunks worth considering right now, nearest the camera first.
//
// This used to be a hardcoded 3x3 around the origin, which made the world 900
// units across with a hard edge: walk to 450 and the ground simply stopped, in a
// straight line, with open sky past it. That read as broken terrain rather than as
// a boundary, and it is not what an endless forest should do.
//
// Nothing about the generator needed changing to lift the limit — a chunk's
// contents are already a pure function of its coordinates (see withChunkRng), so
// chunk (37, -12) has always been perfectly well defined. Only this function knew
// about the edge.
export function allChunks(camX = 0, camZ = 0) {
  const ccx = Math.round(camX / CHUNK);
  const ccz = Math.round(camZ / CHUNK);
  const out = [];
  for (let dz = -WINDOW; dz <= WINDOW; dz++) {
    for (let dx = -WINDOW; dx <= WINDOW; dx++) out.push({ cx: ccx + dx, cz: ccz + dz });
  }
  // Nearest the camera first, so the chunk underfoot is always built before its
  // neighbours.
  return out.sort((a, b) => {
    const da = (a.cx - ccx) ** 2 + (a.cz - ccz) ** 2;
    const db = (b.cx - ccx) ** 2 + (b.cz - ccz) ** 2;
    return da - db;
  });
}

export const chunkKey = (cx, cz) => `${cx},${cz}`;

// World-space centre of a chunk, and the chunk containing a world position.
export const chunkCentre = (cx, cz) => ({ x: cx * CHUNK, z: cz * CHUNK });
export const chunkAt = (x, z) => ({ cx: Math.round(x / CHUNK), cz: Math.round(z / CHUNK) });

// Half the diagonal of a chunk — the distance from its centre to a corner. Used
// by the loader: a chunk is "within range R" if any part of it could be, which
// means testing centre distance against R plus this.
export const CHUNK_REACH = Math.SQRT2 * HALF;

// mulberry32. Small, fast, and good enough for scattering trees; the point here
// is reproducibility from an explicit seed, not statistical quality.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix chunk coordinates and a subsystem name into a seed. The salt is what stops
// the trees and the grass in one chunk from walking through the same number
// sequence — without it every subsystem would draw identical values and the
// grass would land in the same spots as the trees.
function seedFor(cx, cz, salt) {
  let h = 0x9e3779b9 ^ Math.imul(cx | 0, 0x85ebca6b) ^ Math.imul(cz | 0, 0xc2b2ae35);
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x27d4eb2d);
  h ^= h >>> 15;
  return h >>> 0;
}

// Run `fn` with Math.random bound to this chunk+salt's own sequence, then put
// the previous Math.random back. try/finally because a throw mid-build would
// otherwise leave the whole app on a chunk-local generator.
export function withChunkRng(cx, cz, salt, fn) {
  const prev = Math.random;
  Math.random = mulberry32(seedFor(cx, cz, salt));
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

// Free every geometry a chunk's Group owns. Materials and textures are shared
// singletons across all chunks, so they are deliberately NOT disposed — dropping
// a material on unload would force three.js to recompile its shader program the
// next time any chunk used it, which on this scene is a visible hitch.
//
// Some GEOMETRY is shared too, for the same reason: the understory's card meshes
// and blob shells are identical in every chunk, so they are built once. Those are
// tagged `userData.shared` and skipped here — disposing one on unload would leave
// every other chunk drawing a freed buffer.
export function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose();
  });
  group.clear();
}
