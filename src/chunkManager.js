import * as THREE from 'three';
import {
  CHUNK, CHUNK_REACH, allChunks, chunkKey, chunkCentre, withChunkRng, disposeGroup,
} from './grid.js';
import { createGround } from './ground.js';
import { createGrass } from './grass.js';
import { createTrees } from './trees.js';
import { createFoliage } from './foliage.js';
import { createStream } from './stream.js';

// Streams the 3x3 field in and out around the camera, one chunk at a time.
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
const LOAD_DIST = CHUNK * 1.35;
const UNLOAD_DIST = CHUNK * 1.85;

export function createChunkManager(scene, camera, onSceneChanged) {
  // key -> { cx, cz, groups: {}, stream, grass, step, done }
  const live = new Map();
  const camXZ = new THREE.Vector2();
  const lastGrassCam = new THREE.Vector2(Infinity, Infinity);
  let queue = [];

  const centreDist = (cx, cz) => {
    const c = chunkCentre(cx, cz);
    return Math.max(0, Math.hypot(c.x - camXZ.x, c.z - camXZ.y) - CHUNK_REACH);
  };

  // Build one step of one chunk. Each step is wrapped in its own chunk-seeded
  // generator, salted per subsystem, so a chunk's contents depend only on its
  // coordinates — not on which chunk was built before it, or how many times this
  // one has been loaded. That is the property that makes unload/reload safe.
  function runStep(entry) {
    const { cx, cz } = entry;
    const step = STEPS[entry.step];
    withChunkRng(cx, cz, step, () => {
      if (step === 'ground') {
        entry.groups.ground = createGround(cx, cz);
        scene.add(entry.groups.ground);
      } else if (step === 'trees') {
        entry.groups.trees = createTrees(scene, cx, cz);
      } else if (step === 'stream') {
        entry.stream = createStream(scene, cx, cz);
        entry.groups.stream = entry.stream.group;
      } else if (step === 'grass') {
        entry.grass = createGrass(scene, cx, cz);
        entry.groups.grass = entry.grass.group;
      } else if (step === 'foliage') {
        entry.groups.foliage = createFoliage(scene, cx, cz);
      }
    });
    entry.step++;
    if (entry.step >= STEPS.length) entry.done = true;
    // Materials are shared, but a brand-new chunk brings geometry the shadow map
    // and the cel shader have never seen.
    onSceneChanged(entry);
  }

  function unload(key) {
    const entry = live.get(key);
    if (!entry) return;
    for (const g of Object.values(entry.groups)) {
      if (!g) continue;
      scene.remove(g);
      disposeGroup(g);
    }
    live.delete(key);
  }

  // Decide what should exist, and in what order to build it. Called only when the
  // camera has moved enough to change the answer.
  function reprioritise() {
    for (const { cx, cz } of allChunks()) {
      const key = chunkKey(cx, cz);
      const d = centreDist(cx, cz);
      if (d <= LOAD_DIST && !live.has(key)) {
        live.set(key, { cx, cz, groups: {}, stream: null, grass: null, step: 0, done: false });
      } else if (d > UNLOAD_DIST && live.has(key)) {
        unload(key);
      }
    }
    // Nearest unfinished chunk first, so walking toward a chunk pulls it in ahead
    // of whatever was already queued further away.
    queue = [...live.values()]
      .filter((e) => !e.done)
      .sort((a, b) => centreDist(a.cx, a.cz) - centreDist(b.cx, b.cz));
  }

  camXZ.set(camera.position.x, camera.position.z);
  reprioritise();

  let lastCamKey = '';
  return {
    get pending() {
      return queue.length;
    },
    get loaded() {
      return [...live.values()].filter((e) => e.done).length;
    },
    update(dt) {
      camXZ.set(camera.position.x, camera.position.z);

      // Re-plan when the camera crosses into a different half-chunk cell, rather
      // than every frame: reprioritise walks all nine chunks and re-sorts, and the
      // answer cannot change over a few metres.
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
        const entry = queue[0];
        runStep(entry);
        if (entry.done) queue.shift();
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
