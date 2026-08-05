import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { createWorld } from './world.js';
import { createParticles } from './particles.js';
import { createComposer } from './postprocess.js';
import { toonify } from './toon.js';
import { updateWind } from './wind.js';
import { streamCurve, levelAt, midT } from './streamPath.js';
import { createChunkManager } from './chunkManager.js';

// Randomness is seeded PER CHUNK rather than globally — see grid.js. The global
// override that used to live here made the layout reproducible only because the
// build ran in one fixed order at startup; chunks now stream in and out in an
// order that depends on where the camera goes, so a single global sequence would
// give the same patch of ground different contents on each visit.

// ---- renderer ----
// MSAA is inert here: EffectComposer renders the scene into its own render
// target, so a multisampled default framebuffer would only ever antialias
// OutputPass's fullscreen quad. Asking for it allocates a second full-size
// buffer that never antialiases anything.
// preserveDrawingBuffer exists only to grab canvas.toDataURL() for the README
// screenshots, and it keeps the browser from discarding the backbuffer every
// frame — so it's opt-in via ?capture instead of always on.
const CAPTURE = new URLSearchParams(location.search).has('capture');
// A retina dpr of 2 shades 4x the fragments of dpr 1. 1.5 keeps the foliage
// and water sparkle crisp for a bit over half the per-pixel cost.
const MAX_PIXEL_RATIO = 1.5;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The sun never moves and nothing is repositioned on the CPU — the only motion
// is the wind vertex shader, and its sway is far under one texel of a 1024 map
// stretched over the whole ~360m field. So the shadow map is rendered once at
// startup instead of re-drawing ~860k triangles every single frame.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ---- scene & camera ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);
// above a lower pool looking slightly down the terraced cascade, so the
// green pools show between the white steps (like the reference footage)
// The opening framing was authored against the original 300-unit scene, whose
// stream parameters now live in the middle third of a much longer curve — hence
// midT. Without it the camera would start a third of the way up the valley,
// looking at a stretch of brook it was never composed for.
const CAM_T = midT(0.36);
const LOOK_T = midT(0.58);
const camP = streamCurve.getPointAt(CAM_T);
const lookP = streamCurve.getPointAt(LOOK_T);
const LOOK = new THREE.Vector3(lookP.x, levelAt(LOOK_T) + 0.5, lookP.z);
camera.position.set(camP.x - 2, levelAt(CAM_T) + 7.0, camP.z + 8);
camera.lookAt(LOOK);

// ---- world (fog / lights / sky) ----
const world = createWorld(scene);

// ---- dust + birds ----
const particles = createParticles(scene, new THREE.Vector2(0, -16));

// ---- streamed world: ground, grass, forest, understory, water, per chunk ----
// Each chunk runs toonify over its own new meshes as it lands, and asks for one
// shadow-map refresh. toonify keeps a module-level record of what it has already
// patched, so the shared materials are only ever compiled once.
const chunks = createChunkManager(scene, camera, (built) => {
  // Patch only what just landed. toonify keeps a module-level record of the
  // materials it has already compiled, so this is about the traversal: walking the
  // whole scene on every step re-visits everything already built and gets more
  // expensive the more of the field exists.
  if (built) toonify(built);
  renderer.shadowMap.needsUpdate = true;
});

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
  particles.update(dt, t);
  controls.update();
  // Loads/unloads chunks, spends its frame budget building, and drives the water
  // and grass-density updates for whatever is currently resident.
  chunks.update(dt);
  // Shadow box and sky dome ride along with the camera; a move that crosses a
  // snap boundary needs one shadow-map re-render.
  if (world.follow(camera)) renderer.shadowMap.needsUpdate = true;
  world.sky.position.set(camera.position.x, 0, camera.position.z);
  composer.render();
  requestAnimationFrame(animate);
}
animate();
