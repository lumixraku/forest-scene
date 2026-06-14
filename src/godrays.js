import * as THREE from 'three';

// A glowing sun disc above the clearing plus additive volumetric light shafts
// shining down through the canopy — recreating the warm mid-band of the video.
export function createGodRays(scene, clearing, PALETTE) {
  const group = new THREE.Group();
  const sunPos = new THREE.Vector3(-8, 30, -40);

  // Bright sun disc (kept out of fog so it stays luminous; bloom amplifies it).
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 20, 14),
    new THREE.MeshBasicMaterial({
      color: PALETTE.sun,
      transparent: true,
      opacity: 0.85,
      fog: false,
      depthWrite: false,
    })
  );
  glow.position.copy(sunPos);
  group.add(glow);

  // Soft additive halo.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 20, 14),
    new THREE.MeshBasicMaterial({
      color: PALETTE.sun,
      transparent: true,
      opacity: 0.06,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.position.copy(sunPos);
  group.add(halo);

  // Volumetric shafts (open cones, apex up near canopy, widening downward).
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color('#ffe7ad') },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uTime;
      void main() {
        float v = vUv.y; // 1 at apex (top), 0 at base (bottom)
        float f = smoothstep(0.05, 0.5, v);
        f *= 1.0 - smoothstep(0.78, 1.0, v);
        float shim = 0.82 + 0.18 * sin(uTime * 1.5 + vUv.x * 22.0);
        gl_FragColor = vec4(uColor, f * 0.05 * shim);
      }`,
  });

  const shaftGeo = new THREE.ConeGeometry(3.0, 26, 14, 1, true);
  const SHAFTS = 10;
  for (let i = 0; i < SHAFTS; i++) {
    const m = new THREE.Mesh(shaftGeo, shaftMat);
    const a = Math.random() * Math.PI * 2;
    const rad = 2 + Math.random() * 11;
    m.position.set(
      clearing.x + Math.cos(a) * rad - 4,
      13 + Math.random() * 4,
      clearing.y + Math.sin(a) * rad
    );
    m.rotation.set(
      (Math.random() - 0.5) * 0.25,
      Math.random() * Math.PI,
      (Math.random() - 0.5) * 0.25
    );
    const s = 0.8 + Math.random() * 1.3;
    m.scale.set(s, 0.9 + Math.random() * 0.5, s);
    group.add(m);
  }

  scene.add(group);
  return {
    group,
    update(t) {
      shaftMat.uniforms.uTime.value = t;
    },
  };
}
