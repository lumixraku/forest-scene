import * as THREE from 'three';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, halfWidthAt } from './streamPath.js';
import { makeGroundTexture } from './textures.js';
import { CELL } from './streaming.js';

// Smooth-shaded valley ground with a tiled mottled-meadow texture. Vertex
// colors tint it: sandy at the waterline, dark soil in the channel, gently
// varied green elsewhere (the instanced grass supplies most of the detail).
//
// Built one cell at a time as the camera moves. The ground has to reach the
// horizon, and carrying the near field's vertex density that far would cost
// ~870k triangles; instead the segment count drops by distance ring, so the far
// tiles are cheap while the ground underfoot keeps every fold it had.

const grassDark = new THREE.Color('#67793a');
const grassLight = new THREE.Color('#93a44c');
const shore = new THREE.Color('#7d7452');
const bed = new THREE.Color('#8a7f63'); // sunlit sandy bed — shows through the clear water

// Vertex density by distance from the CAMERA, not from the world origin. The
// original ground was 220 segments over 300 units — 1.36 per vertex — and the
// near ring keeps exactly that, so the terrain underfoot has every fold it had.
// Beyond ~250 units a fold is a couple of pixels wide, so the count drops off:
// carrying near-field density to the horizon would cost ~870k triangles of
// ground alone.
const LOD_STEPS = [
  { within: 250, segments: 74 },
  { within: 450, segments: 36 },
  { within: Infinity, segments: 16 },
];

const segmentsFor = (dist) => LOD_STEPS.find((s) => dist <= s.within).segments;

// Tiles overlap by a hair so no seam pixel can show background between them: two
// tiles that merely touch still leave a visible crack under a moving camera.
const OVERLAP = 0.06;

export function createGroundLayer(scene, { radius }) {
  const tex = makeGroundTexture();
  // Repeat per world unit, matching the original 48 repeats over 300 units, so
  // the texture scale is identical whatever a tile's size or segment count is.
  const perUnit = 48 / 300;
  tex.repeat.set(CELL * perUnit, CELL * perUnit);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });

  return {
    material: mat,
    layer: {
      id: 'ground',
      radius,
      lod: segmentsFor,
      build(cell) {
        return buildTile(scene, mat, cell, cell.lod);
      },
      dispose(mesh) {
        scene.remove(mesh);
        // Each tile has its own geometry (its vertices are displaced by the
        // terrain under it), so unlike the shared material it must be released.
        mesh.geometry.dispose();
      },
    },
  };
}

function buildTile(scene, mat, cell, seg) {
  const size = cell.size + OVERLAP * 2;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    // PlaneGeometry is centred on the origin; offset into world space so the
    // terrain function sees this tile's actual position.
    const x = pos.getX(i) + cell.cx;
    const z = pos.getZ(i) + cell.cz;
    const h = terrainHeight(x, z);
    pos.setX(i, x);
    pos.setZ(i, z);
    pos.setY(i, h);

    const { d: sd, t } = streamAt(x, z);
    const lvl = levelAt(t);
    const hw = halfWidthAt(t);
    if (h < lvl + 0.15) {
      c.copy(bed);
    } else if (sd < hw + 3.5) {
      const k = (sd - hw) / 3.5;
      c.copy(shore).lerp(grassDark, THREE.MathUtils.clamp(k, 0, 1));
    } else {
      const n = 0.5 + 0.5 * Math.sin(x * 0.11 + z * 0.07) * Math.cos(x * 0.05 - z * 0.13);
      c.copy(grassDark).lerp(grassLight, n * 0.7);
    }
    // Per-vertex brightness jitter. Derived from position rather than drawn from
    // the RNG: adjacent tiles share an edge, and two different random values
    // there would light the seam differently and draw a line across the meadow.
    const v = 0.92 + 0.16 * hashNoise(x, z);
    colors[i * 3] = c.r * v;
    colors[i * 3 + 1] = c.g * v;
    colors[i * 3 + 2] = c.b * v;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Deterministic per-position value in 0..1. Quantised to the finest vertex
// spacing so a shared edge gets the same value from either tile even when the
// two tiles have different segment counts.
function hashNoise(x, z) {
  const q = 0.01;
  const xi = Math.round(x / q) | 0;
  const zi = Math.round(z / q) | 0;
  let h = Math.imul(xi, 0x27d4eb2d) ^ Math.imul(zi, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
