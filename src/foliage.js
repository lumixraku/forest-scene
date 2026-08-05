import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { cellSeed, withSeed } from './rng.js';
import { terrainHeight } from './terrain.js';
import {
  streamCurve, streamAt, levelAt, halfWidthAt, inWater,
  STREAM_LENGTH, tOfArc,
} from './streamPath.js';
import {
  makeFlowerSpikeTexture, makeMeadowFlowerTexture,
  makeFlowerBushTexture, makeSedgeTexture, makeLeafFillTexture,
} from './textures.js';
import { makeBlobGeo } from './trees.js';

// Undergrowth accents: lupine-like flower spikes clustered on the banks,
// small yellow/white meadow flowers sprinkled through the grass, and leafy
// card bushes filling the gaps between trunks.
//
// Streamed per cell. Two of the four sections are scattered by AREA (meadow
// flowers, grass-ball bushes) and two along the STREAM CURVE (bank garden,
// lupine spikes), and the curve-authored pair is the awkward one: sampling
// `t = Math.random()` per cell would sprinkle every cell's share over the whole
// curve, so a cell would grow flowers hundreds of units away and the banks near
// the camera would get every cell's contribution at once.
//
// So the CURVE IS PARTITIONED between cells: a cell owns the stretches of curve
// whose points lie inside its own bounds, and clusters are seeded only there. Each
// stretch belongs to exactly one cell, so the clusters-per-unit-length rate is
// reproduced exactly however the grid is drawn.
//
// The tempting alternative — let every cell consider curve within reach of it and
// keep only the members landing inside itself — over-seeds. One stretch of curve
// falls within reach of many cells, each seeds it at the full rate, and filtering
// the members afterwards does not undo that. Measured against the same stretch of
// curve it gave 3.5x the lupine spikes; the bank garden happened to escape (its
// members scatter only +-1.6, so the ownership filter nearly cancels the
// over-seeding), which is exactly the kind of accident not to build on.
//
// A cluster's members scatter a few units from its centre, so a cell's bank
// foliage can spill slightly into its neighbours. That is harmless — it is how the
// drifts looked when they were authored as whole-curve clusters — and it is what
// keeps the count right.
//
// Rates below are clusters per unit of arc length / attempts per square metre,
// measured against the original curve and field rather than derived from the old
// nominal counts, since every one of those loops was rejection-sampled.
const RATE = {
  // 64 clusters over the original 326.409 units of curve
  gardenClusters: 0.19607,
  // 20 cluster spots per spike variant over the same
  spikeClusters: 0.06127,
  // 1400 flowers over 240x240 at a 41% accept rate
  flowerAttempts: 0.05935,
  // 140 bushes over 270x270
  bushAttempts: 0.00301,
};

export function createFoliage(scene) {
  const dummy = new THREE.Object3D();

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

  // The stretches of curve INSIDE this cell, as [u0, u1] arc-length ranges.
  // Walked at a fine stride rather than solved: the curve meanders and can enter
  // and leave one cell several times, so a single range around the nearest point
  // would miss the other limbs and lose their foliage entirely.
  //
  // The ranges of all cells tile the curve exactly once, which is the property the
  // density depends on.
  function arcSpans(cell) {
    const half = cell.size / 2;
    const spans = [];
    // Fine relative to a cell, so a brief excursion through a corner is not
    // stepped over. 2 units against a 100-unit cell costs ~500 curve evaluations
    // per cell, which is minor next to the terrain sampling each cluster does.
    const STRIDE = 2;
    let open = null;
    for (let u = 0; u <= STREAM_LENGTH; u += STRIDE) {
      const p = streamCurve.getPointAt(tOfArc(u));
      const inside = p.x >= cell.cx - half && p.x < cell.cx + half
                  && p.z >= cell.cz - half && p.z < cell.cz + half;
      if (inside && open === null) open = u;
      else if (!inside && open !== null) { spans.push([open, u]); open = null; }
    }
    if (open !== null) spans.push([open, STREAM_LENGTH]);
    return spans;
  }

  // Draw `rate` clusters per unit length over the cell's stretches of curve,
  // carrying the fractional remainder as a probability so short stretches are not
  // rounded away — most cells hold only a few tens of units of curve, and flooring
  // each one would lose most of the bank foliage.
  function overSpans(cell, rate, fn) {
    for (const [u0, u1] of arcSpans(cell)) {
      const want = (u1 - u0) * rate;
      const n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) fn(tOfArc(u0 + Math.random() * (u1 - u0)));
    }
  }

  // --- bank garden: patches of flower bushes and sedge along the waterline,
  // clustered by species so the banks read as arranged drifts, not confetti ---
  const garden = (() => {
    const species = [
      { tex: makeFlowerBushTexture('#d13d9e'), geo: bushCards(), s: [0.4, 0.75], bush: true },
      { tex: makeFlowerBushTexture('#8a5ad2'), geo: bushCards(), s: [0.38, 0.7], bush: true },
      { tex: makeFlowerBushTexture('#e0669c'), geo: bushCards(), s: [0.35, 0.65], bush: true },
      { tex: makeSedgeTexture(), geo: crossCards(2.0, 1.6), s: [0.8, 1.6], bush: false },
    ];
    // Materials and depth materials are shared across every cell.
    for (const sp of species) {
      sp.mat = new THREE.MeshStandardMaterial({
        map: sp.tex,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.95,
      });
      applyWind(sp.mat, { strength: sp.bush ? 0.1 : 0.22, freq: 1.8, heightFactor: 0.4 });
      keepAuthoredNormals(sp.mat);
      if (sp.bush) {
        sp.depthMat = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: sp.tex,
          alphaTest: 0.5,
        });
      }
    }

    function build(cell, out) {
      const placements = species.map(() => []);
      overSpans(cell, RATE.gardenClusters, (t) => {
        const side = Math.random() < 0.5 ? 1 : -1;
        // sedge hugs the waterline; flower bushes sit a step up the bank
        const si = Math.random() < 0.45 ? 3 : (Math.random() * 3) | 0;
        const centre = bankPoint(t, side, si === 3 ? Math.random() * 0.8 : 0.6 + Math.random() * 2.2);
        if (!centre) return;
        const n = 2 + ((Math.random() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const x = centre.x + (Math.random() - 0.5) * 3.2;
          const z = centre.z + (Math.random() - 0.5) * 3.2;
          const h = terrainHeight(x, z);
          if (h < levelAt(streamAt(x, z).t) + 0.1) continue;
          if (inWater(x, z, 0.1)) continue;
          placements[si].push({ x, z, h });
        }
      });

      species.forEach((sp, si) => {
        const list = placements[si];
        if (!list.length) return;
        const mesh = new THREE.InstancedMesh(sp.geo, sp.mat, list.length);
        mesh.receiveShadow = true;
        if (sp.bush) {
          mesh.castShadow = true;
          mesh.customDepthMaterial = sp.depthMat;
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
        mesh.computeBoundingSphere();
        scene.add(mesh);
        out.push(mesh);
      });
    }

    return { build, materials: species.map((s) => s.mat) };
  })();

  // --- lupine spikes (crossed alpha cards) clustered along both banks ---
  const spikes = (() => {
    const variants = [
      makeFlowerSpikeTexture('#7a4fae', '#cf95e0'), // purple
      makeFlowerSpikeTexture('#b45a92', '#f0b6d4'), // pink
    ].map((tex) => {
      const geo = crossCards(1.0, 2.2);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.9,
      });
      applyWind(mat, { strength: 0.25, freq: 2.1, heightFactor: 0.5 });
      keepAuthoredNormals(mat);
      return { geo, mat };
    });

    function build(cell, out) {
      for (const v of variants) {
        const positions = [];
        // seed cluster spots on the banks, then sprinkle spikes around each
        overSpans(cell, RATE.spikeClusters, (t) => {
          const p = streamCurve.getPointAt(t);
          const tan = streamCurve.getTangentAt(t);
          const bx = -tan.z, bz = tan.x;
          const bl = Math.hypot(bx, bz) || 1;
          const side = Math.random() < 0.5 ? 1 : -1;
          const off = halfWidthAt(t) + 2 + Math.random() * 6.5;
          const cx = p.x + (bx / bl) * off * side;
          const cz = p.z + (bz / bl) * off * side;
          const n = 6 + ((Math.random() * 10) | 0);
          for (let k = 0; k < n; k++) {
            const x = cx + (Math.random() - 0.5) * 7;
            const z = cz + (Math.random() - 0.5) * 7;
            const h = terrainHeight(x, z);
            if (h < levelAt(streamAt(x, z).t) + 0.4) continue;
            if (inWater(x, z, 0.3)) continue;
            positions.push({ x, z, h });
          }
        });
        if (!positions.length) continue;
        const mesh = new THREE.InstancedMesh(v.geo, v.mat, positions.length);
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
        mesh.computeBoundingSphere();
        scene.add(mesh);
        out.push(mesh);
      }
    }

    return { build, materials: variants.map((v) => v.mat) };
  })();

  // --- small meadow flowers scattered through the grass ---
  const meadow = (() => {
    const tex = makeMeadowFlowerTexture();
    const geo = crossCards(0.9, 0.9, 0.45);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    applyWind(mat, { strength: 0.2, freq: 2.0, heightFactor: 0.6 });
    keepAuthoredNormals(mat);

    function build(cell, out) {
      const size = cell.size;
      const x0 = cell.cx - size / 2, z0 = cell.cz - size / 2;
      const want = RATE.flowerAttempts * size * size;
      const attempts = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
      const mats = [];
      for (let a = 0; a < attempts; a++) {
        const x = x0 + Math.random() * size;
        const z = z0 + Math.random() * size;
        const { d: sd, t } = streamAt(x, z);
        if (Math.random() > THREE.MathUtils.clamp(1.5 - sd / 55, 0.05, 1)) continue;
        const h = terrainHeight(x, z);
        if (h < levelAt(t) + 0.35) continue;
        if (inWater(x, z, 0.3)) continue;
        dummy.position.set(x, h + 0.15, z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.setScalar(0.7 + Math.random() * 0.8);
        dummy.updateMatrix();
        mats.push(dummy.matrix.clone());
      }
      if (!mats.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mesh.receiveShadow = true;
      for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      out.push(mesh);
    }

    return { build, materials: [mat] };
  })();

  // --- fluffy grass-ball bushes between the trunks, built the same way as
  // the broadleaf tree crowns: noise-displaced blobs wrapped in a leaf-disc
  // texture, several per bush, with meadow flowers poking out of the top ---
  const bushes = (() => {
    // leaf blobs — fresh yellow-greens so the clump reads as lush grass
    const leafTex = makeLeafFillTexture(['#6d8a33', '#93ad45', '#b7c95e']);
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

    // meadow flowers nestled into the top of each clump
    const flowerMat = new THREE.MeshStandardMaterial({
      map: makeMeadowFlowerTexture(),
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    applyWind(flowerMat, { strength: 0.15, freq: 2.0, heightFactor: 0.6 });
    keepAuthoredNormals(flowerMat);
    const FLOWERS = 4;
    const flowerGeo = crossCards(0.55, 0.55);
    const col = new THREE.Color();

    function build(cell, out) {
      const size = cell.size;
      const x0 = cell.cx - size / 2, z0 = cell.cz - size / 2;
      const want = RATE.bushAttempts * size * size;
      const attempts = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
      const spots = [];
      for (let a = 0; a < attempts; a++) {
        const x = x0 + Math.random() * size;
        const z = z0 + Math.random() * size;
        const { d: sd, t } = streamAt(x, z);
        if (sd > 90) continue;
        const h = terrainHeight(x, z);
        if (h < levelAt(t) + 0.4) continue;
        if (inWater(x, z, 0.8)) continue;
        spots.push({ x, z, h, s: 0.6 + Math.random() * 0.9 });
      }
      if (!spots.length) return;

      // The blobs are the heaviest thing in the understory, and as one field-wide
      // mesh they could never be frustum culled — every blob behind the camera was
      // still submitted and still ran the wind shader. The cell is now the cull
      // unit, so one mesh per cell does that job.
      const blobs = new THREE.InstancedMesh(blobGeo, blobMat, spots.length * BLOBS);
      blobs.castShadow = true;
      blobs.receiveShadow = true;
      blobs.customDepthMaterial = blobDepthMat;
      let bi = 0;
      for (const f of spots) {
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
          blobs.setMatrixAt(bi, dummy.matrix);
          col.setHSL(0.2 + Math.random() * 0.05, 0.42 + Math.random() * 0.14, 0.5 + Math.random() * 0.16);
          blobs.setColorAt(bi, col);
          bi++;
        }
      }
      blobs.instanceMatrix.needsUpdate = true;
      if (blobs.instanceColor) blobs.instanceColor.needsUpdate = true;
      blobs.computeBoundingSphere();
      scene.add(blobs);
      out.push(blobs);

      const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, spots.length * FLOWERS);
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
      flowers.computeBoundingSphere();
      scene.add(flowers);
      out.push(flowers);
    }

    return { build, materials: [blobMat, flowerMat] };
  })();

  const sections = [garden, spikes, meadow, bushes];

  return {
    // Shared across every cell, so toonifying them once at startup covers all
    // cells ever built.
    materials: sections.flatMap((s) => s.materials),
    layer: {
      id: 'foliage',
      build(cell) {
        const out = [];
        // A sub-sequence per section, so adding or reordering sections cannot
        // shift another one's layout.
        sections.forEach((s, k) => {
          withSeed(cellSeed(cell.i, cell.j, 6100 + k * 613), () => s.build(cell, out));
        });
        return out;
      },
      dispose(meshes) {
        for (const m of meshes) {
          scene.remove(m);
          // Geometry and materials are shared across cells; only the per-instance
          // buffers belong to this cell.
          m.dispose();
        }
      },
    },
  };
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
