import * as THREE from 'three';
import { applyWind } from './wind.js';

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

  // --- bushes (squashed icosahedrons) ---
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const bushMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#5a7233'),
    roughness: 1,
    flatShading: true,
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
  const a = Math.random() * Math.PI * 2;
  if (Math.random() < 0.5) {
    const r = Math.random() * 16;
    return { x: clearing.x + Math.cos(a) * r, z: clearing.y + Math.sin(a) * r };
  }
  const r = minR + Math.random() * (maxR - minR);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
