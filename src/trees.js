import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';

// Procedural low-poly pine forest, rendered as two InstancedMeshes
// (rigid trunks + swaying crowns) so the whole wood is cheap to draw.
export function createTrees(scene, { avoid = [] } = {}) {
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.5, 6, 6, 1, false);
  trunkGeo.translate(0, 3, 0);

  const crownGeo = buildPineCrown();

  const trunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a4630'),
    roughness: 1,
    flatShading: true,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#50692f'),
    roughness: 1,
    flatShading: true,
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

function buildPineCrown() {
  const layers = [
    [3.2, 4.0, 4.0],
    [2.4, 3.6, 6.6],
    [1.6, 3.0, 9.0],
    [0.85, 2.0, 11.4],
  ];
  const cones = layers.map(([r, h, y]) => {
    const c = new THREE.ConeGeometry(r, h, 7, 1);
    c.translate(0, y, 0);
    return c;
  });
  return mergeGeometries(cones, false);
}
