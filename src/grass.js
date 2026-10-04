import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyGrassWind, keepAuthoredNormals } from './wind.js';
import { meadowColor, GRASS_ROOT } from './ground.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, halfWidthAt, inWater } from './streamPath.js';

// Dense instanced grass — the single biggest realism ingredient. Each instance
// is a small tuft of tapered blades; a brightness gradient is baked into the
// blade vertices (dark base -> light tip) and per-instance colors follow the
// ground's own colour field (meadowColor in ground.js). Normals are forced upward
// so the meadow shades like a continuous sunlit surface instead of a mass of
// dark random facets.
//
// One InstancedMesh per streamed cell:
//  - cells outside the camera frustum are culled by three.js (a single
//    field-sized InstancedMesh always drew all 60k tufts)
//  - distant cells thin out by truncating instanceCount — placement order
//    is random, so a lower count IS a uniform density reduction
//
// Density is expressed per square metre rather than as a total. The original
// scattered 60,000 tufts over a 290x290 field by rejection sampling, which works
// out to 1.6535 attempts/m² at a 43% acceptance rate; a 100m cell therefore makes
// ATTEMPTS_PER_M2 * 10,000 attempts and lands ~7,130 tufts. Keeping the rate
// rather than the total is what makes the meadow underfoot identical whether the
// world is 300m or unbounded.
const ATTEMPTS_PER_M2 = 1.6535;
// Tufts per accepted sample. The original meadow was ~4 blades/m², so the soil
// showed through everywhere and the grass read as scattered spikes; doubled, and
// with more blades per tuft, it closes into a lawn.
const TUFTS_PER_SAMPLE = 2;

export function createGrass(scene, { radius }) {
  const geo = buildTuftGeometry();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  applyGrassWind(mat, { strength: 0.16 });
  keepAuthoredNormals(mat);

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // Every built cell, for the distance-based thinning below.
  const cells = [];

  function build(cell) {
    const attempts = Math.round(ATTEMPTS_PER_M2 * cell.size * cell.size);
    const mats = [];
    const cols = [];

    for (let a = 0; a < attempts; a++) {
      const x = cell.x0 + Math.random() * cell.size;
      const z = cell.z0 + Math.random() * cell.size;
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
      if (inWater(x, z, 0.1)) continue;

      for (let k = 0; k < TUFTS_PER_SAMPLE; k++) {
        const tx = x + (k ? (Math.random() - 0.5) * 0.9 : 0);
        const tz = z + (k ? (Math.random() - 0.5) * 0.9 : 0);
        // shorter tufts near the water's edge; tight scale range keeps the lawn
        // even, like it's been trimmed
        const s = (0.72 + Math.random() * 0.3) * (0.75 + 0.25 * THREE.MathUtils.smoothstep(bankD, 0, 8));
        dummy.position.set(tx, (k ? terrainHeight(tx, tz) : h) - 0.05, tz);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.scale.set(s, s * (0.85 + Math.random() * 0.3), s);
        dummy.updateMatrix();

        // the ground's own colour field, so the roots match the soil between them;
        // only a whisper of per-tuft jitter, or the lawn turns to salt and pepper
        meadowColor(tx, tz, col);
        col.offsetHSL((Math.random() - 0.5) * 0.015, 0, (Math.random() - 0.5) * 0.05);

        mats.push(dummy.matrix.clone());
        cols.push(col.clone());
      }
    }

    if (!mats.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mesh.receiveShadow = true;
    for (let i = 0; i < mats.length; i++) {
      mesh.setMatrixAt(i, mats[i]);
      mesh.setColorAt(i, cols[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // instance-aware bounds -> real frustum culling
    scene.add(mesh);

    const entry = { mesh, full: mats.length, centre: new THREE.Vector2(cell.cx, cell.cz) };
    cells.push(entry);
    // A new cell has never been thinned, so the next update() has to run even if
    // the camera is standing still. Without this a cell that streams in while the
    // camera is stationary keeps full density forever — the thinning used to be
    // safe to skip only because every chunk existed before the first update().
    dirty = true;
    return entry;
  }

  function dispose(entry) {
    if (!entry) return;
    scene.remove(entry.mesh);
    // Releases instanceMatrix/instanceColor only — the tuft geometry and material
    // are shared by every cell and must survive.
    entry.mesh.dispose();
    const i = cells.indexOf(entry);
    if (i >= 0) cells.splice(i, 1);
  }

  // distance-based density: full within 45m of the camera, fading to 12%
  // far out where a tuft is subpixel anyway. Tighter than it was because each
  // tuft now carries twice the blades. Re-evaluated only after the
  // camera has actually moved.
  const lastCam = new THREE.Vector2(Infinity, Infinity);
  const camXZ = new THREE.Vector2();
  let dirty = true;

  return {
    material: mat,
    layer: { id: 'grass', radius, build, dispose },
    update(camera) {
      camXZ.set(camera.position.x, camera.position.z);
      if (!dirty && camXZ.distanceToSquared(lastCam) < 2.25) return;
      dirty = false;
      lastCam.copy(camXZ);
      for (const c of cells) {
        const dist = c.centre.distanceTo(camXZ);
        const f = THREE.MathUtils.clamp(1 - (dist - 45) / 110, 0.12, 1);
        c.mesh.count = Math.ceil(c.full * f);
      }
    },
  };
}

// One tuft = 8 slender curved blades fanning out from a small footprint.
function buildTuftGeometry() {
  const blades = [];
  const BLADES = 8;
  for (let i = 0; i < BLADES; i++) {
    const ang = (i / BLADES) * Math.PI * 2 + Math.random() * 0.8;
    const lean = 0.18 + Math.random() * 0.3;
    const height = 0.34 + Math.random() * 0.36;
    blades.push(buildBlade(ang, lean, height, Math.random() * 0.24));
  }
  const geo = mergeGeometries(blades, false);

  // upward normals -> soft continuous meadow shading
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

// Three segments on a quadratic arc, so the blade curves over instead of
// kinking once. Width tapers to a point.
function buildBlade(ang, lean, height, baseOff) {
  const wBase = 0.05;
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const px = -dz, pz = dx; // perpendicular for blade width
  const ox = dx * baseOff, oz = dz * baseOff;

  const p = [];
  const cols = [];
  const SEG = 3;
  for (let k = 0; k <= SEG; k++) {
    const t = k / SEG;
    const out = lean * height * t * t * 1.4;
    const y = height * (t - lean * 0.35 * t * t);
    const w = wBase * (1 - t);
    const cx = ox + dx * out, cz = oz + dz * out;
    if (k < SEG) p.push(cx - px * w, y, cz - pz * w, cx + px * w, y, cz + pz * w);
    else p.push(cx, y, cz);
    // Root-to-tip colour multiplier. The root matches the ground exactly (see
    // GRASS_ROOT in ground.js); the tip goes lighter AND warmer — sun through a
    // thin blade turns it yellow, which is what gives a meadow its glow.
    const r = THREE.MathUtils.lerp(GRASS_ROOT, 1.32, t);
    const g = THREE.MathUtils.lerp(GRASS_ROOT, 1.22, t);
    const b = THREE.MathUtils.lerp(GRASS_ROOT, 0.8, t);
    cols.push(r, g, b);
    if (k < SEG) cols.push(r, g, b);
  }
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0), 3));
  g.setIndex(idx);
  return g;
}
