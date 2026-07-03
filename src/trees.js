import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { distToStream } from './streamPath.js';
import { makeLeafClusterTexture, makeBarkTexture, makeBirchTexture, makeSpruceTexture } from './textures.js';

// Card-foliage forest. Deciduous trees and birches are built from a textured,
// slightly bent trunk plus a crown of alpha-tested leaf-cluster cards whose
// normals point outward from the crown centre (soft blob lighting). Spruces
// are three crossed vertical cards with a full painted silhouette. Everything
// is instanced per variant, and crowns get an alpha-tested depth material so
// the sun casts dappled leaf shadows onto the grass.
export function createTrees(scene) {
  const barkTex = makeBarkTexture();
  const birchTex = makeBirchTexture();
  const leafTex = makeLeafClusterTexture({ hue: 96, sat: 44, light: 39 });
  const birchLeafTex = makeLeafClusterTexture({ hue: 78, sat: 46, light: 45, leafW: 8, round: true });
  const spruceTex = makeSpruceTexture();

  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1.0 });
  const birchTrunkMat = new THREE.MeshStandardMaterial({ map: birchTex, roughness: 0.9 });
  const leafMat = leafMaterial(leafTex);
  const birchLeafMat = leafMaterial(birchLeafTex);
  const spruceMat = leafMaterial(spruceTex, { windStrength: 0.06 });

  const groups = [
    // deciduous — the bulk of the valley forest
    ...range(4).map(() => ({
      trunk: buildTrunk({ topR: 0.22, botR: 0.55, h: 9 + Math.random() * 4, bend: 0.8 }),
      crown: buildCardCrown({ cy: 11 + Math.random() * 2.5, rx: 4.2 + Math.random() * 1.4, ry: 3.4 + Math.random() * 1.2, cards: 34, size: 4.6 }),
      trunkMat,
      crownMat: leafMat,
      count: 52,
      minD: 10, maxD: 130,
      hRange: [0.8, 1.45],
      tintH: 0, tintL: 0,
      tex: leafTex,
    })),
    // birch — slim white trunks near the banks
    ...range(3).map(() => ({
      trunk: buildTrunk({ topR: 0.13, botR: 0.3, h: 11 + Math.random() * 4, bend: 1.2 }),
      crown: buildCardCrown({ cy: 12.5 + Math.random() * 2.5, rx: 3.0 + Math.random() * 0.8, ry: 3.6 + Math.random() * 1.0, cards: 18, size: 3.8 }),
      trunkMat: birchTrunkMat,
      crownMat: birchLeafMat,
      count: 34,
      minD: 9, maxD: 45,
      hRange: [0.85, 1.4],
      tintH: -0.01, tintL: 0.04,
      tex: birchLeafTex,
    })),
    // spruce — dark spires filling the upper slopes / background
    {
      trunk: null,
      crown: buildSpruceCards({ h: 19, w: 10 }),
      trunkMat: null,
      crownMat: spruceMat,
      count: 110,
      minD: 48, maxD: 140,
      hRange: [0.7, 1.5],
      tintH: 0, tintL: 0,
      tex: spruceTex,
    },
  ];

  // hand-placed trees framing the opening camera view from both banks
  groups[0].fixed = [
    { x: -26, z: -24.5, hs: 1.25 },
    { x: -13, z: -2.5, hs: 1.35 },
  ];
  groups[4].fixed = [
    { x: -30, z: -0.5, hs: 1.2 },
    { x: -16, z: -26, hs: 1.15 },
  ];

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (const g of groups) {
    const matrices = [];
    for (const f of g.fixed ?? []) {
      dummy.position.set(f.x, terrainHeight(f.x, f.z) - 0.3, f.z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(1, f.hs, 1);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    let attempts = 0;
    while (matrices.length < g.count && attempts < g.count * 40) {
      attempts++;
      const x = (Math.random() - 0.5) * 290;
      const z = (Math.random() - 0.5) * 290;
      const sd = distToStream(x, z);
      if (sd < g.minD || sd > g.maxD) continue;
      // forest thickens away from the water
      const keep = THREE.MathUtils.clamp((sd - g.minD) / 40 + 0.35, 0, 1);
      if (Math.random() > keep) continue;
      const h = terrainHeight(x, z);
      if (h < 0.5) continue;

      const hs = g.hRange[0] + Math.random() * (g.hRange[1] - g.hRange[0]);
      const ws = 0.85 + Math.random() * 0.3;
      dummy.position.set(x, h - 0.3, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(ws, hs, ws);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    const n = matrices.length;
    if (n === 0) continue;

    const crowns = new THREE.InstancedMesh(g.crown, g.crownMat, n);
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    crowns.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: g.tex,
      alphaTest: 0.5,
    });
    for (let i = 0; i < n; i++) {
      crowns.setMatrixAt(i, matrices[i]);
      // near-white tint so the multiply barely darkens the leaf texture
      col.setHSL(0.26 + g.tintH + (Math.random() - 0.5) * 0.03, 0.2, 0.68 + g.tintL + (Math.random() - 0.5) * 0.08);
      crowns.setColorAt(i, col);
    }
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    scene.add(crowns);

    if (g.trunk) {
      const trunks = new THREE.InstancedMesh(g.trunk, g.trunkMat, n);
      trunks.castShadow = true;
      trunks.receiveShadow = true;
      for (let i = 0; i < n; i++) trunks.setMatrixAt(i, matrices[i]);
      trunks.instanceMatrix.needsUpdate = true;
      scene.add(trunks);
    }
  }
}

function leafMaterial(tex, { windStrength = 0.14 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.0,
  });
  applyWind(mat, { strength: windStrength, freq: 1.15, heightFactor: 0.08 });
  keepAuthoredNormals(mat);
  return mat;
}

function buildTrunk({ topR, botR, h, bend }) {
  const g = new THREE.CylinderGeometry(topR, botR, h, 7, 6, false);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const dir = Math.random() * Math.PI * 2;
  const bx = Math.cos(dir) * bend, bz = Math.sin(dir) * bend;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) + bx * t * t);
    pos.setZ(i, pos.getZ(i) + bz * t * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Crown = leaf-cluster cards scattered in an ellipsoid shell, normals outward.
function buildCardCrown({ cy, rx, ry, cards, size }) {
  const parts = [];
  const centre = new THREE.Vector3(0, cy, 0);
  const v = new THREE.Vector3();
  for (let i = 0; i < cards; i++) {
    // biased to the shell so the silhouette reads, some inside for density
    const shell = 0.55 + Math.random() * 0.45;
    v.randomDirection();
    const px = v.x * rx * shell;
    const py = v.y * ry * shell;
    const pz = v.z * rx * shell;

    const s = size * (0.7 + Math.random() * 0.6);
    const card = new THREE.PlaneGeometry(s, s);
    const e = new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    card.rotateX(e.x); card.rotateY(e.y); card.rotateZ(e.z);
    card.translate(centre.x + px, centre.y + py, centre.z + pz);

    // outward normals -> soft rounded crown lighting
    const out = new THREE.Vector3(px, py, pz).normalize();
    const n = card.attributes.normal;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, out.x, out.y, out.z);
    parts.push(card);
  }
  return mergeGeometries(parts, false);
}

function buildSpruceCards({ h, w }) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const card = new THREE.PlaneGeometry(w, h);
    card.rotateY((i / 3) * Math.PI);
    card.translate(0, h / 2 - 0.4, 0);
    parts.push(card);
  }
  const g = mergeGeometries(parts, false);
  // upward-tilted normals so spruces catch skylight instead of going black
  const n = g.attributes.normal;
  const up = new THREE.Vector3();
  for (let k = 0; k < n.count; k++) {
    up.set(n.getX(k), 0.9, n.getZ(k)).normalize();
    n.setXYZ(k, up.x, up.y, up.z);
  }
  return g;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}
