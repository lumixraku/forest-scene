import * as THREE from 'three';

// Palette sampled directly from the Protopop "Cozy Country" video frames.
const PALETTE = {
  fog: new THREE.Color('#9aa86c'),
  skyTop: new THREE.Color('#6f8460'),
  skyBottom: new THREE.Color('#b9bd8e'),
  sun: new THREE.Color('#ffe6a6'),
  ambSky: new THREE.Color('#a9b97e'),
  ambGround: new THREE.Color('#2f2c14'),
};

export function createWorld(scene) {
  // No fog — clean, crisp forest (user preference).
  scene.background = PALETTE.skyBottom.clone();

  // Soft gradient sky dome (mostly hidden behind canopy / fog).
  scene.add(makeSkyDome());

  // Fill light — bright sky bounce + lifted ground bounce so shadowed sides
  // of the foliage still read (no fog to lift them atmospherically).
  const hemi = new THREE.HemisphereLight(PALETTE.ambSky, new THREE.Color('#6a6438'), 4.5);
  scene.add(hemi);

  // Flat ambient to keep the deep greens visible without fog.
  scene.add(new THREE.AmbientLight(new THREE.Color('#82915f'), 3.0));

  // Warm sunlight pouring in from the clearing (ahead + above the camera).
  const sunPos = new THREE.Vector3(-8, 30, -40);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 3.5);
  sun.position.copy(sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 80;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
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
