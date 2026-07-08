import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, halfWidthAt } from './streamPath.js';

// Dense instanced grass — the single biggest realism ingredient. Each instance
// is a small tuft of tapered blades; a brightness gradient is baked into the
// blade vertices (dark base -> light tip) and per-instance colors vary the
// hue between deep green and sunlit yellow-green. Normals are forced upward
// so the meadow shades like a continuous sunlit surface instead of a mass of
// dark random facets.
//
// The field is split into a grid of chunks, one InstancedMesh each:
//  - chunks outside the camera frustum are culled by three.js (a single
//    field-sized InstancedMesh always drew all 60k tufts)
//  - distant chunks thin out by truncating instanceCount — placement order
//    is random, so a lower count IS a uniform density reduction
export function createGrass(scene) {
  const geo = buildTuftGeometry();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  applyWind(mat, { strength: 0.1, freq: 1.9, heightFactor: 0.8 });
  keepAuthoredNormals(mat);

  const COUNT = 60000;
  const FIELD = 290;
  const GRID = 8; // 8x8 chunks
  const CHUNK = FIELD / GRID;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const deep = new THREE.Color('#48661f');
  const sunlit = new THREE.Color('#9cb149');

  // bucket the placements per chunk first, then build one mesh per chunk
  const buckets = Array.from({ length: GRID * GRID }, () => ({ mats: [], cols: [] }));
  let placed = 0;
  let attempts = 0;
  while (placed < COUNT && attempts < COUNT * 14) {
    attempts++;
    const x = (Math.random() - 0.5) * FIELD;
    const z = (Math.random() - 0.5) * FIELD;
    const { d: sd, t } = streamAt(x, z);

    // dense near the stream corridor, thinning up the slopes — but with a
    // sparse band along the waterline itself, so the bank plants (flower
    // bushes, sedge, spikes) read instead of a wall of tall grass
    const bankD = sd - halfWidthAt(t);
    const bankK = 0.38 + 0.62 * THREE.MathUtils.smoothstep(bankD, 1.5, 9);
    const keep = THREE.MathUtils.clamp(1.55 - sd / 62, 0.12, 1) * bankK;
    if (Math.random() > keep) continue;
    const h = terrainHeight(x, z);
    if (h < levelAt(t) + 0.25) continue; // not in the water — grass runs right up to the edge

    // shorter tufts near the water's edge; tight scale range keeps the lawn
    // even, like it's been trimmed
    const s = (0.6 + Math.random() * 0.2) * (0.8 + 0.2 * THREE.MathUtils.smoothstep(bankD, 0, 8));
    dummy.position.set(x, h - 0.05, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.9 + Math.random() * 0.2), s);
    dummy.updateMatrix();

    // sunnier (yellower) tufts on open slopes, deeper green near the water
    const sunK = THREE.MathUtils.clamp(sd / 45, 0, 1) * 0.5 + Math.random() * 0.5;
    col.copy(deep).lerp(sunlit, sunK);
    col.offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.06);

    const cx = Math.min(GRID - 1, Math.floor((x + FIELD / 2) / CHUNK));
    const cz = Math.min(GRID - 1, Math.floor((z + FIELD / 2) / CHUNK));
    const bucket = buckets[cz * GRID + cx];
    bucket.mats.push(dummy.matrix.clone());
    bucket.cols.push(col.clone());
    placed++;
  }

  const chunks = [];
  buckets.forEach((bucket, bi) => {
    const n = bucket.mats.length;
    if (n === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.receiveShadow = true;
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, bucket.mats[i]);
      mesh.setColorAt(i, bucket.cols[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // instance-aware bounds -> real frustum culling
    scene.add(mesh);

    const cx = (bi % GRID + 0.5) * CHUNK - FIELD / 2;
    const cz = (Math.floor(bi / GRID) + 0.5) * CHUNK - FIELD / 2;
    chunks.push({ mesh, full: n, centre: new THREE.Vector2(cx, cz) });
  });

  // distance-based density: full within 60m of the camera, fading to 15%
  // far out where a tuft is subpixel anyway. Re-evaluated only after the
  // camera has actually moved.
  const lastCam = new THREE.Vector2(Infinity, Infinity);
  const camXZ = new THREE.Vector2();
  return {
    update(camera) {
      camXZ.set(camera.position.x, camera.position.z);
      if (camXZ.distanceToSquared(lastCam) < 2.25) return;
      lastCam.copy(camXZ);
      for (const c of chunks) {
        const dist = c.centre.distanceTo(camXZ);
        const f = THREE.MathUtils.clamp(1 - (dist - 60) / 130, 0.15, 1);
        c.mesh.count = Math.ceil(c.full * f);
      }
    },
  };
}

// One tuft = 6 tapered two-segment blades leaning outward.
function buildTuftGeometry() {
  const blades = [];
  const BLADES = 6;
  for (let i = 0; i < BLADES; i++) {
    const ang = (i / BLADES) * Math.PI * 2 + Math.random() * 0.9;
    const lean = 0.1 + Math.random() * 0.16;
    const height = 0.38 + Math.random() * 0.18;
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
