import * as THREE from 'three';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, halfWidthAt } from './streamPath.js';
import { makeGroundTexture } from './textures.js';
import { CHUNK, chunkCentre } from './grid.js';

// The texture and material are built ONCE and shared by every chunk's ground
// plane. Per-chunk materials would mean per-chunk shader programs — toonify
// patches each material it finds, and nine copies of the same patched program is
// nine compiles and a visible hitch as each chunk lands.
let groundMat = null;
function sharedGroundMat() {
  if (groundMat) return groundMat;
  const tex = makeGroundTexture();
  // 48 repeats over the old 300-unit plane. Each chunk is still 300 units, so
  // the pitch stays 48 per chunk and the texel size is unchanged — the tiling
  // continues across a chunk boundary instead of restarting at a different scale.
  tex.repeat.set(48, 48);
  groundMat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  return groundMat;
}

// Smooth-shaded valley ground with a tiled mottled-meadow texture. Vertex
// colors tint it: sandy at the waterline, dark soil in the channel, gently
// varied green elsewhere (the instanced grass supplies most of the detail).
//
// One plane per chunk. terrainHeight is a pure function of world x/z, so two
// abutting planes evaluate the SAME height along their shared edge and meet
// without a crack — provided the plane size equals the chunk pitch exactly, and
// the segment count divides the span so vertices land on the boundary.
export function createGround(cx = 0, cz = 0) {
  const size = CHUNK;
  const seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const origin = chunkCentre(cx, cz);

  const pos = geo.attributes.position;
  const colors = [];

  const grassDark = new THREE.Color('#67793a');
  const grassLight = new THREE.Color('#93a44c');
  const shore = new THREE.Color('#7d7452');
  const bed = new THREE.Color('#8a7f63'); // sunlit sandy bed — shows through the clear water

  for (let i = 0; i < pos.count; i++) {
    // Vertices are displaced in WORLD space and the mesh is left at the origin,
    // rather than positioning the mesh at the chunk centre: terrainHeight and the
    // colour bands below are all functions of world position, so the geometry has
    // to be built in the same frame they are evaluated in.
    const x = pos.getX(i) + origin.x;
    const z = pos.getZ(i) + origin.z;
    pos.setX(i, x);
    pos.setZ(i, z);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    const { d: sd, t } = streamAt(x, z);
    const lvl = levelAt(t);
    const hw = halfWidthAt(t);
    const c = new THREE.Color();
    if (h < lvl + 0.15) {
      c.copy(bed);
    } else if (sd < hw + 3.5) {
      const k = (sd - hw) / 3.5;
      c.copy(shore).lerp(grassDark, THREE.MathUtils.clamp(k, 0, 1));
    } else {
      const n = 0.5 + 0.5 * Math.sin(x * 0.11 + z * 0.07) * Math.cos(x * 0.05 - z * 0.13);
      c.copy(grassDark).lerp(grassLight, n * 0.7);
    }
    // Brightness jitter hashed from the WORLD position, not drawn from
    // Math.random(). Two chunks share the vertices along their common edge, and a
    // random draw gives those vertices a different value on each side — a ±8%
    // brightness step running the full 300 units of the boundary, which reads as
    // a seam even under the ground texture. Hashing the position makes both
    // chunks compute the same value for the same point.
    const v = 0.92 + 0.16 * hash2(x, z);
    colors.push(c.r * v, c.g * v, c.b * v);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // The vertices carry world coordinates, so the default bounding sphere would be
  // computed around the origin for every chunk and frustum culling would keep all
  // nine planes alive at all times.
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, sharedGroundMat());
  mesh.receiveShadow = true;
  return mesh;
}

// Deterministic value noise in 0..1 from a world position.
function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
