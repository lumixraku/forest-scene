import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCanopyWind, keepAuthoredNormals } from './wind.js';
import { bucketFor, addChunkedInstances } from './chunks.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, streamCurve, inWater } from './streamPath.js';
import { makeCanopyTexture, makeBarkTexture } from './textures.js';

// Storybook forest: every crown is a SOLID MASS, not a cloud of leaf cards.
//
// The crowns used to be tiers of whorled drooping cards, each carrying a fully
// drawn alpha-cut branch. Every card had its own jittered yaw, droop, length and
// tint, so a tree was a few hundred thin blades pointing in a few hundred
// directions: broken silhouette, no readable crown shape, and from any distance
// the whole forest dissolved into scraggle.
//
// Now a crown is a handful of overlapping lumpy spheroids ("blobs") stacked on a
// profile curve — cone, dome or umbrella depending on species. The silhouette
// comes from the geometry, so it is closed and legible; the leaves come from a
// fully OPAQUE canopy texture, so there is no alpha-test fringe and no overdraw.
// Three rules keep it from going messy again:
//   * blobs are yawed only, never pitched — the vertical squash stays horizontal
//     so the crown never shears into a lopsided pile
//   * one tint per TREE, not per blob, so a crown reads as a single mass
//   * ring radius and blob radius are locked in proportion, so neighbouring
//     blobs always overlap and the mass never opens up into separate balls
//
// Trunks are unchanged: thick noise-displaced cylinders with a root flare.
// Five species:
//   pagoda     — 小叶榄仁, the signature valley tree: pale straight trunk,
//                broad flat umbrella crown
//   pine       — mid-ground conifer, full cone from near the ground
//   high pine  — bare lower trunk with dead sticks, rounded crown held high
//   ginkgo     — pale bent trunks by the banks, golden domes
//   spruce     — darkest, tallest cones filling the background slopes
// Everything is InstancedMesh — 2-4 draw calls per species.
export function createTrees(scene) {
  const pagodaBark = makeBarkTexture({ base: '#aaa294', crack: 'rgba(48,42,34,1)', ridge: 'rgba(222,214,198,1)', knots: false });
  // Bark bases lifted a stop and warmed. A trunk stands under its own crown, so
  // it is nearly always on the shadow side of the terminator; at the old values
  // (#4f4338 / #453a32) every trunk in the frame collapsed into a black
  // silhouette and the forest read as bars rather than as wood.
  const pineBark = makeBarkTexture({ base: '#9c7f65', crack: 'rgba(56,44,32,1)', ridge: 'rgba(186,164,134,1)' });
  const highBark = makeBarkTexture({ base: '#a3856a', crack: 'rgba(58,44,30,1)', ridge: 'rgba(198,168,130,1)', knots: false });
  const spruceBark = makeBarkTexture({ base: '#8e7561', crack: 'rgba(48,36,26,1)', ridge: 'rgba(172,148,120,1)' });
  // ginkgo bark: grey-brown furrowed wood
  const ginkgoBark = makeBarkTexture({ base: '#b09678', crack: 'rgba(52,40,28,1)', ridge: 'rgba(208,188,158,1)', knots: false });

  // One canopy texture per palette, shared by every tree of that species.
  // Openwork crowns: leaves drawn on a transparent ground, so the gaps between
  // leaf clumps are real holes and the sky reads through the canopy. See
  // makeCanopyTexture — the shell geometry still owns the silhouette.
  // Lighter and warmer than the old noon greens. Under a low gold sun a deep
  // blue-green crown just goes black on the shadow side, and the frame fills with
  // dark holes; these sit high enough in value that the sky fill can still lift
  // the shadow face into a readable colour.
  // Every palette lifted well up in value and its internal contrast narrowed.
  // The old triples spanned roughly 30%-60% lightness, so even the lit face of a
  // crown averaged to a dark green, and three species stacked behind each other
  // became one dark mass. In the reference the crowns are BRIGHT and their
  // internal range is narrow — the volume comes from the lighting split between
  // one crown's lit and shadow faces, not from dark leaves inside the texture.
  const PIERCE = { pierce: true };
  const pineTex = makeCanopyTexture(['#6f9243', '#84a850', '#9cc061'], PIERCE);
  const highTex = makeCanopyTexture(['#79994a', '#8fb057', '#a7c76a'], PIERCE);
  const darkTex = makeCanopyTexture(['#5f8442', '#75994e', '#8db35f'], PIERCE);
  const ginkgoTex = makeCanopyTexture(['#d9a72c', '#eec244', '#fbdb6d'], PIERCE);
  const pagodaTex = makeCanopyTexture(['#74994a', '#8bb057', '#a3c869'], PIERCE);

  // ---- pagoda (小叶榄仁) — broad flat umbrella, the signature tree ----
  const pagodas = placeSpecies({
    count: 70, minD: 10, maxD: 100, sRange: [0.9, 1.4],
    // hand-placed trees framing the opening camera view from both banks
    fixed: [{ x: -26, z: -24.5, s: 1.25 }, { x: -13, z: -2.5, s: 1.35 }],
  });
  addTrunks(scene, pagodas, makeTrunkGeo({ topR: 0.13, botR: 0.4, h: 11.8, flare: 3.4 }), pagodaBark);
  addCanopy(scene, pagodas, pagodaTex, {
    crownBase: 3.4, crownTop: 12.4, radius: 3.4,
    profile: 'umbrella',
    // These tints MULTIPLY the canopy texture, so a low `light` cancels out the
    // lighter palettes above — that is exactly what was happening: bright leaves
    // authored in the texture, then multiplied back down to dark here. `light`
    // now sits near 1 and the saturation range is narrow, so the tint separates
    // one tree from its neighbour without dimming any of them.
    hue: 0.22, sat: 0.22, light: 0.9,
  });

  // ---- pine — mid-ground conifer, full cone from near the ground ----
  const pines = placeSpecies({ count: 90, minD: 16, maxD: 130, sRange: [0.85, 1.4] });
  addTrunks(scene, pines, makeTrunkGeo({ topR: 0.11, botR: 0.4, h: 12, flare: 3.2 }), pineBark);
  addCanopy(scene, pines, pineTex, {
    crownBase: 2.0, crownTop: 13.4, radius: 2.7,
    profile: 'cone',
    hue: 0.25, sat: 0.24, light: 0.88,
  });

  // ---- high pine — bare mossy trunk, crown held high, dead sticks ----
  const highPines = placeSpecies({ count: 45, minD: 20, maxD: 110, sRange: [0.9, 1.4] });
  addTrunks(scene, highPines, makeTrunkGeo({ topR: 0.09, botR: 0.34, h: 14.5, flare: 2.8 }), highBark);
  addDeadSticks(scene, highPines, highBark);
  addCanopy(scene, highPines, highTex, {
    crownBase: 5.6, crownTop: 15.8, radius: 2.9,
    profile: 'dome',
    hue: 0.23, sat: 0.22, light: 0.92,
  });

  // ---- ginkgo — pale bent trunks near the banks, golden domes ----
  // sRange is much smaller than it used to be: the old card crowns only filled a
  // fraction of their nominal radius, so the ginkgo was scaled up to compensate.
  // A solid dome fills all of it, and at the old scale these became 13m golden
  // balloons that swallowed the foreground.
  const ginkgos = placeSpecies({
    count: 38, minD: 12, maxD: 45, sRange: [0.85, 1.25],
    fixed: [{ x: -30, z: -0.5, s: 1.2 }, { x: -16, z: -26, s: 1.15 }],
  });
  addTrunks(scene, ginkgos, makeTrunkGeo({ topR: 0.14, botR: 0.4, h: 8.6, flare: 2.6, bend: 0.4 }), ginkgoBark);
  addCanopy(scene, ginkgos, ginkgoTex, {
    crownBase: 2.6, crownTop: 9.6, radius: 2.7,
    profile: 'dome',
    // Held below the greens. Gold at the same brightness as the canopy around it
    // stops being an accent — 38 ginkgos lit to 0.94 read as half the forest
    // being autumn, which is not what the banks are for.
    hue: 0.13, sat: 0.26, light: 0.82,
  });

  // ---- spruce — darkest, tallest cones on the background slopes ----
  const spruces = placeSpecies({ count: 110, minD: 48, maxD: 140, sRange: [0.7, 1.45] });
  addTrunks(scene, spruces, makeTrunkGeo({ topR: 0.08, botR: 0.46, h: 17, flare: 2.8 }), spruceBark);
  addCanopy(scene, spruces, darkTex, {
    crownBase: 1.8, crownTop: 18.4, radius: 2.8,
    profile: 'cone',
    // The background species, so it stays the coolest and slightly the deepest of
    // the five — but only slightly. This is the one that used to turn the far
    // slopes into a black wall.
    hue: 0.28, sat: 0.24, light: 0.84,
  });
}

// Global tree scale — trees tower over the grass and bushes; every species'
// trunk, branches and crown all run through the per-tree `s`.
const TREE_SCALE = 2;

// Rejection-sampled placements along the stream distance bands. The forest
// thickens away from the water, and the opening camera position stays clear
// so a random tree never spawns right in front of the initial view.
function placeSpecies({ count, minD, maxD, sRange, fixed = [] }) {
  // the hand-placed framing trees get the same water test as the scattered ones:
  // their coordinates were authored against a channel a few units wide, and the
  // pools have since opened out far enough to swallow some of them
  const trees = fixed
    .filter((f) => !inWater(f.x, f.z, 1.2))
    .map((f) => ({ x: f.x, z: f.z, rot: Math.random() * Math.PI * 2, s: f.s * TREE_SCALE }));
  const camP = streamCurve.getPointAt(0.36);
  const camX = camP.x - 2, camZ = camP.z + 8;

  let attempts = 0;
  while (trees.length < count && attempts < count * 40) {
    attempts++;
    const x = (Math.random() - 0.5) * 290;
    const z = (Math.random() - 0.5) * 290;
    if ((x - camX) * (x - camX) + (z - camZ) * (z - camZ) < 15 * 15) continue;
    const { d: sd, t } = streamAt(x, z);
    if (sd < minD || sd > maxD) continue;
    const keep = THREE.MathUtils.clamp((sd - minD) / 40 + 0.35, 0, 1);
    if (Math.random() > keep) continue;
    const h = terrainHeight(x, z);
    if (h < levelAt(t) + 0.5) continue;
    if (inWater(x, z, 1.2)) continue; // no trees standing in the pools
    trees.push({
      x, z,
      rot: Math.random() * Math.PI * 2,
      s: (sRange[0] + Math.random() * (sRange[1] - sRange[0])) * TREE_SCALE,
    });
  }
  return trees;
}

// Thick tapered trunk with knobbly radial noise and a root flare spreading
// into the ground; optional bend curves the whole stem (broadleaf).
//
// The stem is open-ended and narrows to a point at the very top. A plain
// cylinder is a trapezoid in profile, so its flat top cap sat exposed above the
// crown and read as a sawn-off stump — most obvious on pagoda and ginkgo, the
// two species with no spire cap over the topmost branch tier, and only visible
// from canopy height (from the ground the crown hides it). Both caps can go:
// the base is buried 0.25 below the terrain, and the top is now a tip.
function makeTrunkGeo({ topR, botR, h, flare = 3.5, bend = 0 }) {
  const g = new THREE.CylinderGeometry(topR, botR, h, 14, 10, true);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const dir = Math.random() * Math.PI * 2;
  const bx = Math.cos(dir) * bend, bz = Math.sin(dir) * bend;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / h;
    const ang = Math.atan2(v.z, v.x);
    const lump = 1 + (Math.sin(ang * 3 + v.y * 0.8) * 0.5 + Math.sin(ang * 5 + 1.7 + v.y * 0.35) * 0.5) * 0.07;
    const fl = t < 0.08 ? 1 + (0.08 - t) * flare * (0.55 + 0.45 * Math.sin(ang * 5 + 1.3)) : 1;
    // radius fades out over the top stretch so the stem ends as a tip; the bend
    // offset shifts the axis itself, so it must not be tapered with it
    const tip = t > 0.82 ? Math.max(0, (1 - t) / 0.18) : 1;
    pos.setX(i, v.x * lump * fl * tip + bx * t * t);
    pos.setZ(i, v.z * lump * fl * tip + bz * t * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Trunks/sticks/spires are only a few percent of the frame's triangles, so they
// stay one mesh per species — chunking them would cost more in draw calls than
// it saves in geometry. computeBoundingSphere() replaces the old
// `frustumCulled = false`: instance-aware bounds mean culling is correct, so
// there's no reason to opt out of it.
function addTrunks(scene, trees, geo, barkTex) {
  const mat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  trees.forEach((tr, i) => {
    dummy.position.set(tr.x, terrainHeight(tr.x, tr.z) - 0.25, tr.z);
    dummy.rotation.set((Math.random() - 0.5) * 0.07, tr.rot, (Math.random() - 0.5) * 0.07);
    dummy.scale.set(tr.s, tr.s, tr.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

// Short dead branch stubs angling down off the bare lower trunks.
function addDeadSticks(scene, trees, barkTex) {
  if (trees.length === 0) return;
  const PER = 7;
  const geo = new THREE.CylinderGeometry(0.015, 0.055, 2.4, 5, 1);
  geo.translate(0, 1.2, 0);
  const mat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length * PER);
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  let m = 0;
  for (const tr of trees) {
    const yBase = terrainHeight(tr.x, tr.z);
    for (let i = 0; i < PER; i++) {
      const h = (2 + Math.random() * 4.8) * tr.s;
      const a = Math.random() * Math.PI * 2;
      const rad = (0.55 - (h / (14.5 * tr.s)) * 0.4) * tr.s * 0.8;
      dummy.position.set(tr.x + Math.cos(a) * rad, yBase + h, tr.z + Math.sin(a) * rad);
      dummy.rotation.set((Math.random() - 0.5) * 0.4, -a, -(Math.PI / 2 - 0.35 - Math.random() * 0.5));
      const k = (0.5 + Math.random() * 0.6) * tr.s;
      dummy.scale.set(k, k, k);
      dummy.updateMatrix();
      mesh.setMatrixAt(m++, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

// Crown silhouette: horizontal radius (0-1) at height fraction t, measured from
// the crown base to its tip. Both ends MUST return 0 so the lathe surface closes
// into a solid without a cap seam. These curves are the entire visual difference
// between the species.
const smoothstep = (e0, e1, x) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const CROWN_PROFILES = {
  // conifer: flares out just above the base, then tapers all the way to a point
  cone: (t) => Math.pow(1 - t, 0.85) * smoothstep(0, 0.16, t),
  // broadleaf: a ball — pinched where it meets the trunk, generous over the top
  dome: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.82)), 0.8),
  // pagoda: a wide flat plate that reaches full width low and holds it
  umbrella: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.55),
};

// One closed crown shell, as a lathe of the species' profile curve.
//
// The obvious way to build a solid crown is to pile up spheroids, and it does not
// work: a blob big enough to matter is also big enough to READ, so the crown
// turns into a knot of bulbous lobes — cauliflower, not foliage. The silhouette
// has to come from a single surface instead, with the noise kept small and
// high-frequency so it only ruffles the edge rather than growing lumps out of it.
//
// The lathe is 1 unit tall with radius 1, so the caller scales it by (R, H, R).
// Lathe uvs run u around the axis and v up it, which is exactly what the
// seamless-in-u canopy texture wants.
function makeCrownGeo(profileName) {
  const profile = CROWN_PROFILES[profileName];
  const STEPS = 17, SEGS = 22;
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    pts.push(new THREE.Vector2(Math.max(profile(t), 1e-4), t));
  }
  const g = new THREE.LatheGeometry(pts, SEGS);

  // Barely ruffle the surface: two high-frequency octaves at ~3% of the radius.
  // The shape must still read as the primitive it is — a cone is a cone. This is
  // only here so the edge is not perfectly machined; push it past ~0.06 and the
  // lobes start growing back.
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const phase = Math.random() * 10;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const n = Math.sin(a * 6 + v.y * 9 + phase) * 0.6 + Math.sin(a * 11 - v.y * 13 + phase * 2.3) * 0.4;
    const f = 1 + n * 0.032;
    pos.setXYZ(i, v.x * f, v.y, v.z * f);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// A crown per tree: one instance of one closed shell. Three shape variants per
// species, dealt out round-robin, so neighbouring trees are not clones.
function addCanopy(scene, trees, tex, p) {
  const variants = [makeCrownGeo(p.profile), makeCrownGeo(p.profile), makeCrownGeo(p.profile)];
  // Openwork, so alphaTest + DoubleSide: without the back faces you see straight
  // through the holes to nothing and the crown reads as an empty husk; with them
  // the shell's far wall shows through its own gaps, which is what gives the mass
  // depth. keepAuthoredNormals stops three.js flipping the normal on those back
  // faces and turning them black.
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });
  applyCanopyWind(mat, { strength: 0.13, freq: 1.1 });
  keepAuthoredNormals(mat);
  // toonify() gives leaf surfaces a translucency floor so the crown's unlit
  // inner wall glows rather than going black; nothing else in the scene wants it.
  mat.userData.canopy = true;
  // Shadows must respect the holes too, or an openwork crown casts a solid
  // ellipse on the ground and gives the whole trick away.
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: tex,
    alphaTest: 0.42,
  });

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  // one bucket set per variant: instances of one InstancedMesh must share geometry
  const buckets = variants.map(() => new Map());

  trees.forEach((tr, i) => {
    const bucket = bucketFor(buckets[i % variants.length], tr.x, tr.z);
    const yBase = terrainHeight(tr.x, tr.z);
    dummy.position.set(tr.x, yBase + p.crownBase * tr.s, tr.z);
    dummy.rotation.set(0, tr.rot + Math.random() * Math.PI * 2, 0);
    const R = p.radius * tr.s * (0.88 + Math.random() * 0.24);
    dummy.scale.set(R, (p.crownTop - p.crownBase) * tr.s * (0.9 + Math.random() * 0.2), R);
    dummy.updateMatrix();
    bucket.mats.push(dummy.matrix.clone());
    // one tint per tree — a crown has to read as a single object, so the colour
    // variation lives between trees, never within one crown
    // Tint spread stays small in every channel. This multiplies the texture, so
    // the only job here is telling one crown from the next — a wide lightness
    // range means some crowns come out visibly dark, which is what broke up the
    // canopy into a patchwork before.
    col.setHSL(
      p.hue + (Math.random() - 0.5) * 0.03,
      (p.sat ?? 0.24) + (Math.random() - 0.5) * 0.08,
      p.light + (Math.random() - 0.5) * 0.07
    );
    bucket.cols.push(col.clone());
  });

  // Chunked for the same reason the branch cards were: one field-wide mesh has
  // field-wide bounds and can never be frustum culled.
  variants.forEach((geo, i) => {
    addChunkedInstances(scene, buckets[i], geo, mat, {
      castShadow: true,
      receiveShadow: true,
      depthMat,
    });
  });
}

// Lumpy squashed sphere the leaf-disc texture wraps around. Vertices are
// merged before displacing so the normals smooth across facets instead of
// reading as a low-poly rock. Also used by the foliage grass-ball bushes.
export function makeBlobGeo() {
  const raw = new THREE.IcosahedronGeometry(0.55, 2);
  raw.deleteAttribute('uv'); // per-face uvs block vertex merging
  const g = mergeVertices(raw);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 4.2 + 9 + v.y * 4.2 + v.z * 3.2) * 0.5 + Math.sin(v.y * 7.5 + v.x * 5.5) * 0.5;
    const f = 1 + n * 0.34;
    pos.setXYZ(i, v.x * f, v.y * f * 0.82, v.z * f);
    // simple spherical wrap — the leaf texture is busy enough to hide the seam
    uvs[i * 2] = Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5;
    uvs[i * 2 + 1] = v.y / 1.1 + 0.5;
  }
  pos.needsUpdate = true;
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}
