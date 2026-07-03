import * as THREE from 'three';

// Bright summer daylight — near-white hazy sky, warm sun, soft distance fog,
// matching the airy look of the Cozy Country footage.
const PALETTE = {
  fog: new THREE.Color('#dfe9dc'),
  skyTop: new THREE.Color('#8fbede'),
  skyBottom: new THREE.Color('#eef4ea'),
  sun: new THREE.Color('#fff1d4'),
  ambSky: new THREE.Color('#dce9f2'),
  ambGround: new THREE.Color('#4a5530'),
};

export function createWorld(scene) {
  scene.background = PALETTE.skyBottom.clone();
  scene.fog = new THREE.Fog(PALETTE.fog, 70, 260);

  scene.add(makeSkyDome());

  // sky bounce + green ground bounce
  const hemi = new THREE.HemisphereLight(PALETTE.ambSky, PALETTE.ambGround, 1.9);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(new THREE.Color('#cfd8c2'), 0.55));

  // warm sun, high and slightly behind the view so the canopy is backlit
  const sunPos = new THREE.Vector3(45, 75, -55);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 3.0);
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
