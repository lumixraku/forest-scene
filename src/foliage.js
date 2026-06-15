import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind } from './wind.js';
import { isLand, terrainHeight, CLEARINGS } from './terrain.js';
import { streamCurve, STREAM_HALF_WIDTH } from './streamPath.js';

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

  // --- riverbank wildflowers (clustered along both banks, near the rocks) ---
  const rfGeo = new THREE.IcosahedronGeometry(0.45, 0);
  const rfMat = new THREE.MeshStandardMaterial({ roughness: 0.5, flatShading: true, emissive: new THREE.Color('#6a5a18'), emissiveIntensity: 0.7 });
  const fPalette = [
    new THREE.Color('#f2d24a'), // yellow
    new THREE.Color('#fbf6ea'), // white
    new THREE.Color('#ec8fb4'), // pink
    new THREE.Color('#e87a3a'), // orange
    new THREE.Color('#a86bd6'), // purple
    new THREE.Color('#e84a4a'), // red
  ];
  const rfPos = [];
  for (let i = 0; i < 6000 && rfPos.length < 1600; i++) {
    const t = Math.random();
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = STREAM_HALF_WIDTH + 4.5 + Math.random() * 5.5;
    const x = p.x + (bx / bl) * off * side;
    const z = p.z + (bz / bl) * off * side;
    if (!isLand(x, z, 0.1)) continue;
    rfPos.push({ x, z, y: terrainHeight(x, z), s: 1.0 + Math.random() * 1.2, col: fPalette[(Math.random() * fPalette.length) | 0] });
  }
  const rflower = new THREE.InstancedMesh(rfGeo, rfMat, rfPos.length);
  for (let i = 0; i < rfPos.length; i++) {
    const f = rfPos[i];
    dummy.position.set(f.x, f.y + 0.8, f.z);
    dummy.scale.setScalar(f.s);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.updateMatrix();
    rflower.setMatrixAt(i, dummy.matrix);
    rflower.setColorAt(i, f.col);
  }
  rflower.instanceMatrix.needsUpdate = true;
  if (rflower.instanceColor) rflower.instanceColor.needsUpdate = true;

  // --- bright flower meadows scattered across ALL the land (everywhere) ---
  const mfGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const mfMat = new THREE.MeshStandardMaterial({ roughness: 0.5, flatShading: true, emissive: new THREE.Color('#6a5a18'), emissiveIntensity: 0.6 });
  const mPalette = [
    new THREE.Color('#f2d24a'),
    new THREE.Color('#fbf6ea'),
    new THREE.Color('#ec8fb4'),
    new THREE.Color('#e87a3a'),
    new THREE.Color('#a86bd6'),
    new THREE.Color('#e84a4a'),
  ];
  const mfPos = [];
  for (let cluster = 0; cluster < 280 && mfPos.length < 3000; cluster++) {
    const seed = scatter(clearing, 5, 142);
    const n = 5 + ((Math.random() * 12) | 0);
    for (let k = 0; k < n && mfPos.length < 3000; k++) {
      const x = seed.x + (Math.random() - 0.5) * 9;
      const z = seed.z + (Math.random() - 0.5) * 9;
      if (!isLand(x, z, 0.1)) continue;
      mfPos.push({ x, z, y: terrainHeight(x, z), s: 0.8 + Math.random() * 1.3, col: mPalette[(Math.random() * mPalette.length) | 0] });
    }
  }
  const meadow = new THREE.InstancedMesh(mfGeo, mfMat, mfPos.length);
  for (let i = 0; i < mfPos.length; i++) {
    const f = mfPos[i];
    dummy.position.set(f.x, f.y + 0.7, f.z);
    dummy.scale.setScalar(f.s);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.updateMatrix();
    meadow.setMatrixAt(i, dummy.matrix);
    meadow.setColorAt(i, f.col);
  }
  meadow.instanceMatrix.needsUpdate = true;
  if (meadow.instanceColor) meadow.instanceColor.needsUpdate = true;

  // --- dense bright flowers filling the sunlit clearings (light-yellow patches) ---
  const cfGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const cfMat = new THREE.MeshStandardMaterial({ roughness: 0.5, flatShading: true, emissive: new THREE.Color('#7a6a18'), emissiveIntensity: 0.7 });
  const cPalette = [
    new THREE.Color('#f6e04a'),
    new THREE.Color('#fbf2c0'),
    new THREE.Color('#efcf5a'),
    new THREE.Color('#fbf6ea'),
    new THREE.Color('#ec8fb4'),
  ];
  const cfPos = [];
  for (const clr of CLEARINGS) {
    const target = 90 + ((clr.r * clr.r) / 4) | 0;
    let got = 0;
    for (let i = 0; i < target * 6 && got < target; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * (clr.r - 1);
      const x = clr.x + Math.cos(a) * rr;
      const z = clr.z + Math.sin(a) * rr;
      if (!isLand(x, z, 0.1)) continue;
      cfPos.push({ x, z, y: terrainHeight(x, z), s: 0.9 + Math.random() * 1.3, col: cPalette[(Math.random() * cPalette.length) | 0] });
      got++;
    }
  }
  const clearingFlowers = new THREE.InstancedMesh(cfGeo, cfMat, cfPos.length);
  for (let i = 0; i < cfPos.length; i++) {
    const f = cfPos[i];
    dummy.position.set(f.x, f.y + 0.7, f.z);
    dummy.scale.setScalar(f.s);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.updateMatrix();
    clearingFlowers.setMatrixAt(i, dummy.matrix);
    clearingFlowers.setColorAt(i, f.col);
  }
  clearingFlowers.instanceMatrix.needsUpdate = true;
  if (clearingFlowers.instanceColor) clearingFlowers.instanceColor.needsUpdate = true;

  scene.add(grass, bush, flower, rflower, meadow, clearingFlowers);
  return { grass, bush, flower, rflower, meadow, clearingFlowers };
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
