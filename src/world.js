import * as THREE from 'three';

// Late golden hour, sun low and almost in frame — the light the stylised-RPG
// look is actually built on.
//
// This scene used to be a blazing 2-3pm: hot white sun overhead, saturated blue
// zenith, and a near-white haze. That is the single biggest reason it read as
// harsh no matter what the trees did. Overhead light lands flat on top of every
// crown and leaves the sides in deep contrast, so a forest becomes a field of
// dark lumps with bright caps.
//
// The three things that make the reference look, in order of how much they
// matter:
//   1. WARM KEY FROM A MID HEIGHT. Not overhead, not grazing. A sun on the
//      horizon sounds right for "golden hour", but every horizontal surface —
//      meadow, crown tops, the water — then receives cos(12°) ≈ 0.2 of the key
//      and the whole frame falls to the shadow side of the terminator. That is
//      what made this scene read as cold dusk. ~35° keeps the ground and the
//      tops of the crowns in the warm plateau while still raking the crown
//      sides enough to give them a lit face, a shadow face, and a rim.
//   2. STRONG COOL SKY FILL. The shadow side is lit by a big violet-blue sky,
//      not merely darkened. Shadows stay open and readable — this is why the
//      style never has a black hole anywhere in frame.
//   3. GOLD PINNED TO THE HORIZON. The warm band has to sit AT the skyline and
//      give way to blue quickly, so the treeline is backed by light. Spread the
//      same two colours evenly over the dome instead and you get the pale
//      nothing-coloured sky this had.
// There is deliberately NO fog. Haze is the usual way to buy aerial perspective,
// but it washes the distance into a flat milky band, so depth here has to come
// from the light split and the crowns' own value range instead.
const PALETTE = {
  skyTop: new THREE.Color('#4b8fce'),
  // Pale aqua band between the warm horizon and the blue zenith. Without this
  // middle stop the two-colour ramp mixes gold straight into blue and passes
  // through a dead grey-green on the way, which is exactly the washed-out band
  // the sky had before.
  skyMid: new THREE.Color('#a8d0e4'),
  // Deeper than it looks: ACES tone mapping at exposure 1.32 pulls the top of
  // this ramp towards white, so a lighter cream here washes the whole horizon
  // out to paper instead of reading as low sun.
  skyBottom: new THREE.Color('#f7c983'),
  // warm sun through low atmosphere: amber, not white
  sun: new THREE.Color('#ffd9a0'),
  // cool violet-blue sky fill, the other half of the warm/cool split
  ambSky: new THREE.Color('#a8bfe8'),
  ambGround: new THREE.Color('#8a7a4a'),
};

// Half-width of the sun's shadow box, in world units. 110 covers well past the
// grass radius while keeping a 1024 map at ~0.21 units per texel.
const SHADOW_EXTENT = 110;
// How far up the sun direction the light sits. Must clear the tallest crown plus
// the terrain relief, or near casters fall outside the depth slab.
const SHADOW_BACK_OFF = 260;

export function createWorld(scene) {
  scene.background = PALETTE.skyBottom.clone();
  // No fog. Depth comes from the crowns' own value range and the warm/cool light
  // split instead — haze washing out the distance is not wanted here.

  const sky = makeSkyDome();
  scene.add(sky);

  // Cool sky fill: the shadow side has to stay open and readable, and it has to
  // be a DIFFERENT HUE from the sun rather than a darker version of it. Backed
  // off from 1.7 now that the key actually reaches the ground — at 1.7 the fill
  // out-voted the sun on every up-facing surface and pushed `t` in the cel
  // shader below the terminator across the whole meadow.
  const hemi = new THREE.HemisphereLight(PALETTE.ambSky, PALETTE.ambGround, 1.3);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(new THREE.Color('#cdd4ea'), 0.34));

  // Sun ahead of the camera so the light comes towards us and backlights the
  // stream, but ~35° up rather than on the horizon: high enough that ground and
  // crown tops sit in the warm plateau, low enough that the crown sides still
  // turn through a terminator instead of being uniformly capped.
  const sunPos = new THREE.Vector3(60, 92, -120);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  // The shadow box FOLLOWS THE CAMERA rather than covering a fixed field.
  //
  // It used to be a static ±180 box, which worked only because the world was a
  // fixed 300m and everything in it existed from startup. Neither holds now: the
  // world is unbounded, and stretching one 1024 map over it would leave about a
  // texel per metre — shadows so coarse they read as dirt. A ±SHADOW_EXTENT box
  // tracking the camera gives a texel every ~0.2m, which is sharper than the
  // original, at the cost of only shadowing the camera's neighbourhood — where
  // shadows are legible anyway.
  const s = SHADOW_EXTENT;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  // A grazing sun throws long shadows, so the slab has to be deep enough that
  // casters behind the box still reach into it; anything outside silently stops
  // casting. SHADOW_BACK_OFF is how far up the sun direction the light sits.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SHADOW_BACK_OFF * 2;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.2;
  scene.add(sun);
  scene.add(sun.target);

  // Direction from the target to the light, normalised once.
  const sunDir = sunPos.clone().normalize();

  // Re-aim the shadow box at a point in front of the camera. Looking ahead rather
  // than straight down means the box is spent on what is actually in frame, not
  // on the half of it behind the viewer.
  const aim = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  // The dome is centred on the camera. It has to be bigger than the far plane to
  // stay behind everything, which means it cannot also be a fixed object in the
  // world — the camera would eventually walk out through its shell.
  function followSky(camera) {
    sky.position.set(camera.position.x, 0, camera.position.z);
  }

  function focusShadow(camera) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    aim.copy(camera.position).addScaledVector(fwd, SHADOW_EXTENT * 0.55);
    aim.y = 0;
    sun.target.position.copy(aim);
    sun.target.updateMatrixWorld();
    sun.position.copy(aim).addScaledVector(sunDir, SHADOW_BACK_OFF);
    sun.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
  }

  return { sun, sunPos, hemi, PALETTE, focusShadow, followSky, SHADOW_EXTENT };
}

// Dome radius. It has to sit BEYOND the furthest content (the ground and far
// trees reach 700) and INSIDE the camera's far plane of 1600, or it is clipped
// away entirely and the flat scene.background shows through instead of the
// gradient — which reads as a washed-out sky and drags the whole frame's
// exposure with it. Since the dome follows the camera it never needs to be
// larger than that; only a world-fixed dome would have to span the map.
const SKY_RADIUS = 1200;

function makeSkyDome() {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: PALETTE.skyTop },
      mid: { value: PALETTE.skyMid },
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
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      void main() {
        // vH is -1..1; remap so 0 is the horizon and only the lowest slice of
        // the dome is gold. The old pow(vH*0.5+0.5, 0.7) put the halfway colour
        // ~40 degrees up, which smeared the warm band over most of the visible
        // sky and left nothing bright behind the treeline.
        float h = clamp(vH, 0.0, 1.0);
        vec3 c = mix(bottom, mid, smoothstep(0.0, 0.2, h));
        c = mix(c, top, smoothstep(0.13, 0.55, h));
        // below the horizon the dome keeps the warm horizon colour, so the
        // ground plane never meets a band of blue at its far edge
        c = mix(c, bottom, smoothstep(0.0, -0.05, vH));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}
