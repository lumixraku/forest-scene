import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCardWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, streamCurve } from './streamPath.js';
import {
  makePagodaBranchTexture, makeLeafBlobTexture, makeNeedleBranchTexture,
  makeSpruceTopTexture, makeBarkTexture, makeBirchTexture,
} from './textures.js';

// Old-growth conifer forest, built the way the reference scene does it:
// every BRANCH is its own instance of a small crossed drooping card whose
// texture is a fully drawn branch (bezier stem + side twigs + hundreds of
// individual needle strokes, alpha-cut). Each tree is tiers of whorled
// branch instances — length shrinking and colour lightening toward the top —
// capped with crossed spire cards. Trunks are thick noise-displaced
// cylinders with a root flare. Five species:
//   pagoda     — 小叶榄仁, the signature valley tree: pale straight trunk,
//                flat umbrella tiers of near-horizontal leafy branches
//   pine       — mid-ground, full crown from near the ground
//   high pine  — bare lower trunk with dead sticks, crown held high
//   broadleaf  — pale bent trunks by the banks, crowns of leafy blobs
//   spruce     — darkest, tallest spires filling the background slopes
// Everything is InstancedMesh — 2-4 draw calls per species.
export function createTrees(scene) {
  const pagodaBark = makeBarkTexture({ base: '#8a8172', crack: 'rgba(34,30,24,1)', ridge: 'rgba(202,194,176,1)', knots: false });
  const pineBark = makeBarkTexture({ base: '#4f4338', crack: 'rgba(22,18,14,1)', ridge: 'rgba(120,104,84,1)' });
  const highBark = makeBarkTexture({ base: '#54453a', crack: 'rgba(28,20,14,1)', ridge: 'rgba(140,110,80,1)', knots: false });
  const spruceBark = makeBarkTexture({ base: '#453a32', crack: 'rgba(18,14,10,1)', ridge: 'rgba(108,92,74,1)' });
  const birchBark = makeBirchTexture();

  const pineCols = ['#26402a', '#3c5a33', '#5d7a44'];
  const highCols = ['#2c4a24', '#48662f', '#74904a'];
  const darkCols = ['#1f3826', '#33512f', '#4f6e3e'];
  const pineTex = makeNeedleBranchTexture(pineCols);
  const pineTopTex = makeSpruceTopTexture(pineCols);
  const highTex = makeNeedleBranchTexture(highCols);
  const highTopTex = makeSpruceTopTexture(highCols);
  const darkTex = makeNeedleBranchTexture(darkCols);
  const darkTopTex = makeSpruceTopTexture(darkCols);
  const leafTex = makeLeafBlobTexture(['#476b33', '#6f8d47', '#8fae55']);
  const pagodaTex = makePagodaBranchTexture();

  // one shared drooping crossed-card geometry for every needle branch
  const branchGeo = makeBranchCardGeo({ droop: 0.22, cross: 0.62 });

  // ---- pagoda (小叶榄仁) — flat umbrella tiers, the signature tree ----
  const pagodas = placeSpecies({
    count: 70, minD: 10, maxD: 100, sRange: [0.9, 1.4],
    // hand-placed trees framing the opening camera view from both banks
    fixed: [{ x: -26, z: -24.5, s: 1.25 }, { x: -13, z: -2.5, s: 1.35 }],
  });
  addTrunks(scene, pagodas, makeTrunkGeo({ topR: 0.13, botR: 0.4, h: 11.8, flare: 3.4 }), pagodaBark);
  scatterBranches(scene, pagodas, makePagodaFanGeo(), pagodaTex, {
    tiers: 5, branches: 7,
    crownBase: 5.2, crownTop: 11.4,
    lenBase: 4.2, lenTop: 2.0,
    droopBase: -0.06, droopJitter: 0.1,
    yJitter: 0.2, tilt: 0.22, yScale: 0.7, fan: true,
    hue: 0.24, light: 0.44,
  });

  // ---- pine — mid-ground conifer, full crown from near the ground ----
  const pines = placeSpecies({ count: 90, minD: 16, maxD: 130, sRange: [0.85, 1.4] });
  addTrunks(scene, pines, makeTrunkGeo({ topR: 0.2, botR: 0.72, h: 12, flare: 4.2 }), pineBark);
  scatterBranches(scene, pines, branchGeo, pineTex, {
    tiers: 12, branches: 10,
    crownBase: 2.8, crownTop: 11.6,
    lenBase: 2.6, lenTop: 0.55,
    droopBase: 0.5, droopJitter: 0.24,
    hue: 0.3, light: 0.36,
  });
  addSpires(scene, pines, pineTopTex, { crownTop: 11.6, hue: 0.3, light: 0.38 });

  // ---- high pine — bare mossy trunk, crown held high, dead sticks ----
  const highPines = placeSpecies({ count: 45, minD: 20, maxD: 110, sRange: [0.9, 1.4] });
  addTrunks(scene, highPines, makeTrunkGeo({ topR: 0.13, botR: 0.55, h: 14.5, flare: 3.6 }), highBark);
  addDeadSticks(scene, highPines, highBark);
  scatterBranches(scene, highPines, branchGeo, highTex, {
    tiers: 9, branches: 9,
    crownBase: 7.8, crownTop: 14.3,
    lenBase: 2.3, lenTop: 0.5,
    droopBase: 0.26, droopJitter: 0.3,
    hue: 0.27, light: 0.36,
  });
  addSpires(scene, highPines, highTopTex, { crownTop: 14.3, hue: 0.27, light: 0.4 });

  // ---- broadleaf — pale bent trunks near the banks, leafy blob crowns ----
  const broadleafs = placeSpecies({
    count: 38, minD: 12, maxD: 45, sRange: [0.8, 1.2],
    fixed: [{ x: -30, z: -0.5, s: 1.2 }, { x: -16, z: -26, s: 1.15 }],
  });
  addTrunks(scene, broadleafs, makeTrunkGeo({ topR: 0.14, botR: 0.4, h: 8.6, flare: 2.6, bend: 1.0 }), birchBark);
  scatterBroadleafCrowns(scene, broadleafs, leafTex);

  // ---- spruce — darkest, tallest spires on the background slopes ----
  const spruces = placeSpecies({ count: 110, minD: 48, maxD: 140, sRange: [0.7, 1.45] });
  addTrunks(scene, spruces, makeTrunkGeo({ topR: 0.1, botR: 0.85, h: 17, flare: 3.2 }), spruceBark);
  scatterBranches(scene, spruces, branchGeo, darkTex, {
    tiers: 13, branches: 10,
    crownBase: 2.2, crownTop: 16.5,
    lenBase: 3.3, lenTop: 0.42,
    droopBase: 0.62, droopJitter: 0.22,
    hue: 0.32, light: 0.34,
  });
  addSpires(scene, spruces, darkTopTex, { crownTop: 16.5, hue: 0.32, light: 0.34 });
}

// Rejection-sampled placements along the stream distance bands. The forest
// thickens away from the water, and the opening camera position stays clear
// so a random tree never spawns right in front of the initial view.
function placeSpecies({ count, minD, maxD, sRange, fixed = [] }) {
  const trees = fixed.map((f) => ({ x: f.x, z: f.z, rot: Math.random() * Math.PI * 2, s: f.s }));
  const camP = streamCurve.getPointAt(0.36);
  const camX = camP.x - 2, camZ = camP.z + 8;

  let attempts = 0;
  while (trees.length < count && attempts < count * 40) {
    attempts++;
    const x = (Math.random() - 0.5) * 290;
    const z = (Math.random() - 0.5) * 290;
    if ((x - camX) * (x - camX) + (z - camZ) * (z - camZ) < 15 * 15) continue;
    const { d: sd, t } = streamAt(x, z);
    if (sd < minD || sd > maxD) continue;
    const keep = THREE.MathUtils.clamp((sd - minD) / 40 + 0.35, 0, 1);
    if (Math.random() > keep) continue;
    const h = terrainHeight(x, z);
    if (h < levelAt(t) + 0.5) continue;
    trees.push({
      x, z,
      rot: Math.random() * Math.PI * 2,
      s: sRange[0] + Math.random() * (sRange[1] - sRange[0]),
    });
  }
  return trees;
}

// Thick tapered trunk with knobbly radial noise and a root flare spreading
// into the ground; optional bend curves the whole stem (broadleaf).
function makeTrunkGeo({ topR, botR, h, flare = 3.5, bend = 0 }) {
  const g = new THREE.CylinderGeometry(topR, botR, h, 14, 8, false);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const dir = Math.random() * Math.PI * 2;
  const bx = Math.cos(dir) * bend, bz = Math.sin(dir) * bend;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / h;
    const ang = Math.atan2(v.z, v.x);
    const lump = 1 + (Math.sin(ang * 3 + v.y * 0.8) * 0.5 + Math.sin(ang * 5 + 1.7 + v.y * 0.35) * 0.5) * 0.07;
    const fl = t < 0.08 ? 1 + (0.08 - t) * flare * (0.55 + 0.45 * Math.sin(ang * 5 + 1.3)) : 1;
    pos.setX(i, v.x * lump * fl + bx * t * t);
    pos.setZ(i, v.z * lump * fl + bz * t * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function addTrunks(scene, trees, geo, barkTex) {
  const mat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  trees.forEach((tr, i) => {
    dummy.position.set(tr.x, terrainHeight(tr.x, tr.z) - 0.25, tr.z);
    dummy.rotation.set((Math.random() - 0.5) * 0.07, tr.rot, (Math.random() - 0.5) * 0.07);
    dummy.scale.set(tr.s, tr.s, tr.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// Short dead branch stubs angling down off the bare lower trunks.
function addDeadSticks(scene, trees, barkTex) {
  if (trees.length === 0) return;
  const PER = 7;
  const geo = new THREE.CylinderGeometry(0.015, 0.055, 2.4, 5, 1);
  geo.translate(0, 1.2, 0);
  const mat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length * PER);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let m = 0;
  for (const tr of trees) {
    const yBase = terrainHeight(tr.x, tr.z);
    for (let i = 0; i < PER; i++) {
      const h = (2 + Math.random() * 4.8) * tr.s;
      const a = Math.random() * Math.PI * 2;
      const rad = (0.55 - (h / (14.5 * tr.s)) * 0.4) * tr.s * 0.8;
      dummy.position.set(tr.x + Math.cos(a) * rad, yBase + h, tr.z + Math.sin(a) * rad);
      dummy.rotation.set((Math.random() - 0.5) * 0.4, -a, -(Math.PI / 2 - 0.35 - Math.random() * 0.5));
      const k = (0.5 + Math.random() * 0.6) * tr.s;
      dummy.scale.set(k, k, k);
      dummy.updateMatrix();
      mesh.setMatrixAt(m++, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// The unit pagoda branch: three side-view cards fanned ±yaw around the
// branch axis plus one card lying flat in the branch plane, so each branch
// covers a real horizontal sector of the tier (fan silhouette from above,
// forked-twig silhouette from the side) instead of a single blade.
function makePagodaFanGeo() {
  const parts = [];
  for (const [yaw, k, tiltX] of [[-0.5, 0.85, -0.26], [0, 1, 0.3], [0.5, 0.85, -0.22]]) {
    const card = new THREE.PlaneGeometry(1, 0.5, 5, 1);
    card.translate(0.5, 0, 0);
    card.rotateX(tiltX);
    card.scale(k, k, k);
    card.rotateY(yaw);
    parts.push(card);
  }
  const flat = new THREE.PlaneGeometry(1, 0.8, 5, 2);
  flat.translate(0.5, 0, 0);
  flat.rotateX(-Math.PI / 2);
  flat.translate(0, 0.05, 0);
  parts.push(flat);
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// The unit branch: a 1×0.5 card extending along +X from the trunk (uv.x 0 at
// the root so wind pivots there), tip drooping with x², duplicated at ±cross
// around X so every branch has volume from any angle.
function makeBranchCardGeo({ droop = 0.22, cross = 0.62 }) {
  const half = new THREE.PlaneGeometry(1, 0.5, 5, 1);
  half.translate(0.5, 0, 0);
  const pos = half.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, pos.getY(i) - x * x * droop);
  }
  const a = half.clone();
  a.rotateX(cross);
  half.rotateX(-cross);
  const g = mergeGeometries([a, half], false);
  g.computeVertexNormals();
  return g;
}

function foliageMaterial(tex, { windStrength = 0.08, alphaTest = 0.36, axis = 'x' } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.0,
  });
  applyCardWind(mat, { strength: windStrength, axis });
  keepAuthoredNormals(mat);
  return mat;
}

function depthMaterial(tex, alphaTest) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest });
}

// Whorls of branch instances: per tier, `branches` cards fanned around the
// trunk with jittered yaw/droop/length, colour lightening toward the top.
function scatterBranches(scene, trees, geo, tex, p) {
  const yJitter = p.yJitter ?? 0.5;
  const tilt = p.tilt ?? 0.6;
  const counts = [];
  for (let i = 0; i < p.tiers; i++) {
    const t = p.tiers === 1 ? 0 : i / (p.tiers - 1);
    counts.push(Math.max(3, Math.round(p.branches * (1 - t * 0.4))));
  }
  const perTree = counts.reduce((a, b) => a + b, 0);
  const mat = foliageMaterial(tex, { windStrength: 0.08 });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length * perTree);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = depthMaterial(tex, 0.36);

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let m = 0;
  for (const tr of trees) {
    const yBase = terrainHeight(tr.x, tr.z);
    for (let i = 0; i < p.tiers; i++) {
      const t = p.tiers === 1 ? 0 : i / (p.tiers - 1);
      const y = yBase + (p.crownBase + t * (p.crownTop - p.crownBase)) * tr.s;
      const len = Math.max(0.35, p.lenBase * (1 - t) + p.lenTop * t) * tr.s;
      const yaw0 = tr.rot + i * 0.62;
      for (let b = 0; b < counts[i]; b++) {
        const yaw = yaw0 + (b / counts[i]) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const droop = p.droopBase * (1 - t * 0.6) + (Math.random() - 0.5) * p.droopJitter;
        const off = 0.12 * tr.s;
        dummy.position.set(
          tr.x + Math.cos(yaw) * off,
          y + (Math.random() - 0.5) * yJitter * tr.s,
          tr.z - Math.sin(yaw) * off
        );
        dummy.rotation.set((Math.random() - 0.5) * tilt, yaw, -droop);
        const L = len * (0.8 + Math.random() * 0.45);
        // fan geometries carry their horizontal spread in z, so scale it with
        // the branch length; plain crossed cards keep z at 1
        dummy.scale.set(L, L * (0.85 + Math.random() * 0.35) * (p.yScale ?? 1), p.fan ? L : 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
        col.setHSL(
          p.hue + (Math.random() - 0.5) * 0.02,
          0.3 + Math.random() * 0.15,
          p.light + t * 0.07 + Math.random() * 0.09
        );
        mesh.setColorAt(m, col);
        m++;
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

// Three crossed vertical spire cards capping each conifer.
function addSpires(scene, trees, tex, { crownTop, hue, light }) {
  const card = new THREE.PlaneGeometry(0.8, 1.7, 1, 4);
  card.translate(0, 0.78, 0);
  const geo = mergeGeometries(
    [card, card.clone().rotateY(Math.PI / 3), card.clone().rotateY((Math.PI * 2) / 3)],
    false
  );
  geo.computeVertexNormals();
  const mat = foliageMaterial(tex, { windStrength: 0.1, axis: 'y' });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = depthMaterial(tex, 0.36);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  trees.forEach((tr, i) => {
    const y = terrainHeight(tr.x, tr.z) + (crownTop - 0.3) * tr.s;
    dummy.position.set(tr.x, y, tr.z);
    dummy.rotation.set(0, tr.rot, (Math.random() - 0.5) * 0.06);
    const k = (1 + Math.random() * 0.35) * tr.s;
    dummy.scale.set(k, k, k);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(hue + (Math.random() - 0.5) * 0.02, 0.32, light + Math.random() * 0.08);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

// Broadleaf crowns: a loose cloud of noise-displaced leafy blobs plus curved
// leaf shells, every piece fully random-rotated with its own colour — the
// leaf-disc texture breaks the silhouette into individual leaves.
function scatterBroadleafCrowns(scene, trees, tex) {
  if (trees.length === 0) return;
  const BLOBS = 11, SHELLS = 14;
  const blobGeo = makeBlobGeo();
  const shellGeo = makeShellGeo();
  const blobMat = foliageMaterial(tex, { windStrength: 0.05, alphaTest: 0.28, axis: 'y' });
  const shellMat = foliageMaterial(tex, { windStrength: 0.06, alphaTest: 0.45, axis: 'y' });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, trees.length * BLOBS);
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, trees.length * SHELLS);
  for (const [mesh, at] of [[blobs, 0.28], [shells, 0.45]]) {
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = depthMaterial(tex, at);
  }

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let mb = 0, ms = 0;
  for (const tr of trees) {
    const cy = terrainHeight(tr.x, tr.z) + 7.2 * tr.s;
    const spread = 1.6 * tr.s;
    for (let i = 0; i < BLOBS; i++) {
      dummy.position.set(
        tr.x + (Math.random() - 0.5) * spread * 1.7,
        cy + (Math.random() - 0.5) * spread * 1.2,
        tr.z + (Math.random() - 0.5) * spread * 1.7
      );
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI);
      const k = (1.6 + Math.random() * 1.0) * tr.s;
      dummy.scale.set(k, k * (0.75 + Math.random() * 0.35), k);
      dummy.updateMatrix();
      blobs.setMatrixAt(mb, dummy.matrix);
      col.setHSL(0.27 + Math.random() * 0.04, 0.26 + Math.random() * 0.14, 0.33 + Math.random() * 0.14);
      blobs.setColorAt(mb, col);
      mb++;
    }
    for (let i = 0; i < SHELLS; i++) {
      dummy.position.set(
        tr.x + (Math.random() - 0.5) * spread * 2,
        cy + (Math.random() - 0.5) * spread * 1.35,
        tr.z + (Math.random() - 0.5) * spread * 2
      );
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI);
      const k = (2.0 + Math.random() * 1.4) * tr.s;
      dummy.scale.set(k, k, k);
      dummy.updateMatrix();
      shells.setMatrixAt(ms, dummy.matrix);
      col.setHSL(0.27 + Math.random() * 0.04, 0.26 + Math.random() * 0.14, 0.35 + Math.random() * 0.14);
      shells.setColorAt(ms, col);
      ms++;
    }
  }
  for (const mesh of [blobs, shells]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
}

// Lumpy squashed sphere the leaf-disc texture wraps around. Vertices are
// merged before displacing so the normals smooth across facets instead of
// reading as a low-poly rock.
function makeBlobGeo() {
  const raw = new THREE.IcosahedronGeometry(0.55, 2);
  raw.deleteAttribute('uv'); // per-face uvs block vertex merging
  const g = mergeVertices(raw);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 4.2 + 9 + v.y * 4.2 + v.z * 3.2) * 0.5 + Math.sin(v.y * 7.5 + v.x * 5.5) * 0.5;
    const f = 1 + n * 0.34;
    pos.setXYZ(i, v.x * f, v.y * f * 0.82, v.z * f);
    // simple spherical wrap — the leaf texture is busy enough to hide the seam
    uvs[i * 2] = Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5;
    uvs[i * 2 + 1] = v.y / 1.1 + 0.5;
  }
  pos.needsUpdate = true;
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// Gently curved square shell — a handful of leaves bending with the wind.
function makeShellGeo() {
  const g = new THREE.PlaneGeometry(1, 1, 4, 4);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, (x * x + y * y) * 0.5);
  }
  g.computeVertexNormals();
  return g;
}
