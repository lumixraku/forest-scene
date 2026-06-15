import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';
import { isLand } from './terrain.js';

// Undergrowth: thousands of grass tufts, scattered bushes and a few warm
// wildflowers concentrated in the sunlit clearing.
export function createFoliage(scene, { clearing }) {
  const dummy = new THREE.Object3D();

  // --- grass tufts (triangular cones, low-poly) ---
  const grassGeo = new THREE.ConeGeometry(0.16, 1.0, 3, 1, false);
  grassGeo.translate(0, 0.5, 0);
  const grassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7c9a4a'),
    roughness: 1,
    flatShading: true,
  });
  applyWind(grassMat, { strength: 0.6, freq: 2.0, heightFactor: 0.7 });
  const GC = 7000;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GC);
  grass.receiveShadow = true;
  for (let i = 0; i < GC; i++) {
    const p = scatter(clearing);
    const s = 0.5 + Math.random() * 1.2;
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(s, s * (0.8 + Math.random() * 0.7), s);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;

  // --- bushes (clustered foliage blobs) ---
  const bushGeo = buildBushGeo();
  const bushMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a7233'),
    roughness: 0.85,
  });
  applyWind(bushMat, { strength: 0.18, freq: 1.3, heightFactor: 0.3 });
  const BC = 440;
  const bush = new THREE.InstancedMesh(bushGeo, bushMat, BC);
  bush.castShadow = true;
  bush.receiveShadow = true;
  for (let i = 0; i < BC; i++) {
    const p = scatter(clearing, 8, 110);
    const s = 0.7 + Math.random() * 1.6;
    dummy.position.set(p.x, s * 0.5, p.z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(s * 1.3, s * 0.9, s * 1.3);
    dummy.updateMatrix();
    bush.setMatrixAt(i, dummy.matrix);
  }
  bush.instanceMatrix.needsUpdate = true;

  // --- wildflowers (tiny warm dots for sunlit highlights) ---
  const flowerGeo = new THREE.IcosahedronGeometry(0.12, 0);
  const flowerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e8d36a'),
    emissive: new THREE.Color('#5a4a10'),
    roughness: 0.8,
  });
  const FC = 280;
  const flower = new THREE.InstancedMesh(flowerGeo, flowerMat, FC);
  for (let i = 0; i < FC; i++) {
    const p = scatter(clearing, 3, 55);
    dummy.position.set(p.x, 0.3 + Math.random() * 0.4, p.z);
    dummy.scale.setScalar(0.6 + Math.random() * 1.4);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    flower.setMatrixAt(i, dummy.matrix);
  }
  flower.instanceMatrix.needsUpdate = true;

  scene.add(grass, bush, flower);
  return { grass, bush, flower };
}

function scatter(clearing, minR = 2, maxR = 110) {
  for (let a = 0; a < 12; a++) {
    const ang = Math.random() * Math.PI * 2;
    let p;
    if (Math.random() < 0.5) {
      const r = Math.random() * 16;
      p = { x: clearing.x + Math.cos(ang) * r, z: clearing.y + Math.sin(ang) * r };
    } else {
      const r = minR + Math.random() * (maxR - minR);
      p = { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
    }
    if (isLand(p.x, p.z, 0.6)) return p; // keep undergrowth out of the water
  }
  const ang = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (maxR - minR);
  return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
}

function buildBushGeo() {
  const blobs = [
    { x: 0,     y: 0,    z: 0,    r: 0.7 },
    { x: 0.5,   y: 0.15, z: 0.3,  r: 0.5 },
    { x: -0.45, y: 0.2,  z: -0.2, r: 0.55 },
    { x: 0.1,   y: 0.35, z: -0.5, r: 0.45 },
    { x: -0.3,  y: -0.1, z: 0.45, r: 0.42 },
    { x: 0.35,  y: 0.4,  z: 0.1,  r: 0.38 },
  ];
  const parts = blobs.map(b => {
    const sph = new THREE.IcosahedronGeometry(b.r, 1);
    const pos = sph.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = Math.sin(x * 4 + y * 3) * Math.cos(z * 4) * 0.15;
      pos.setXYZ(i, x * (1 + n), y * (1 + n), z * (1 + n));
    }
    pos.needsUpdate = true;
    sph.computeVertexNormals();
    sph.translate(b.x, b.y, b.z);
    return sph;
  });
  return mergeGeometries(parts, false);
}
