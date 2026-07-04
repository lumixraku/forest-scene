import * as THREE from 'three';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, halfWidthAt } from './streamPath.js';
import { makeGroundTexture } from './textures.js';

// Smooth-shaded valley ground with a tiled mottled-meadow texture. Vertex
// colors tint it: sandy at the waterline, dark soil in the channel, gently
// varied green elsewhere (the instanced grass supplies most of the detail).
export function createGround() {
  const size = 300;
  const seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];

  const grassDark = new THREE.Color('#67793a');
  const grassLight = new THREE.Color('#93a44c');
  const shore = new THREE.Color('#7d7452');
  const bed = new THREE.Color('#8a7f63'); // sunlit sandy bed — shows through the clear water

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
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
    const v = 0.92 + 0.16 * Math.random();
    colors.push(c.r * v, c.g * v, c.b * v);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const tex = makeGroundTexture();
  tex.repeat.set(48, 48);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
