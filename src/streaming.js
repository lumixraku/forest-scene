import * as THREE from 'three';
import { cellSeed, withSeed } from './rng.js';

// Cell-based streaming: the world is an unbounded grid, and only the cells near
// the camera hold built geometry.
//
// The scene used to generate everything at startup over a fixed 300m field. That
// does not scale: cost grows with area, and at any instant the camera can only see
// a small part of it. Here each layer declares how far out it wants to exist, and
// the scheduler builds and drops cells as the camera moves.
//
// Two properties make this safe to walk around in:
//
//  - Determinism. A cell's content is derived from its coordinates via `withSeed`,
//    never from the order cells happen to be built. Walk away and come back and
//    the same trees are in the same places, which a shared global RNG could not
//    promise once build order depends on the player's path.
//
//  - A frame budget. Building a cell costs milliseconds, so the queue is drained a
//    few cells per frame rather than all at once. Cold start fills the near field
//    first and the distance settles in over the next second, instead of hanging on
//    a single enormous frame.
export const CELL = 100;

// Per-frame build budget. The frame also has to render, and 16.7ms is the whole
// budget at 60fps; 6ms of building leaves room for that while still filling the
// view quickly. Overrunning is preferred to splitting a single cell, so one cell
// that costs more than the budget still completes rather than tearing.
const FRAME_BUDGET_MS = 6;

// The camera must move this far before the loaded set is recomputed. Half a cell
// is small enough that the set is never stale by more than one ring, and large
// enough that standing still costs nothing.
const RESCAN_DIST = CELL * 0.5;

export const cellIndex = (v, size = CELL) => Math.floor(v / size);
export const cellCentre = (i, size = CELL) => (i + 0.5) * size;

export function createStreaming() {
  const layers = [];

  // A layer is anything that fills cells with geometry: ground tiles, grass,
  // trees. `radius` is how far from the camera it exists, `build` returns the
  // objects for one cell, and `dispose` releases whatever `build` allocated.
  //
  // `lod(dist)` is optional. When present, its return value is passed to build()
  // and remembered; if the camera moves far enough that a loaded cell's level
  // changes, the cell is rebuilt at the new one. Detail has to be keyed off the
  // distance to the CAMERA — keying it off the cell's own coordinates would make
  // the world permanently coarser the further you travel from the origin.
  // `size` lets a layer use a coarser grid than the default. The far tree tier
  // reaches the horizon, and at 100m that is ~150 cells each holding several
  // InstancedMeshes — hundreds of draw calls for trees that are a few pixels tall.
  // A bigger cell trades culling precision for far fewer meshes, which is the right
  // trade once the contents are too small to cull usefully.
  function register({ id, radius, build, dispose, lod = null, size = CELL }) {
    layers.push({
      id,
      radius,
      build,
      dispose,
      lod,
      size,
      // cellKey -> { built, lod }
      loaded: new Map(),
      // number of cells this layer reaches in each direction
      reach: Math.ceil(radius / size),
    });
    return layers.length - 1;
  }

  const queue = [];
  const queued = new Set();
  const lastScan = new THREE.Vector2(Infinity, Infinity);
  const scanAt = new THREE.Vector2();
  let onLoad = null;

  function rescan(camX, camZ) {
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const size = layer.size;
      const ci = cellIndex(camX, size);
      const cj = cellIndex(camZ, size);
      const r = layer.reach;
      const r2 = layer.radius * layer.radius;

      // drop cells that have fallen outside the radius (with a cell of
      // hysteresis, so a camera loitering on a boundary does not thrash)
      const dropAt = (layer.radius + size) * (layer.radius + size);
      for (const [key, entry] of layer.loaded) {
        const [i, j] = key.split(',');
        const dx = cellCentre(+i, size) - camX;
        const dz = cellCentre(+j, size) - camZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > dropAt) {
          layer.dispose(entry.built);
          layer.loaded.delete(key);
        } else if (layer.lod && layer.lod(Math.sqrt(d2)) !== entry.lod) {
          // The camera has come close enough (or gone far enough) that this cell
          // belongs at a different detail level. Queue a REPLACEMENT and leave the
          // current one in the scene until it is ready.
          //
          // Disposing here instead is what made the ground flicker: the rebuild
          // goes on the same budgeted queue as everything else, so the tile was
          // genuinely absent for as long as the queue took to reach it — measured
          // at up to 8 frames, which is exactly the tile that vanishes and comes
          // back. A detail change is not a reason to show a hole.
          const qk = `${li}:${key}`;
          if (!queued.has(qk)) {
            queued.add(qk);
            queue.push({ li, i: +i, j: +j, key, qk, d2, replace: true });
          }
        }
      }

      // queue cells that are inside it and not yet built
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          const dx = cellCentre(i, size) - camX;
          const dz = cellCentre(j, size) - camZ;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const key = `${i},${j}`;
          if (layer.loaded.has(key)) continue;
          const qk = `${li}:${key}`;
          if (queued.has(qk)) continue;
          queued.add(qk);
          queue.push({ li, i, j, key, qk, d2 });
        }
      }
    }

    // nearest first, so the view fills from the middle outward
    queue.sort((a, b) => a.d2 - b.d2);
  }

  return {
    register,

    // Cells still waiting to be built. The capture harness waits on this to know
    // the world has finished settling before it measures anything.
    pending: () => queue.length,

    // Called when a cell finishes building — the shadow map needs to know that
    // the set of shadow casters changed.
    onCellLoaded(fn) { onLoad = fn; },

    update(camera) {
      const camX = camera.position.x;
      const camZ = camera.position.z;

      // scratch vector, not a fresh one per frame — this runs every frame forever
      scanAt.set(camX, camZ);
      if (scanAt.distanceToSquared(lastScan) > RESCAN_DIST * RESCAN_DIST) {
        lastScan.copy(scanAt);
        rescan(camX, camZ);
      }

      let built = 0;
      const start = performance.now();
      while (queue.length && performance.now() - start < FRAME_BUDGET_MS) {
        const job = queue.shift();
        queued.delete(job.qk);
        const layer = layers[job.li];
        const existing = layer.loaded.get(job.key);
        // Already built, and not a detail-level replacement: nothing to do.
        if (existing && !job.replace) continue;
        // A replacement whose cell has since been dropped for leaving the radius
        // has nothing to replace, and building it would resurrect a cell the
        // camera has already left.
        if (!existing && job.replace) continue;

        const size = layer.size;
        const dx = cellCentre(job.i, size) - camX;
        const dz = cellCentre(job.j, size) - camZ;
        const lod = layer.lod ? layer.lod(Math.hypot(dx, dz)) : null;
        // The camera may have wandered back before this replacement came up, in
        // which case the level it wanted is the level it already has.
        if (existing && lod === existing.lod) continue;

        // Seeded by cell coordinates and layer, so this cell's content depends on
        // where it is and nothing else.
        const result = withSeed(cellSeed(job.i, job.j, job.li), () => layer.build({
          i: job.i,
          j: job.j,
          x0: job.i * size,
          z0: job.j * size,
          cx: cellCentre(job.i, size),
          cz: cellCentre(job.j, size),
          size,
          lod,
        }));
        // Swap only now that the replacement exists, so the cell is never empty.
        if (existing) layer.dispose(existing.built);
        layer.loaded.set(job.key, { built: result, lod });
        built++;
      }
      if (built && onLoad) onLoad();
    },

    // Diagnostics for the capture harness.
    stats() {
      return layers.map((l) => ({ id: l.id, cells: l.loaded.size }));
    },

    // Which cells of one layer currently hold geometry. The flicker harness
    // samples this every frame: a cell that leaves this set while still well
    // inside the layer's radius is a tile the viewer watches disappear.
    loadedKeys(id) {
      const layer = layers.find((l) => l.id === id);
      return layer ? [...layer.loaded.keys()] : [];
    },
  };
}
