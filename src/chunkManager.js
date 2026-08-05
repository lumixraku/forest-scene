import * as THREE from 'three';
import {
  CHUNK, CHUNK_REACH, WINDOW, allChunks, chunkKey, chunkCentre, withChunkRng, disposeGroup,
} from './grid.js';
import { createGround } from './ground.js';
import { createGrass, GRASS_BANDS } from './grass.js';
import { createTrees } from './trees.js';
import { createFoliage } from './foliage.js';
import { createStream } from './stream.js';

// Streams the field in and out around the camera, one chunk at a time. The grid
// is unbounded — chunk coordinates run as far as the player walks — so this is
// also the only thing keeping the resident set finite.
//
// The problem this solves is not memory, it is the frame it lands on. Building a
// chunk means ~49k ground vertices, 60k grass tufts, ~430 trees and a stretch of
// water — roughly a third of a second of synchronous work. Nine of those at
// startup is a three-second white screen, and one of them mid-flight is a visible
// freeze. So a chunk's build is split into STEPS, and the manager runs steps under
// a per-frame time budget: as many as fit, then it yields to the renderer.
//
// The steps are ordered so a chunk becomes useful as early as possible. Ground
// first — that is the silhouette of the land and the thing whose absence reads as
// a hole. Trees next, since they carry the scene's character. Grass, the most
// expensive step, comes after the chunk already looks like forest, and the
// understory last: it is only legible up close, where the chunk has usually been
// resident for a while.
const STEPS = ['ground', 'trees', 'stream', 'grass', 'foliage'];

// How much of a frame chunk building may take. 8ms of a 16.7ms frame leaves the
// renderer its share — the scene's own draw is ~2ms CPU, and the rest is GPU time
// that overlaps this work anyway. Raising it loads faster and stutters more.
const BUDGET_MS = 8;

// Load anything whose nearest corner is within this, unload past the hysteresis
// band. The two thresholds must differ: with a single radius, a camera sitting
// exactly on the boundary rebuilds and destroys the same chunk every few frames.
//
// 1.35 chunks looked conservative and was not: distance is measured to a chunk's
// nearest CORNER, and a chunk's centre-to-corner reach is already 212 units, so a
// 405-unit radius admitted all nine chunks from anywhere in the field. Nothing
// ever unloaded, every chunk was resident at once — 2142 draw calls and 13.6M
// triangles — and the frame rate fell to 6fps. The streaming was doing the work
// of building chunks without ever getting the benefit of dropping them.
//
// 0.55 chunks keeps the chunk underfoot plus the ones actually adjacent, which is
// the "one chunk at a time" behaviour this was for.
const LOAD_DIST = CHUNK * 0.55;
const UNLOAD_DIST = CHUNK * 0.95;

// Per-step load radii, as a multiple of LOAD_DIST. A single radius for the whole
// chunk is what forced the choice between "distant hole in the terrain" and
// "60k grass tufts you cannot see".
//
// Ground has to reach furthest — it is the silhouette of the land, and its absence
// is a hole in the horizon, for 1 draw call and 97k triangles. Grass is the
// opposite: 1.08M triangles per chunk, 71% of a chunk's entire cost, and
// individual tufts stop resolving within a few tens of metres. Trees sit between:
// they carry the scene's character at a distance, so they reach past the grass.
const STEP_REACH = {
  ground: 3.4,   // whole field: cheap, and gaps read as missing land
  trees: 1.6,    // the treeline is the scene's silhouette
  stream: 1.6,   // water is the thing the eye follows
  foliage: 1.0,  // understory only reads close up
  grass: 0.75,   // 71% of the cost, invisible past ~100 units
};

// Grass is the one step too big for a single frame (~270ms against an 8ms budget),
// so it is queued as GRASS_BANDS separate jobs — each one a horizontal strip of the
// chunk, complete and drawable on its own.
const bandsOf = (step) => (step === 'grass' ? GRASS_BANDS : 1);

export function createChunkManager(scene, camera, onSceneChanged) {
  // key -> { cx, cz, groups: {}, stream, grass }
  // A chunk is no longer all-or-nothing: `groups` holds whichever steps are
  // currently built, and each one comes and goes on its own radius.
  const live = new Map();
  const camXZ = new THREE.Vector2();
  const lastGrassCam = new THREE.Vector2(Infinity, Infinity);
  // Pending work, as {cx, cz, step} — one step of one chunk, not a whole chunk.
  let queue = [];

  const centreDist = (cx, cz) => {
    const c = chunkCentre(cx, cz);
    return Math.max(0, Math.hypot(c.x - camXZ.x, c.z - camXZ.y) - CHUNK_REACH);
  };

  const entryFor = (cx, cz) => {
    const key = chunkKey(cx, cz);
    let e = live.get(key);
    if (!e) {
      e = { cx, cz, groups: {}, stream: null, grass: null };
      live.set(key, e);
    }
    return e;
  };

  // Build one step of one chunk. Each step is wrapped in its own chunk-seeded
  // generator, salted per subsystem, so a chunk's contents depend only on its
  // coordinates — not on which chunk was built before it, or how many times this
  // one has been loaded. That is the property that makes unload/reload safe.
  function runStep(cx, cz, step, band = 0) {
    const entry = entryFor(cx, cz);
    // Grass arrives in bands, so its presence is tracked by how many have landed;
    // everything else is simply built or not.
    if (step === 'grass') {
      if ((entry.grassBands || 0) > band) return;
    } else if (entry.groups[step]) {
      return;
    }
    // Each band is salted with its index, so band 2 does not replay band 1's draws
    // — otherwise every band would place its tufts at the same spots within its
    // own strip and the chunk would come out in visible stripes.
    withChunkRng(cx, cz, step === 'grass' ? `grass${band}` : step, () => {
      if (step === 'ground') {
        entry.groups.ground = createGround(cx, cz);
        scene.add(entry.groups.ground);
      } else if (step === 'trees') {
        entry.groups.trees = createTrees(scene, cx, cz);
      } else if (step === 'stream') {
        entry.stream = createStream(scene, cx, cz);
        entry.groups.stream = entry.stream.group;
      } else if (step === 'grass') {
        entry.grass = createGrass(scene, cx, cz, band, band === 0 ? null : entry.grass);
        entry.groups.grass = entry.grass.group;
        entry.grassBands = band + 1;
      } else if (step === 'foliage') {
        entry.groups.foliage = createFoliage(scene, cx, cz);
      }
    });
    // Materials are shared, but new geometry is geometry the shadow map and the
    // cel shader have never seen. Only the new group is handed over — walking the
    // whole scene per step means re-traversing everything already built, which
    // grows with the field while finding nothing new.
    onSceneChanged(entry.groups[step]);
  }

  // Drop one step's geometry, leaving the rest of the chunk alone.
  function dropStep(entry, step) {
    const g = entry.groups[step];
    if (!g) return;
    scene.remove(g);
    disposeGroup(g);
    entry.groups[step] = null;
    if (step === 'stream') entry.stream = null;
    if (step === 'grass') { entry.grass = null; entry.grassBands = 0; }
    // An entry with nothing left in it is just bookkeeping.
    if (STEPS.every((s) => !entry.groups[s])) live.delete(chunkKey(entry.cx, entry.cz));
  }

  // Decide what should exist, and in what order to build it. Called only when the
  // camera has moved enough to change the answer.
  //
  // Every (chunk, step) pair is judged on its own radius, so the far corners of the
  // field keep their ground and treeline while only the ground underfoot carries
  // grass. Dropping a step is immediate; building one is queued.
  function reprioritise() {
    const wanted = [];
    // The candidate window follows the camera, so what counts as "nearby" is
    // recomputed from where the player actually is rather than from the origin.
    for (const { cx, cz } of allChunks(camXZ.x, camXZ.y)) {
      const d = centreDist(cx, cz);
      const entry = live.get(chunkKey(cx, cz));
      for (const step of STEPS) {
        const reach = STEP_REACH[step];
        if (d <= LOAD_DIST * reach) {
          const have = step === 'grass' ? (entry ? entry.grassBands || 0 : 0) : (entry && entry.groups[step] ? 1 : 0);
          for (let band = have; band < bandsOf(step); band++) wanted.push({ cx, cz, step, band, d });
        } else if (d > UNLOAD_DIST * reach && entry && entry.groups[step]) {
          dropStep(entry, step);
        }
      }
    }
    // Anything resident but no longer in the window has to be dropped here.
    //
    // The loop above only visits candidates, and on an unbounded grid a chunk left
    // behind stops being a candidate entirely — so walking in a straight line would
    // accumulate every chunk ever built and leak until the tab died. On the old
    // fixed 3x3 this could not happen, because all nine were always visited.
    for (const entry of [...live.values()]) {
      if (Math.abs(entry.cx - Math.round(camXZ.x / CHUNK)) <= WINDOW
        && Math.abs(entry.cz - Math.round(camXZ.y / CHUNK)) <= WINDOW) continue;
      for (const step of STEPS) dropStep(entry, step);
    }
    // Nearest first, and within one chunk in STEPS order — so a chunk coming into
    // view gets its ground before its grass.
    const rank = (s) => STEPS.indexOf(s);
    queue = wanted.sort((a, b) => a.d - b.d || rank(a.step) - rank(b.step) || a.band - b.band);
  }

  camXZ.set(camera.position.x, camera.position.z);
  reprioritise();

  let lastCamKey = '';
  return {
    get pending() {
      return queue.length;
    },
    get loaded() {
      return [...live.values()].length;
    },
    // What is actually resident, per step — used to check the radii do what they say.
    get residency() {
      const out = {};
      for (const s of STEPS) out[s] = 0;
      for (const e of live.values()) for (const s of STEPS) if (e.groups[s]) out[s]++;
      return out;
    },
    update(dt) {
      camXZ.set(camera.position.x, camera.position.z);

      // Re-plan when the camera crosses into a different half-chunk cell, rather
      // than every frame: reprioritise walks the whole candidate window and
      // re-sorts, and the answer cannot change over a few metres.
      const ck = `${Math.round(camXZ.x / (CHUNK / 2))},${Math.round(camXZ.y / (CHUNK / 2))}`;
      if (ck !== lastCamKey) {
        lastCamKey = ck;
        reprioritise();
      }

      // Spend up to BUDGET_MS on building. `performance.now()` is checked between
      // steps, not inside them — a step is the atomic unit, and the largest one
      // (grass) does overrun the budget on its own. Splitting further would mean
      // teaching each module to build in slices, which buys smoothness the loading
      // order already provides.
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < BUDGET_MS) {
        const job = queue.shift();
        runStep(job.cx, job.cz, job.step, job.band || 0);
      }

      // Grass density follows the camera across every loaded chunk. The movement
      // early-out lives here now, so one distance check covers all of them.
      if (camXZ.distanceToSquared(lastGrassCam) > 2.25) {
        lastGrassCam.copy(camXZ);
        for (const e of live.values()) if (e.grass) e.grass.update(camXZ);
      }

      for (const e of live.values()) if (e.stream) e.stream.update(dt);
    },
  };
}
