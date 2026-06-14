import * as THREE from 'three';
import { terrainHeight, WATER_LEVEL } from './terrain.js';

// Forested island mesh built from the shared terrainHeight function.
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

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    const c = new THREE.Color();
    if (h > 1.4) {
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
