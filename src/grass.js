import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, halfWidthAt, inWater } from './streamPath.js';
import { CHUNK, chunkCentre } from './grid.js';

// Dense instanced grass — the single biggest realism ingredient. Each instance
// is a small tuft of tapered blades; a brightness gradient is baked into the
// blade vertices (dark base -> light tip) and per-instance colors vary the
// hue between deep green and sunlit yellow-green. Normals are forced upward
// so the meadow shades like a continuous sunlit surface instead of a mass of
// dark random facets.
//
// The field is split into a grid of chunks, one InstancedMesh each:
//  - chunks outside the camera frustum are culled by three.js (a single
//    field-sized InstancedMesh always drew all 60k tufts)
//  - distant chunks thin out by truncating instanceCount — placement order
//    is random, so a lower count IS a uniform density reduction
// Geometry and material are shared by every chunk: one tuft geometry, one
// wind-patched material, so all nine chunks' grass runs through a single shader
// program. Built lazily on the first chunk rather than at module load, because
// buildTuftGeometry draws from Math.random and must run inside the caller's
// chunk-seeded generator to stay reproducible.
let shared = null;
function sharedGrass() {
  if (shared) return shared;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  applyWind(mat, { strength: 0.1, freq: 1.9, heightFactor: 0.8 });
  keepAuthoredNormals(mat);
  shared = { geo: buildTuftGeometry(), mat };
  return shared;
}

// One chunk's worth of grass. `update` still handles distance thinning, but it
// is now driven by the chunk manager across every loaded chunk's sub-chunks.
// How many frames one chunk's grass is spread over.
//
// 60k tufts costs ~270ms to place, and the manager's whole frame budget is 8ms.
// The budget is only checked BETWEEN steps, so grass as a single step overran it by
// 30x and was the last visible stall: after everything else was fixed, the only
// frames over 100ms left in a refresh were the grass steps.
//
// Each band places its own share of the tufts over a horizontal strip of the chunk
// and builds the meshes for that strip, so a band is a complete, drawable piece of
// grass rather than a partial one.
export const GRASS_BANDS = 4;

// `band` selects which strip to build (0..GRASS_BANDS-1) and `prev` is the handle
// from the previous band, which this one extends. Called with no band, it builds the
// whole chunk at once — the standalone path, still used by the tests.
export function createGrass(scene, cx = 0, cz = 0, band = null, prev = null) {
  const { geo, mat } = sharedGrass();

  // Same 60k tufts over the same 300x300 area as before, so density per square
  // metre is unchanged; the field is now one chunk rather than the whole world.
  const FIELD = CHUNK - 10; // small inset, matching the original 290-of-300
  const GRID = 8; // 8x8 sub-chunks, for frustum culling and distance thinning
  const CELL = FIELD / GRID;
  const origin = chunkCentre(cx, cz);
  // A band owns GRID/GRASS_BANDS rows of sub-chunks, and its share of the tufts.
  const ROWS = band === null ? GRID : GRID / GRASS_BANDS;
  const ROW0 = band === null ? 0 : band * ROWS;
  // Attempts, not tufts — see the loop below. 135k attempts over a whole chunk is
  // what the old quota-chasing loop actually spent to reach 60k tufts, so the
  // overall density is unchanged.
  const ATTEMPTS = Math.round(135000 * (ROWS / GRID));
  // Placements are rejected unless they fall in this band's strip, so the bands
  // together cover the chunk exactly once.
  const zLo = origin.z - FIELD / 2 + ROW0 * CELL;
  const zHi = zLo + ROWS * CELL;
  const group = prev ? prev.group : new THREE.Group();

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const deep = new THREE.Color('#48661f');
  const sunlit = new THREE.Color('#9cb149');

  // bucket the placements per chunk first, then build one mesh per chunk
  const buckets = Array.from({ length: GRID * GRID }, () => ({ mats: [], cols: [] }));
  // A fixed number of ATTEMPTS, keeping whatever passes — not a fixed number of
  // tufts.
  //
  // Chasing a quota made the cost depend on the local density: `keep` bottoms out
  // near 0.12 far from the water, so a strip out on the dry slopes rejected ~20x
  // per hit and took 247ms to fill the same 15k tufts a near-water strip filled in
  // 42ms. Worse, forcing the quota fought the density function it was sampling —
  // grass is meant to thin going up the slopes, and the quota pulled it back to flat.
  //
  // With attempts fixed, cost is bounded everywhere and density follows `keep` the
  // way it was written to.
  let placed = 0;
  let attempts = 0;
  while (attempts < ATTEMPTS) {
    attempts++;
    const x = origin.x + (Math.random() - 0.5) * FIELD;
    // Draw z across the band only. Sampling the whole chunk and rejecting outside
    // the strip would work too, but it would throw away (GRASS_BANDS-1)/GRASS_BANDS
    // of every draw and put the cost straight back.
    const z = zLo + Math.random() * (zHi - zLo);
    const { d: sd, t } = streamAt(x, z);

    // dense near the stream corridor, thinning up the slopes — but with a
    // sparse band along the waterline itself, so the bank plants (flower
    // bushes, sedge, spikes) read instead of a wall of tall grass
    const bankD = sd - halfWidthAt(t);
    const bankK = 0.38 + 0.62 * THREE.MathUtils.smoothstep(bankD, 1.5, 9);
    const keep = THREE.MathUtils.clamp(1.55 - sd / 62, 0.12, 1) * bankK;
    if (Math.random() > keep) continue;
    const h = terrainHeight(x, z);
    if (h < levelAt(t) + 0.25) continue; // not in the water — grass runs right up to the edge
    if (inWater(x, z, 0.1)) continue;

    // shorter tufts near the water's edge; tight scale range keeps the lawn
    // even, like it's been trimmed
    const s = (0.6 + Math.random() * 0.2) * (0.8 + 0.2 * THREE.MathUtils.smoothstep(bankD, 0, 8));
    dummy.position.set(x, h - 0.05, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.9 + Math.random() * 0.2), s);
    dummy.updateMatrix();

    // sunnier (yellower) tufts on open slopes, deeper green near the water
    const sunK = THREE.MathUtils.clamp(sd / 45, 0, 1) * 0.5 + Math.random() * 0.5;
    col.copy(deep).lerp(sunlit, sunK);
    col.offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.06);

    const gx = Math.min(GRID - 1, Math.max(0, Math.floor((x - origin.x + FIELD / 2) / CELL)));
    const gz = Math.min(GRID - 1, Math.max(0, Math.floor((z - origin.z + FIELD / 2) / CELL)));
    const bucket = buckets[gz * GRID + gx];
    bucket.mats.push(dummy.matrix.clone());
    bucket.cols.push(col.clone());
    placed++;
  }

  // Cells accumulate across bands, so the density update sees the whole chunk.
  const cells = prev ? prev.cells : [];
  buckets.forEach((bucket, bi) => {
    const n = bucket.mats.length;
    if (n === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.receiveShadow = true;
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, bucket.mats[i]);
      mesh.setColorAt(i, bucket.cols[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // instance-aware bounds -> real frustum culling
    group.add(mesh);

    const ccx = origin.x + (bi % GRID + 0.5) * CELL - FIELD / 2;
    const ccz = origin.z + (Math.floor(bi / GRID) + 0.5) * CELL - FIELD / 2;
    cells.push({ mesh, full: n, centre: new THREE.Vector2(ccx, ccz) });
  });

  if (!prev) scene.add(group);

  // distance-based density: full within 60m of the camera, fading to 15%
  // far out where a tuft is subpixel anyway. The manager calls this for every
  // loaded chunk; the early-out on camera movement now lives there, so one
  // check covers all of them instead of nine.
  return {
    group,
    cells,
    update(camXZ) {
      for (const c of cells) {
        const dist = c.centre.distanceTo(camXZ);
        const f = THREE.MathUtils.clamp(1 - (dist - 60) / 130, 0.15, 1);
        c.mesh.count = Math.ceil(c.full * f);
      }
    },
  };
}

// One tuft = 6 tapered two-segment blades leaning outward.
function buildTuftGeometry() {
  const blades = [];
  const BLADES = 6;
  for (let i = 0; i < BLADES; i++) {
    const ang = (i / BLADES) * Math.PI * 2 + Math.random() * 0.9;
    const lean = 0.1 + Math.random() * 0.16;
    const height = 0.38 + Math.random() * 0.18;
    blades.push(buildBlade(ang, lean, height, Math.random() * 0.22));
  }
  const geo = mergeGeometries(blades, false);

  // upward normals -> soft continuous meadow shading
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

function buildBlade(ang, lean, height, baseOff) {
  const wBase = 0.09, wMid = 0.055;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const px = -dz, pz = dx; // perpendicular for blade width

  const ox = dx * baseOff, oz = dz * baseOff;
  const bend1 = lean * height * 0.45;
  const bend2 = lean * height;

  const p = [
    // base pair
    ox - px * wBase, 0, oz - pz * wBase,
    ox + px * wBase, 0, oz + pz * wBase,
    // mid pair
    ox + dx * bend1 - px * wMid, height * 0.55, oz + dz * bend1 - pz * wMid,
    ox + dx * bend1 + px * wMid, height * 0.55, oz + dz * bend1 + pz * wMid,
    // tip
    ox + dx * bend2, height, oz + dz * bend2,
  ];
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4];

  // brightness gradient baked per vertex: dark roots, light tips
  const shade = [0.42, 0.42, 0.78, 0.78, 1.0];
  const cols = [];
  for (const s of shade) cols.push(s, s, s);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0), 3));
  g.setIndex(idx);
  return g;
}
