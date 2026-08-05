import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { bucketFor, addChunkedInstances } from './chunks.js';
import { terrainHeight } from './terrain.js';
import { streamCurve, streamAt, levelAt, halfWidthAt, inWater } from './streamPath.js';
import {
  makeFlowerSpikeTexture, makeMeadowFlowerTexture,
  makeFlowerBushTexture, makeSedgeTexture, makeLeafFillTexture,
} from './textures.js';
import { makeBlobGeo } from './trees.js';
import { CHUNK, chunkCentre } from './grid.js';

// Every canvas texture and card geometry the understory uses, drawn ONCE and
// shared by all chunks.
//
// These were being rebuilt inside createFoliage, so each chunk redrew eight
// procedural canvases and re-merged their card geometry from scratch — 10.5
// seconds of synchronous work per chunk, measured. It was by far the most
// expensive step in the scene, and every millisecond of it was spent recomputing
// pixel-identical results, because none of it depends on which chunk is being
// built. trees.js already shares its bark and canopy sheets exactly this way.
let sharedFoliage = null;
function foliageAssets() {
  if (sharedFoliage) return sharedFoliage;
  sharedFoliage = {
    // bank garden: three flower-bush colourways plus waterline sedge
    bankSpecies: [
      { tex: makeFlowerBushTexture('#d13d9e'), geo: bushCards(), s: [0.4, 0.75], bush: true },
      { tex: makeFlowerBushTexture('#8a5ad2'), geo: bushCards(), s: [0.38, 0.7], bush: true },
      { tex: makeFlowerBushTexture('#e0669c'), geo: bushCards(), s: [0.35, 0.65], bush: true },
      { tex: makeSedgeTexture(), geo: crossCards(2.0, 1.6), s: [0.8, 1.6], bush: false },
    ],
    spikeTex: [
      makeFlowerSpikeTexture('#7a4fae', '#cf95e0'), // purple
      makeFlowerSpikeTexture('#b45a92', '#f0b6d4'), // pink
    ],
    spikeGeo: crossCards(1.0, 2.2),
    meadowTex: makeMeadowFlowerTexture(),
    meadowGeo: crossCards(0.9, 0.9, 0.45),
    leafTex: makeLeafFillTexture(['#6d8a33', '#93ad45', '#b7c95e']),
    scatterFlowerTex: makeMeadowFlowerTexture(),
    scatterFlowerGeo: crossCards(0.55, 0.55),
  };
  // Mark every shared geometry so a chunk unloading cannot dispose it out from
  // under the chunks still drawing it. See disposeGroup in grid.js.
  for (const g of [
    sharedFoliage.spikeGeo, sharedFoliage.meadowGeo, sharedFoliage.scatterFlowerGeo,
    ...sharedFoliage.bankSpecies.map((s) => s.geo),
  ]) g.userData.shared = true;
  return sharedFoliage;
}

// Undergrowth accents: lupine-like flower spikes clustered on the banks,
// small yellow/white meadow flowers sprinkled through the grass, and leafy
// card bushes filling the gaps between trunks.
// One chunk's understory, returned as a Group the manager can dispose.
// Everything is placed in world space inside this chunk's bounds; the bank
// plants follow the stream wherever it passes through the chunk, so a chunk the
// brook misses simply gets no bank garden.
export function createFoliage(scene, cx = 0, cz = 0) {
  const A = foliageAssets();
  const dummy = new THREE.Object3D();
  const group = new THREE.Group();
  const origin = chunkCentre(cx, cz);
  const FIELD = CHUNK - 10;
  // Bank plants are placed by walking the stream curve, which now spans all nine
  // chunks — so a chunk must only keep the ones that land inside its own bounds,
  // or every chunk would grow the whole valley's bank garden.
  const mine = (x, z) => Math.abs(x - origin.x) <= FIELD / 2 && Math.abs(z - origin.z) <= FIELD / 2;

  // Walk outward from the channel until we hit dry land — the terrain is
  // carved below the waterline near the stream, so the true shoreline can't
  // be derived from halfWidthAt alone.
  function bankPoint(t, side, extra = 0) {
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    const hw = halfWidthAt(t);
    const lvl = levelAt(t);
    for (let off = hw; off < hw + 9; off += 0.4) {
      const x = p.x + (bx / bl) * off * side;
      const z = p.z + (bz / bl) * off * side;
      if (terrainHeight(x, z) > lvl + 0.12) {
        const o = off + extra;
        return { x: p.x + (bx / bl) * o * side, z: p.z + (bz / bl) * o * side };
      }
    }
    return null;
  }

  // --- bank garden: patches of flower bushes and sedge along the waterline,
  // clustered by species so the banks read as arranged drifts, not confetti ---
  {
    const species = A.bankSpecies;
    const placements = species.map(() => []);

    // The curve spans all nine chunks now, so sampling t uniformly over 0..1
    // would scatter 8/9 of the clusters into other chunks and leave this one
    // nearly bare. Walking the whole curve and keeping only the hits inside this
    // chunk gives each chunk the same bank density the single-chunk scene had.
    const CLUSTERS = 64 * 9;
    for (let c = 0; c < CLUSTERS; c++) {
      const t = Math.random();
      const side = Math.random() < 0.5 ? 1 : -1;
      // sedge hugs the waterline; flower bushes sit a step up the bank
      const si = Math.random() < 0.45 ? 3 : (Math.random() * 3) | 0;
      const centre = bankPoint(t, side, si === 3 ? Math.random() * 0.8 : 0.6 + Math.random() * 2.2);
      if (!centre) continue;
      if (!mine(centre.x, centre.z)) continue;
      const n = 2 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const x = centre.x + (Math.random() - 0.5) * 3.2;
        const z = centre.z + (Math.random() - 0.5) * 3.2;
        const h = terrainHeight(x, z);
        if (h < levelAt(streamAt(x, z).t) + 0.1) continue;
        if (inWater(x, z, 0.1)) continue;
        placements[si].push({ x, z, h });
      }
    }

    species.forEach((sp, si) => {
      const list = placements[si];
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({
        map: sp.tex,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.95,
      });
      applyWind(mat, { strength: sp.bush ? 0.1 : 0.22, freq: 1.8, heightFactor: 0.4 });
      keepAuthoredNormals(mat);
      const mesh = new THREE.InstancedMesh(sp.geo, mat, list.length);
      mesh.receiveShadow = true;
      if (sp.bush) {
        mesh.castShadow = true;
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: sp.tex,
          alphaTest: 0.5,
        });
      }
      list.forEach((f, i) => {
        const s = sp.s[0] + Math.random() * (sp.s[1] - sp.s[0]);
        dummy.position.set(f.x, f.h - (sp.bush ? 0.15 : 0.05), f.z);
        dummy.rotation.set((Math.random() - 0.5) * 0.16, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.16);
        dummy.scale.set(s, s * (0.85 + Math.random() * 0.3), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    });
  }

  // --- lupine spikes (crossed alpha cards) clustered along both banks ---
  for (const tex of A.spikeTex) {
    const geo = A.spikeGeo;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    applyWind(mat, { strength: 0.25, freq: 2.1, heightFactor: 0.5 });
    keepAuthoredNormals(mat);

    const positions = [];
    // Seed cluster spots on the banks, then sprinkle spikes around each. Same
    // whole-curve walk as the bank garden above, keeping only what lands in this
    // chunk — and 9x the seed attempts to compensate.
    for (let c = 0; c < 20 * 9 && positions.length < 320; c++) {
      const t = Math.random();
      const p = streamCurve.getPointAt(t);
      const tan = streamCurve.getTangentAt(t);
      const bx = -tan.z, bz = tan.x;
      const bl = Math.hypot(bx, bz) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = halfWidthAt(t) + 2 + Math.random() * 6.5;
      // deliberately not named cx/cz — those are the chunk coordinates
      const sx = p.x + (bx / bl) * off * side;
      const sz = p.z + (bz / bl) * off * side;
      if (!mine(sx, sz)) continue;
      const n = 6 + ((Math.random() * 10) | 0);
      for (let k = 0; k < n && positions.length < 320; k++) {
        const x = sx + (Math.random() - 0.5) * 7;
        const z = sz + (Math.random() - 0.5) * 7;
        const h = terrainHeight(x, z);
        if (h < levelAt(streamAt(x, z).t) + 0.4) continue;
        if (inWater(x, z, 0.3)) continue;
        positions.push({ x, z, h });
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    mesh.receiveShadow = true;
    for (let i = 0; i < positions.length; i++) {
      const f = positions[i];
      const s = 0.7 + Math.random() * 0.65;
      dummy.position.set(f.x, f.h - 0.1, f.z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // --- small meadow flowers scattered through the grass ---
  {
    const tex = A.meadowTex;
    const geo = A.meadowGeo;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    applyWind(mat, { strength: 0.2, freq: 2.0, heightFactor: 0.6 });
    keepAuthoredNormals(mat);
    const COUNT = 1400;
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.receiveShadow = true;
    let placed = 0, attempts = 0;
    while (placed < COUNT && attempts < COUNT * 12) {
      attempts++;
      const x = origin.x + (Math.random() - 0.5) * (FIELD - 50);
      const z = origin.z + (Math.random() - 0.5) * (FIELD - 50);
      const { d: sd, t } = streamAt(x, z);
      if (Math.random() > THREE.MathUtils.clamp(1.5 - sd / 55, 0.05, 1)) continue;
      const h = terrainHeight(x, z);
      if (h < levelAt(t) + 0.35) continue;
      if (inWater(x, z, 0.3)) continue;
      dummy.position.set(x, h + 0.15, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.setScalar(0.7 + Math.random() * 0.8);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // --- fluffy grass-ball bushes between the trunks, built the same way as
  // the broadleaf tree crowns: noise-displaced blobs wrapped in a leaf-disc
  // texture, several per bush, with meadow flowers poking out of the top ---
  {
    const COUNT = 140;
    const spots = [];
    let attempts = 0;
    while (spots.length < COUNT && attempts < COUNT * 30) {
      attempts++;
      const x = origin.x + (Math.random() - 0.5) * (FIELD - 20);
      const z = origin.z + (Math.random() - 0.5) * (FIELD - 20);
      const { d: sd, t } = streamAt(x, z);
      if (sd > 90) continue;
      const h = terrainHeight(x, z);
      if (h < levelAt(t) + 0.4) continue;
      if (inWater(x, z, 0.8)) continue;
      spots.push({ x, z, h, s: 0.6 + Math.random() * 0.9 });
    }

    // leaf blobs — fresh yellow-greens so the clump reads as lush grass
    const leafTex = A.leafTex;
    const blobMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.28,
      side: THREE.DoubleSide,
      roughness: 0.95,
    });
    applyWind(blobMat, { strength: 0.08, freq: 1.5, heightFactor: 0.3 });
    keepAuthoredNormals(blobMat);
    const BLOBS = 5;
    const blobGeo = makeBlobGeo();
    const blobDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: leafTex,
      alphaTest: 0.4,
    });
    const col = new THREE.Color();
    // 700 blobs at 180 triangles each is the heaviest thing in the understory,
    // and as one field-wide mesh it could never be frustum culled — every blob
    // behind the camera was still submitted and still ran the wind shader.
    const blobBuckets = new Map();
    for (const f of spots) {
      const bucket = bucketFor(blobBuckets, f.x, f.z);
      for (let i = 0; i < BLOBS; i++) {
        // one blob in the middle, the rest ringed around it, all hugging
        // the ground so the cluster reads as a mound, not a floating crown
        const a = (i / BLOBS) * Math.PI * 2 + Math.random();
        const r = (i === 0 ? 0 : 0.55 + Math.random() * 0.35) * f.s;
        dummy.position.set(
          f.x + Math.cos(a) * r,
          f.h + (0.26 + Math.random() * 0.16) * f.s,
          f.z + Math.sin(a) * r
        );
        dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5);
        const k = (0.9 + Math.random() * 0.5) * f.s;
        dummy.scale.set(k, k * 0.6, k);
        dummy.updateMatrix();
        bucket.mats.push(dummy.matrix.clone());
        col.setHSL(0.2 + Math.random() * 0.05, 0.42 + Math.random() * 0.14, 0.5 + Math.random() * 0.16);
        bucket.cols.push(col.clone());
      }
    }
    addChunkedInstances(group, blobBuckets, blobGeo, blobMat, {
      castShadow: true,
      receiveShadow: true,
      depthMat: blobDepthMat,
    });

    // meadow flowers nestled into the top of each clump
    const flowerMat = new THREE.MeshStandardMaterial({
      map: A.scatterFlowerTex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    applyWind(flowerMat, { strength: 0.15, freq: 2.0, heightFactor: 0.6 });
    keepAuthoredNormals(flowerMat);
    const FLOWERS = 4;
    const flowers = new THREE.InstancedMesh(A.scatterFlowerGeo, flowerMat, spots.length * FLOWERS);
    flowers.receiveShadow = true;
    let fi = 0;
    for (const f of spots) {
      for (let i = 0; i < FLOWERS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.5 * f.s;
        dummy.position.set(
          f.x + Math.cos(a) * r,
          f.h + (0.45 + Math.random() * 0.2) * f.s,
          f.z + Math.sin(a) * r
        );
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.setScalar((0.55 + Math.random() * 0.4) * f.s);
        dummy.updateMatrix();
        flowers.setMatrixAt(fi, dummy.matrix);
        fi++;
      }
    }
    flowers.instanceMatrix.needsUpdate = true;
    group.add(flowers);
  }

  scene.add(group);
  return group;
}

// Two (or three) intersecting vertical quads, pivot at the bottom.
function crossCards(w, h, extra = 0) {
  const parts = [];
  const n = extra > 0 ? 2 : 2;
  for (let i = 0; i < n; i++) {
    const card = new THREE.PlaneGeometry(w, h);
    card.translate(0, h / 2, 0);
    card.rotateY((i / n) * Math.PI);
    parts.push(card);
  }
  const g = mergeGeometries(parts, false);
  const nrm = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let k = 0; k < nrm.count; k++) {
    v.set(nrm.getX(k), 0.8, nrm.getZ(k)).normalize();
    nrm.setXYZ(k, v.x, v.y, v.z);
  }
  return g;
}

// A little dome of leaf cards for the understory bushes.
function bushCards() {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const s = 1.6 + Math.random() * 1.2;
    const card = new THREE.PlaneGeometry(s, s);
    // shallow tilts so the cards read as layered leaf planes, not loose sheets
    card.rotateX(-Math.PI / 2 + (Math.random() - 0.5) * 1.1);
    card.rotateY(Math.random() * Math.PI);
    card.rotateZ((Math.random() - 0.5) * 0.5);
    const px = (Math.random() - 0.5) * 2.2;
    const py = 0.5 + Math.random() * 1.3;
    const pz = (Math.random() - 0.5) * 2.2;
    card.translate(px, py, pz);
    const out = new THREE.Vector3(px, py + 0.6, pz).normalize();
    const n = card.attributes.normal;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, out.x, out.y, out.z);
    parts.push(card);
  }
  return mergeGeometries(parts, false);
}
