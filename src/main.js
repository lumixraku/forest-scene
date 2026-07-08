import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { createWorld } from './world.js';
import { createGround } from './ground.js';
import { createGrass } from './grass.js';
import { createTrees } from './trees.js';
import { createFoliage } from './foliage.js';
import { createParticles } from './particles.js';
import { createStream } from './stream.js';
import { createComposer } from './postprocess.js';
import { updateWind } from './wind.js';
import { streamCurve, levelAt } from './streamPath.js';

// Deterministic randomness so the forest layout is identical on every load
// (makes the scene stable and tunable instead of reshuffling each reload).
(() => {
  let s = 20250614;
  Math.random = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ---- scene & camera ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);
// above a lower pool looking slightly down the terraced cascade, so the
// green pools show between the white steps (like the reference footage)
const camP = streamCurve.getPointAt(0.36);
const lookP = streamCurve.getPointAt(0.58);
const LOOK = new THREE.Vector3(lookP.x, levelAt(0.58) + 0.5, lookP.z);
camera.position.set(camP.x - 2, levelAt(0.36) + 7.0, camP.z + 8);
camera.lookAt(LOOK);

// ---- world (fog / lights / sky) ----
const world = createWorld(scene);

// ---- valley ground + instanced grass ----
scene.add(createGround());
const grass = createGrass(scene);

// ---- forest ----
createTrees(scene);

// ---- flowers + bushes ----
createFoliage(scene);

// ---- water + foam + boulders ----
const stream = createStream(scene);
scene.add(stream.group);

// ---- dust + birds ----
const particles = createParticles(scene, new THREE.Vector2(0, -16));

// ---- controls: free exploration ----
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.copy(LOOK);
controls.minDistance = 2;
controls.maxDistance = 260;
controls.maxPolarAngle = Math.PI * 0.56;
controls.update();

// ---- post-processing ----
const composer = createComposer(renderer, scene, camera);

// ---- WASD movement ----
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const UP = new THREE.Vector3(0, 1, 0);
function move(dt) {
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 26 : 13) * dt;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  const m = new THREE.Vector3();
  if (keys.KeyW || keys.ArrowUp) m.add(fwd);
  if (keys.KeyS || keys.ArrowDown) m.sub(fwd);
  if (keys.KeyD || keys.ArrowRight) m.add(right);
  if (keys.KeyA || keys.ArrowLeft) m.sub(right);
  if (m.lengthSq() > 0) {
    m.normalize().multiplyScalar(speed);
    camera.position.add(m);
    controls.target.add(m);
  }
}

// ---- resize ----
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---- animation loop ----
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  move(dt);
  updateWind(t);
  stream.update(dt);
  particles.update(dt, t);
  controls.update();
  grass.update(camera);
  composer.render();
  requestAnimationFrame(animate);
}
animate();
