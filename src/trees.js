import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';
import { isLand } from './terrain.js';

// Procedural forest with round clustered crowns, rendered as two InstancedMeshes
// (rigid trunks + swaying crowns) so the whole wood is cheap to draw.
export function createTrees(scene, { avoid = [] } = {}) {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.6, 6, 12, 4, false);
  trunkGeo.translate(0, 3, 0);
  displaceBark(trunkGeo, 0.04);

  const crownGeo = buildRoundCrown();

  const trunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a4630'),
    roughness: 1,
    flatShading: true,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4e6b2c'),
    roughness: 0.85,
  });
  applyWind(crownMat, { strength: 0.22, freq: 1.2, heightFactor: 0.10 });

  const COUNT = 170;
  const dummy = new THREE.Object3D();
  const matrices = [];
  const crownColors = new Float32Array(COUNT * 3);
  const cVar = new THREE.Color();
  let placed = 0;
  let attempts = 0;

  while (placed < COUNT && attempts < COUNT * 12) {
    attempts++;
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 98;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    let ok = true;
    for (const av of avoid) {
      const dx = x - av.c.x;
      const dz = z - av.c.y;
      if (dx * dx + dz * dz < av.r * av.r) { ok = false; break; }
    }
    if (ok && !isLand(x, z, 1.2)) ok = false; // only on the island, never in water
    if (!ok) continue;

    const scale = 0.7 + Math.random() * 1.1;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());

    cVar.copy(crownMat.color).offsetHSL(
      (Math.random() - 0.5) * 0.04,
      (Math.random() - 0.5) * 0.14,
      (Math.random() - 0.5) * 0.10
    );
    crownColors[placed * 3] = cVar.r;
    crownColors[placed * 3 + 1] = cVar.g;
    crownColors[placed * 3 + 2] = cVar.b;
    placed++;
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placed);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, placed);
  trunks.castShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  trunks.receiveShadow = true;

  for (let i = 0; i < placed; i++) {
    trunks.setMatrixAt(i, matrices[i]);
    crowns.setMatrixAt(i, matrices[i]);
    crowns.setColorAt(i, new THREE.Color(crownColors[i * 3], crownColors[i * 3 + 1], crownColors[i * 3 + 2]));
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

  scene.add(trunks, crowns);
  return { trunks, crowns, count: placed };
}

function buildRoundCrown() {
  const blobs = [
    { x: 0,    y: 8.0,  z: 0,    r: 3.8 },
    { x: 2.4,  y: 7.5,  z: 0.8,  r: 2.6 },
    { x: -2.1, y: 8.0,  z: -1.0, r: 2.8 },
    { x: 0.8,  y: 10.2, z: -1.6, r: 2.5 },
    { x: -1.3, y: 6.5,  z: 2.2,  r: 2.4 },
    { x: 0.3,  y: 5.6,  z: 2.5,  r: 2.2 },
    { x: -2.6, y: 9.3,  z: 0.6,  r: 2.1 },
    { x: 2.7,  y: 9.3,  z: -0.4, r: 2.3 },
    { x: 0.5,  y: 11.0, z: 0.8,  r: 1.8 },
    { x: -0.8, y: 9.5,  z: 2.0,  r: 2.0 },
    { x: 1.8,  y: 6.0,  z: -1.8, r: 2.0 },
    { x: -1.5, y: 6.2,  z: -1.5, r: 1.8 },
  ];
  const parts = blobs.map(b => {
    const sph = new THREE.IcosahedronGeometry(b.r, 2);
    displaceFoliage(sph, 0.18);
    sph.translate(b.x, b.y, b.z);
    return sph;
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
