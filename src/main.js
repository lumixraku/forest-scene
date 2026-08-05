import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { createWorld } from './world.js';
import { createGroundLayer } from './ground.js';
import { createStreaming } from './streaming.js';
import { createGrass } from './grass.js';
import { createTrees } from './trees.js';
import { createFoliage } from './foliage.js';
import { createParticles } from './particles.js';
import { createStream } from './stream.js';
import { createComposer } from './postprocess.js';
import { toonify, toonifyMaterials } from './toon.js';
import { updateWind } from './wind.js';
import { streamCurve, levelAt, HOME_T, LOOK_T } from './streamPath.js';
import { installGlobalRandom } from './rng.js';

// Deterministic randomness so the forest layout is identical on every load
// (makes the scene stable and tunable instead of reshuffling each reload).
installGlobalRandom();

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
// The shadow map is not redrawn every frame — the only per-frame motion is the
// wind vertex shader, whose sway is far under one shadow texel. It is refreshed
// on demand instead (see the loop at the bottom): when the camera has moved the
// shadow box far enough to matter, or when a streamed cell brings new casters.
// This is a change from rendering it exactly once at startup, which was only
// sound while the world was a fixed field that existed in full from frame one.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ---- scene & camera ----
const scene = new THREE.Scene();
// Far plane reaches past the ground/far-tree radius so the treeline runs to the
// horizon instead of being clipped mid-forest.
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1600);
// above a lower pool looking slightly down the terraced cascade, so the
// green pools show between the white steps (like the reference footage)
const camP = streamCurve.getPointAt(HOME_T);
const lookP = streamCurve.getPointAt(LOOK_T);
const LOOK = new THREE.Vector3(lookP.x, levelAt(LOOK_T) + 0.5, lookP.z);
camera.position.set(camP.x - 2, levelAt(HOME_T) + 7.0, camP.z + 8);
camera.lookAt(LOOK);

// ---- world (fog / lights / sky) ----
const world = createWorld(scene);

// ---- streaming world ----
// Layer radii, in world units. Each is a knob: how far out that layer exists.
// The ground and the far trees reach the horizon so there is never an empty
// skyline; the detailed layers stop where their detail stops being legible.
const RADIUS = {
  ground: 700,
  grass: 150,
  foliage: 220,
  treesNear: 260,
  treesFar: 700,
};

const streaming = createStreaming();
const ground = createGroundLayer(scene, { radius: RADIUS.ground });
streaming.register(ground.layer);
const grass = createGrass(scene, { radius: RADIUS.grass });
streaming.register(grass.layer);

// ---- forest ----
// Two tiers with disjoint species sets: the close-range broadleaves out to
// treesNear, and the background conifers on a coarser grid all the way to the
// horizon. See trees.js for why the sets must not overlap.
const trees = createTrees(scene);
streaming.register({ ...trees.layers[0], radius: RADIUS.treesNear });
// A coarser grid for the far tier: at 100m the horizon ring would be ~150 cells
// each holding several InstancedMeshes, which is hundreds of draw calls for trees
// a few pixels tall. Bigger cells trade culling precision for far fewer meshes.
streaming.register({ ...trees.layers[1], radius: RADIUS.treesFar, size: 350 });

// ---- flowers + bushes ----
const foliage = createFoliage(scene);
streaming.register({ ...foliage.layer, radius: RADIUS.foliage });

// ---- water + foam + boulders ----
const stream = createStream(scene);
scene.add(stream.group);

// ---- dust + birds ----
const particles = createParticles(scene, camera);

// ---- cel shading ----
// Must run after every scene module, since it patches the materials they built.
// This is where the crowns get their volume: the solid canopy texture is nearly
// one flat tone on purpose, and the warm-lit / cool-shadow split with a hard
// terminator is what turns each shell back into a readable form.
toonify(scene);
// Streaming layers have no geometry in the scene yet, so the traversal above
// cannot find their materials. They are shared across every cell, so handing them
// over once here covers all cells ever built.
toonifyMaterials([
  ground.material, grass.material, ...trees.materials, ...foliage.materials,
]);

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

// Handles for the headless-Chrome capture harness in .shot/ — it drives the
// camera and reads renderer.info to check draw calls, streaming and leaks.
// THREE is included so the harness can raycast and build vectors: it runs its
// code through Runtime.evaluate, where a bare 'three' specifier cannot resolve.
window.__scene = { scene, camera, renderer, controls, streaming, THREE, world };

// The shadow map is redrawn only when something that affects it changes: the
// camera moving the box, or a cell arriving with new casters in it. Rebuilding
// every frame would re-draw the whole visible forest into the depth map.
let shadowDirty = true;
streaming.onCellLoaded(() => { shadowDirty = true; });
const lastShadowPos = new THREE.Vector3(Infinity, 0, Infinity);
const SHADOW_STEP = 8; // redraw after this much camera travel

// ---- animation loop ----
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  move(dt);
  updateWind(t);
  streaming.update(camera);
  world.followSky(camera);
  stream.update(dt);
  particles.update(dt, t);
  controls.update();
  grass.update(camera);

  if (shadowDirty || lastShadowPos.distanceToSquared(camera.position) > SHADOW_STEP * SHADOW_STEP) {
    lastShadowPos.copy(camera.position);
    world.focusShadow(camera);
    renderer.shadowMap.needsUpdate = true;
    shadowDirty = false;
  }

  composer.render();
  requestAnimationFrame(animate);
}
animate();
