import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';
import { isLand } from './terrain.js';
import { CLEARINGS } from './terrain.js';

// Procedural forest with multiple species and non-uniform height scaling so the
// canopy is staggered (错落) instead of a flat field of identical blobs.
// Each species is a pair of InstancedMeshes (rigid trunk + swaying crown).
export function createTrees(scene, { avoid = [] } = {}) {
  const allAvoid = [...avoid, ...CLEARINGS.map((c) => ({ c: new THREE.Vector2(c.x, c.z), r: c.r + 1 }))];

  const trunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a4630'),
    roughness: 1,
    flatShading: true,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4e6b2c'),
    roughness: 0.85,
    flatShading: true,
  });
  applyWind(crownMat, { strength: 0.22, freq: 1.2, heightFactor: 0.10 });

  // Three distinct silhouettes break the "everything is a cauliflower" look.
  // hRange / wRange drive per-instance non-uniform scaling for height variety.
  const SPECIES = [
    {
      weight: 0.26,
      trunk: buildTrunk(0.18, 0.45, 9),
      crown: buildPineCrown(),
      hRange: [0.85, 1.55],
      wRange: [0.82, 1.05],
      tint: { h: -0.025, s: 0.02, l: -0.06 },
    },
    {
      weight: 0.44,
      trunk: buildTrunk(0.22, 0.55, 7),
      crown: buildOvalCrown(),
      hRange: [0.80, 1.35],
      wRange: [0.85, 1.18],
      tint: { h: 0.0, s: 0.0, l: 0.0 },
    },
    {
      weight: 0.30,
      trunk: buildTrunk(0.25, 0.6, 4),
      crown: buildBushCrown(),
      hRange: [0.70, 1.10],
      wRange: [0.90, 1.35],
      tint: { h: 0.03, s: -0.04, l: 0.05 },
    },
  ];

  const COUNT = 680;
  const buckets = SPECIES.map(() => ({ matrices: [], colors: [] }));
  const dummy = new THREE.Object3D();
  const cVar = new THREE.Color();
  let placed = 0;
  let attempts = 0;

  const cum = [];
  let acc = 0;
  for (const sp of SPECIES) { acc += sp.weight; cum.push(acc); }

  while (placed < COUNT && attempts < COUNT * 12) {
    attempts++;
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 138;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    let ok = true;
    for (const av of allAvoid) {
      const dx = x - av.c.x;
      const dz = z - av.c.y;
      if (dx * dx + dz * dz < av.r * av.r) { ok = false; break; }
    }
    if (ok && !isLand(x, z, 1.2)) ok = false; // only on the island, never in water
    if (!ok) continue;

    const rr = Math.random();
    let idx = 0;
    while (idx < cum.length - 1 && rr > cum[idx]) idx++;
    const sp = SPECIES[idx];

    // Non-uniform scale: stretch height independently of width for a staggered canopy.
    const hScale = sp.hRange[0] + Math.random() * (sp.hRange[1] - sp.hRange[0]);
    const wScale = sp.wRange[0] + Math.random() * (sp.wRange[1] - sp.wRange[0]);

    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(wScale, hScale, wScale);
    dummy.updateMatrix();

    cVar.copy(crownMat.color).offsetHSL(
      sp.tint.h + (Math.random() - 0.5) * 0.04,
      sp.tint.s + (Math.random() - 0.5) * 0.14,
      sp.tint.l + (Math.random() - 0.5) * 0.10
    );

    buckets[idx].matrices.push(dummy.matrix.clone());
    buckets[idx].colors.push(cVar.r, cVar.g, cVar.b);
    placed++;
  }

  const trees = [];
  const col = new THREE.Color();
  SPECIES.forEach((sp, i) => {
    const b = buckets[i];
    const n = b.matrices.length;
    if (n === 0) return;
    const trunks = new THREE.InstancedMesh(sp.trunk, trunkMat, n);
    const crowns = new THREE.InstancedMesh(sp.crown, crownMat, n);
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    trunks.receiveShadow = true;

    for (let j = 0; j < n; j++) {
      trunks.setMatrixAt(j, b.matrices[j]);
      crowns.setMatrixAt(j, b.matrices[j]);
      col.setRGB(b.colors[j * 3], b.colors[j * 3 + 1], b.colors[j * 3 + 2]);
      crowns.setColorAt(j, col);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

    scene.add(trunks, crowns);
    trees.push({ trunks, crowns, count: n });
  });

  return { trees, count: placed };
}

function buildTrunk(topR, botR, height) {
  const g = new THREE.CylinderGeometry(topR, botR, height, 8, 3, false);
  g.translate(0, height / 2, 0);
  displaceBark(g, 0.05);
  return g;
}

// Tall, narrow, pointed — stacked cones like a classic conifer.
function buildPineCrown() {
  const layers = [
    { y: 8.5, r: 3.4, h: 4.5 },
    { y: 11.3, r: 2.6, h: 4.2 },
    { y: 14.0, r: 1.9, h: 3.8 },
    { y: 16.5, r: 1.1, h: 2.8 },
  ];
  const parts = layers.map(l => {
    const c = new THREE.ConeGeometry(l.r, l.h, 8, 1);
    displaceFoliage(c, 0.10);
    c.translate(0, l.y, 0);
    return c;
  });
  return mergeGeometries(parts, false);
}

// Medium-tall deciduous — a vertical, oval cluster sitting high on the trunk.
function buildOvalCrown() {
  const blobs = [
    { x: 0,    y: 9.5,  z: 0,    r: 3.0 },
    { x: 1.8,  y: 8.8,  z: 0.7,  r: 2.2 },
    { x: -1.6, y: 9.2,  z: -0.8, r: 2.4 },
    { x: 0.7,  y: 11.5, z: -1.0, r: 2.0 },
    { x: -1.0, y: 8.0,  z: 1.6,  r: 2.0 },
    { x: 2.0,  y: 10.7, z: -0.3, r: 1.8 },
    { x: -2.0, y: 10.5, z: 0.5,  r: 1.8 },
    { x: 0.3,  y: 12.3, z: 0.6,  r: 1.5 },
  ];
  const parts = blobs.map(b => {
    const s = new THREE.IcosahedronGeometry(b.r, 2);
    displaceFoliage(s, 0.16);
    s.translate(b.x, b.y, b.z);
    return s;
  });
  return mergeGeometries(parts, false);
}

// Short, wide, dense — a low bushy tree that fills the understory.
function buildBushCrown() {
  const blobs = [
    { x: 0,    y: 5.5,  z: 0,    r: 3.2 },
    { x: 2.5,  y: 5.2,  z: 0.8,  r: 2.3 },
    { x: -2.2, y: 5.5,  z: -1.0, r: 2.5 },
    { x: 0.8,  y: 7.0,  z: -1.4, r: 2.0 },
    { x: -1.3, y: 4.6,  z: 2.2,  r: 2.0 },
    { x: 0.3,  y: 4.2,  z: 2.4,  r: 1.9 },
    { x: -2.6, y: 6.3,  z: 0.6,  r: 1.8 },
    { x: 2.7,  y: 6.3,  z: -0.4, r: 1.9 },
    { x: 1.7,  y: 4.3,  z: -1.7, r: 1.7 },
  ];
  const parts = blobs.map(b => {
    const s = new THREE.IcosahedronGeometry(b.r, 2);
    displaceFoliage(s, 0.18);
    s.translate(b.x, b.y, b.z);
    return s;
  });
  return mergeGeometries(parts, false);
}

function displaceFoliage(geo, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 2.7 + y * 1.3) * Math.cos(z * 2.3) * 0.6
            + Math.sin(x * 5.1) * Math.cos(y * 4.7 + z * 3.9) * 0.4;
    const f = 1 + n * amount;
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function displaceBark(geo, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const n = Math.sin(a * 9.0 + y * 2.5) * 0.7 + Math.sin(a * 17.0) * 0.3;
    pos.setX(i, x + Math.cos(a) * n * amount);
    pos.setZ(i, z + Math.sin(a) * n * amount);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}
