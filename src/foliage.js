import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { streamCurve, streamAt, levelAt, halfWidthAt } from './streamPath.js';
import {
  makeFlowerSpikeTexture, makeMeadowFlowerTexture, makeLeafClusterTexture,
  makeFlowerBushTexture, makeSedgeTexture,
} from './textures.js';

// Undergrowth accents: lupine-like flower spikes clustered on the banks,
// small yellow/white meadow flowers sprinkled through the grass, and leafy
// card bushes filling the gaps between trunks.
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

  // --- bank garden: patches of flower bushes and sedge along the waterline,
  // clustered by species so the banks read as arranged drifts, not confetti ---
  {
    const species = [
      { tex: makeFlowerBushTexture('#d13d9e'), geo: bushCards(), s: [0.4, 0.75], bush: true },
      { tex: makeFlowerBushTexture('#8a5ad2'), geo: bushCards(), s: [0.38, 0.7], bush: true },
      { tex: makeFlowerBushTexture('#e0669c'), geo: bushCards(), s: [0.35, 0.65], bush: true },
      { tex: makeSedgeTexture(), geo: crossCards(2.0, 1.6), s: [0.8, 1.6], bush: false },
    ];
    const placements = species.map(() => []);

    const CLUSTERS = 64;
    for (let c = 0; c < CLUSTERS; c++) {
      const t = Math.random();
      const side = Math.random() < 0.5 ? 1 : -1;
      // sedge hugs the waterline; flower bushes sit a step up the bank
      const si = Math.random() < 0.45 ? 3 : (Math.random() * 3) | 0;
      const centre = bankPoint(t, side, si === 3 ? Math.random() * 0.8 : 0.6 + Math.random() * 2.2);
      if (!centre) continue;
      const n = 2 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const x = centre.x + (Math.random() - 0.5) * 3.2;
        const z = centre.z + (Math.random() - 0.5) * 3.2;
        const h = terrainHeight(x, z);
        if (h < levelAt(streamAt(x, z).t) + 0.1) continue;
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
      scene.add(mesh);
    });
  }

  // --- lupine spikes (crossed alpha cards) clustered along both banks ---
  const spikeVariants = [
    makeFlowerSpikeTexture('#7a4fae', '#cf95e0'), // purple
    makeFlowerSpikeTexture('#b45a92', '#f0b6d4'), // pink
  ];
  for (const tex of spikeVariants) {
    const geo = crossCards(1.0, 2.2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    applyWind(mat, { strength: 0.25, freq: 2.1, heightFactor: 0.5 });
    keepAuthoredNormals(mat);

    const positions = [];
    // seed cluster spots on the banks, then sprinkle spikes around each
    for (let c = 0; c < 20 && positions.length < 320; c++) {
      const t = Math.random();
      const p = streamCurve.getPointAt(t);
      const tan = streamCurve.getTangentAt(t);
      const bx = -tan.z, bz = tan.x;
      const bl = Math.hypot(bx, bz) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = halfWidthAt(t) + 2 + Math.random() * 6.5;
      const cx = p.x + (bx / bl) * off * side;
      const cz = p.z + (bz / bl) * off * side;
      const n = 6 + ((Math.random() * 10) | 0);
      for (let k = 0; k < n && positions.length < 320; k++) {
        const x = cx + (Math.random() - 0.5) * 7;
        const z = cz + (Math.random() - 0.5) * 7;
        const h = terrainHeight(x, z);
        if (h < levelAt(streamAt(x, z).t) + 0.4) continue;
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
    scene.add(mesh);
  }

  // --- small meadow flowers scattered through the grass ---
  {
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
    const COUNT = 1400;
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.receiveShadow = true;
    let placed = 0, attempts = 0;
    while (placed < COUNT && attempts < COUNT * 12) {
      attempts++;
      const x = (Math.random() - 0.5) * 240;
      const z = (Math.random() - 0.5) * 240;
      const { d: sd, t } = streamAt(x, z);
      if (Math.random() > THREE.MathUtils.clamp(1.5 - sd / 55, 0.05, 1)) continue;
      const h = terrainHeight(x, z);
      if (h < levelAt(t) + 0.35) continue;
      dummy.position.set(x, h + 0.15, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.setScalar(0.7 + Math.random() * 0.8);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }

  // --- leafy card bushes between the trunks ---
  {
    const tex = makeLeafClusterTexture({ hue: 104, sat: 40, light: 38 });
    const geo = bushCards();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.95,
    });
    applyWind(mat, { strength: 0.12, freq: 1.4, heightFactor: 0.25 });
    keepAuthoredNormals(mat);
    const COUNT = 140;
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: tex,
      alphaTest: 0.5,
    });
    let placed = 0, attempts = 0;
    while (placed < COUNT && attempts < COUNT * 30) {
      attempts++;
      const x = (Math.random() - 0.5) * 270;
      const z = (Math.random() - 0.5) * 270;
      const { d: sd, t } = streamAt(x, z);
      if (sd < halfWidthAt(t) + 2 || sd > 90) continue;
      const h = terrainHeight(x, z);
      if (h < levelAt(t) + 0.4) continue;
      const s = 0.7 + Math.random() * 1.3;
      dummy.position.set(x, h - 0.2, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(s, s * 0.8, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
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
