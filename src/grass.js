import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt } from './streamPath.js';

// Dense instanced grass — the single biggest realism ingredient. Each instance
// is a small tuft of tapered blades; a brightness gradient is baked into the
// blade vertices (dark base -> light tip) and per-instance colors vary the
// hue between deep green and sunlit yellow-green. Normals are forced upward
// so the meadow shades like a continuous sunlit surface instead of a mass of
// dark random facets.
export function createGrass(scene) {
  const geo = buildTuftGeometry();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  applyWind(mat, { strength: 0.28, freq: 1.9, heightFactor: 0.8 });
  keepAuthoredNormals(mat);

  const COUNT = 60000;
  const grass = new THREE.InstancedMesh(geo, mat, COUNT);
  grass.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const deep = new THREE.Color('#48661f');
  const sunlit = new THREE.Color('#9cb149');

  let placed = 0;
  let attempts = 0;
  while (placed < COUNT && attempts < COUNT * 14) {
    attempts++;
    const x = (Math.random() - 0.5) * 290;
    const z = (Math.random() - 0.5) * 290;
    const { d: sd, t } = streamAt(x, z);

    // dense near the stream corridor, thinning up the slopes
    const keep = THREE.MathUtils.clamp(1.55 - sd / 62, 0.12, 1);
    if (Math.random() > keep) continue;
    const h = terrainHeight(x, z);
    if (h < levelAt(t) + 0.25) continue; // not in the water — grass runs right up to the edge

    const s = 0.62 + Math.random() * 0.72;
    dummy.position.set(x, h - 0.05, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
    dummy.updateMatrix();
    grass.setMatrixAt(placed, dummy.matrix);

    // sunnier (yellower) tufts on open slopes, deeper green near the water
    const sunK = THREE.MathUtils.clamp(sd / 45, 0, 1) * 0.5 + Math.random() * 0.5;
    col.copy(deep).lerp(sunlit, sunK);
    col.offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.06);
    grass.setColorAt(placed, col);
    placed++;
  }
  grass.count = placed;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;

  scene.add(grass);
  return grass;
}

// One tuft = 6 tapered two-segment blades leaning outward.
function buildTuftGeometry() {
  const blades = [];
  const BLADES = 6;
  for (let i = 0; i < BLADES; i++) {
    const ang = (i / BLADES) * Math.PI * 2 + Math.random() * 0.9;
    const lean = 0.12 + Math.random() * 0.3;
    const height = 0.8 + Math.random() * 0.55;
    blades.push(buildBlade(ang, lean, height, Math.random() * 0.22));
  }
  const geo = mergeGeometries(blades, false);

  // upward normals -> soft continuous meadow shading
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

function buildBlade(ang, lean, height, baseOff) {
  const wBase = 0.09, wMid = 0.055;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const px = -dz, pz = dx; // perpendicular for blade width

  const ox = dx * baseOff, oz = dz * baseOff;
  const bend1 = lean * height * 0.45;
  const bend2 = lean * height;

  const p = [
    // base pair
    ox - px * wBase, 0, oz - pz * wBase,
    ox + px * wBase, 0, oz + pz * wBase,
    // mid pair
    ox + dx * bend1 - px * wMid, height * 0.55, oz + dz * bend1 - pz * wMid,
    ox + dx * bend1 + px * wMid, height * 0.55, oz + dz * bend1 + pz * wMid,
    // tip
    ox + dx * bend2, height, oz + dz * bend2,
  ];
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4];

  // brightness gradient baked per vertex: dark roots, light tips
  const shade = [0.42, 0.42, 0.78, 0.78, 1.0];
  const cols = [];
  for (const s of shade) cols.push(s, s, s);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0), 3));
  g.setIndex(idx);
  return g;
}
