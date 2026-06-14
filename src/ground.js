import * as THREE from 'three';
import { terrainHeight, WATER_LEVEL, inClearing } from './terrain.js';

// Forested land mesh built from the shared terrainHeight function. Sunlit
// clearings render as light yellow-green meadow patches.
export function createGround() {
  const size = 300;
  const seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];

  const land = new THREE.Color('#4d5d2b');
  const landLight = new THREE.Color('#6d8438');
  const shore = new THREE.Color('#9a8a55');
  const shallow = new THREE.Color('#41513f');
  const deep = new THREE.Color('#16261f');
  const meadow = new THREE.Color('#c6c24a');
  const meadowBright = new THREE.Color('#e2d878');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    const c = new THREE.Color();
    const clr = inClearing(x, z);
    if (clr) {
      const dx = x - clr.x;
      const dz = z - clr.z;
      const t = 1 - Math.sqrt(dx * dx + dz * dz) / clr.r; // 1 centre -> 0 edge
      c.copy(meadow).lerp(meadowBright, Math.max(0, t) * 0.7);
    } else if (h > 1.4) {
      c.copy(land).lerp(landLight, Math.min(1, (h - 1.4) * 0.3));
    } else if (h > 0) {
      c.copy(shore);
    } else if (h > -2) {
      c.copy(shallow);
    } else {
      c.copy(deep);
    }
    const v = 0.9 + 0.2 * Math.random();
    colors.push(c.r * v, c.g * v, c.b * v);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

