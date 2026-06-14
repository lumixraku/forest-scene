import * as THREE from 'three';

// Gently rolling terrain with a flattened clearing and raised enclosing edges.
export function createGround() {
  const size = 240;
  const seg = 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];
  const base = new THREE.Color('#4d5d2b');
  const dark = new THREE.Color('#3a4720');
  const light = new THREE.Color('#6d8438');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.sqrt(x * x + z * z);

    // Layered low-frequency noise for gentle hills.
    let h =
      Math.sin(x * 0.05) * 1.2 +
      Math.cos(z * 0.045) * 1.0 +
      Math.sin(x * 0.13 + z * 0.11) * 0.5 +
      Math.cos(z * 0.2 - x * 0.07) * 0.3;

    // Keep the central clearing flat (a sunny meadow).
    h *= THREE.MathUtils.smoothstep(d, 6, 22);
    // Raise the far edges so the forest feels enclosed.
    h += THREE.MathUtils.smoothstep(d, 45, 100) * 4.5;

    pos.setY(i, h);

    // Vertex colour variation — brighter on the little hillocks.
    const c = base.clone().lerp(h > 1.3 ? light : dark, Math.min(1, Math.abs(h) * 0.4));
    const v = 0.85 + 0.3 * Math.random();
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
