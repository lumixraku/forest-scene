import * as THREE from 'three';

// Blazing summer afternoon (~2-3pm) — saturated blue sky, hot near-white sun
// high overhead, crisp short shadows, only a faint warm heat-haze far away.
const PALETTE = {
  fog: new THREE.Color('#e9edd2'),
  skyTop: new THREE.Color('#3f8edd'),
  skyBottom: new THREE.Color('#cfe6f2'),
  sun: new THREE.Color('#fff0c4'),
  ambSky: new THREE.Color('#bcd8ee'),
  ambGround: new THREE.Color('#5a6030'),
};

export function createWorld(scene) {
  scene.background = PALETTE.skyBottom.clone();
  // faint heat-haze only in the far distance — no morning mist
  scene.fog = new THREE.Fog(PALETTE.fog, 180, 480);

  scene.add(makeSkyDome());

  // sky bounce + warm green ground bounce
  const hemi = new THREE.HemisphereLight(PALETTE.ambSky, PALETTE.ambGround, 1.35);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(new THREE.Color('#d8dcb8'), 0.35));

  // hot sun almost overhead, slightly ahead for a shimmering backlit stream
  const sunPos = new THREE.Vector3(30, 115, -40);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 4.4);
  sun.position.copy(sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const s = 95;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 240;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  return { sun, sunPos, hemi, PALETTE };
}

function makeSkyDome() {
  const geo = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: PALETTE.skyTop },
      bottom: { value: PALETTE.skyBottom },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float vH;
      uniform vec3 top; uniform vec3 bottom;
      void main() {
        float t = pow(clamp(vH * 0.5 + 0.5, 0.0, 1.0), 0.7);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}
