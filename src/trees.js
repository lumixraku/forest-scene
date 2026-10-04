import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCanopyWind, keepAuthoredNormals } from './wind.js';
import { cellSeed, withSeed } from './rng.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt, streamCurve, inWater, HOME_T } from './streamPath.js';
import { makeLeafClumpTexture, makeBarkTexture } from './textures.js';

// Genshin / BotW-style crowns: a crown is a handful of leaf LUMPS laid over the
// species' profile (dome or umbrella), and each lump is a puff of
// camera-facing leaf-clump cards.
//
// The two things that make that style read, and why the old shell crowns could
// not:
//   * the silhouette is made of leaf tips — scalloped and soft — not a lathe
//     surface with a texture wrapped on it, which reads as a balloon
//   * the normals are AUTHORED, half from the lump and half from the crown's
//     own ellipsoid. So the whole crown turns through one big terminator while
//     every lump still has its own lit cap and shadowed underside. That nested
//     light split is most of what people recognise as "the Genshin tree".
// Rules that keep it legible:
//   * lumps overlap — their radius is locked to the crown radius
//   * one tint per TREE, not per lump, so a crown reads as a single mass
//   * interior / underside cards are darkened in the vertex colour (baked AO),
//     which gives the crown depth without any extra lights
//
// Trunks are unchanged: thick noise-displaced cylinders with a root flare.
// Species:
//   pagoda     — 小叶榄仁, the signature valley tree: pale straight trunk,
//                broad flat umbrella crown
//   high pine  — the tallest broad crown, foliage most of the way down
//   ginkgo     — pale bent trunks by the banks, golden domes
//   maples     — red and orange autumn accents
//   deep       — deep-green broadleaf filling the background slopes
// The cone conifers (pine, spruce) were removed: as clump crowns they read as
// tall poles studded with floating tufts.
// Everything is InstancedMesh — 2-4 draw calls per species.
//
// Trees are built one cell at a time as the camera moves, in TWO tiers with
// DISJOINT species sets:
//
//   near (pagoda, high pine, ginkgo, maples) — the close-range species, 260 units
//   far  (deep)                              — the background species, out to the horizon
//
// Disjointness is the whole reason this is safe. The obvious split — "near tier
// draws everything, far tier draws the cheap subset" — makes both tiers place the
// same spruce in the same cell, so the near field gets double trees; and any tier
// whose species set changes with distance makes trees appear and vanish as the
// boundary sweeps past. With no species in both tiers, neither can happen.
//
// The cost of a finite radius is that pagodas/ginkgos fade in at 260 units. They
// are held to within 45-110 units of the STREAM by their own minD/maxD, so they
// were never a horizon feature; the horizon is the deep broadleaf, which is what
// the far tier carries.
export function createTrees(scene) {
  const pagodaBark = makeBarkTexture({ base: '#aaa294', crack: 'rgba(48,42,34,1)', ridge: 'rgba(222,214,198,1)', knots: false });
  // Bark bases lifted a stop and warmed. A trunk stands under its own crown, so
  // it is nearly always on the shadow side of the terminator; at the old values
  // (#4f4338 / #453a32) every trunk in the frame collapsed into a black
  // silhouette and the forest read as bars rather than as wood.
  const highBark = makeBarkTexture({ base: '#a3856a', crack: 'rgba(58,44,30,1)', ridge: 'rgba(198,168,130,1)', knots: false });
  // ginkgo bark: grey-brown furrowed wood
  const ginkgoBark = makeBarkTexture({ base: '#b09678', crack: 'rgba(52,40,28,1)', ridge: 'rgba(208,188,158,1)', knots: false });
  // maple bark: greyer and slightly cooler than the conifers, so a red crown does
  // not sit on a trunk that is already warm and lose its contrast
  const mapleBark = makeBarkTexture({ base: '#9a8b7d', crack: 'rgba(46,38,32,1)', ridge: 'rgba(200,188,172,1)' });
  const deepBark = makeBarkTexture({ base: '#8d7660', crack: 'rgba(46,36,26,1)', ridge: 'rgba(176,154,126,1)' });

  // One leaf-clump texture per palette, shared by every tree of that species.
  // Each is a single round tuft of leaves; the crown is built from a few hundred
  // camera-facing cards carrying it (see makeClumpCrownGeo).
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
  // Hues pulled back toward true green. The previous set sat around 80-90 degrees
  // — yellow-green — which under a warm sun left the whole canopy the same family
  // as the gold ginkgos, so nothing in the frame read as green and the golds
  // stopped being accents. These sit nearer 100 degrees and keep the value lift.
  const highTex = makeLeafClumpTexture(['#5c9246', '#73aa56', '#90c46a'], { leaf: 'needle' });
  // Ginkgo now draws real fan leaves rather than the generic pointed oval — the
  // one leaf shape distinctive enough to be worth recognising at close range.
  const ginkgoTex = makeLeafClumpTexture(['#d9a72c', '#eec244', '#fbdb6d'], { leaf: 'fan' });
  const pagodaTex = makeLeafClumpTexture(['#61964a', '#77ac58', '#8fc46a']);
  // ---- the autumn accents ----
  // Two new palettes, both on five-lobed maple leaves. Scarlet is the loud one and
  // is kept rare; amber sits between the scarlet and the golds so the warm end of
  // the frame has a middle step instead of jumping from gold straight to red.
  const mapleRedTex = makeLeafClumpTexture(['#a8321f', '#c8492a', '#e06a3c'], { leaf: 'maple' });
  const mapleOrangeTex = makeLeafClumpTexture(['#c26a18', '#dd8a26', '#efab45'], { leaf: 'maple' });
  // A deep-green broadleaf. Not an accent — this is the anchor that keeps the
  // canopy from turning into all-autumn once the warm species are in.
  const deepTex = makeLeafClumpTexture(['#2f6136', '#3d7844', '#519055']);

  // Every species' shared assets, built ONCE here rather than per cell: the trunk
  // profile, the three crown lathe variants, and the materials. A cell only ever
  // produces instance matrices, which is what makes streaming them cheap.
  //
  // `density` is attempts per square metre, measured against the original
  // 290x290 field rather than derived from the nominal counts — the accept rate
  // varies a lot by species (ginkgo 15%, pine 74%), so attempts is the number a
  // per-area sampler needs. Achieved counts over that field: pagoda 70, pine 90,
  // high 45, ginkgo 38, spruce 110 — i.e. all five reached their nominal count,
  // so near-field density is unchanged by construction.
  const SPECIES = {
    // ---- pagoda (小叶榄仁) — broad flat umbrella, the signature tree ----
    pagoda: {
      density: 0.00153, minD: 10, maxD: 100, sRange: [0.9, 1.4],
      // hand-placed trees framing the opening camera view from both banks
      fixed: [{ x: -26, z: -24.5, s: 1.25 }, { x: -13, z: -2.5, s: 1.35 }],
      trunk: { topR: 0.13, botR: 0.4, h: 11.8, flare: 3.4 },
      bark: pagodaBark,
      tex: pagodaTex,
      crown: {
        crownBase: 3.4, crownTop: 12.4, radius: 3.4,
        profile: 'umbrella',
        // These tints MULTIPLY the canopy texture, so a low `light` cancels out the
        // lighter palettes above — that is exactly what was happening: bright leaves
        // authored in the texture, then multiplied back down to dark here. `light`
        // now sits near 1 and the saturation range is narrow, so the tint separates
        // one tree from its neighbour without dimming any of them.
        hue: 0.27, sat: 0.22, light: 0.9,
      },
    },

    // ---- high pine — tall, with foliage running most of the way down ----
    // The crown used to start 40% up a bare trunk hung with dead sticks. With
    // the clump crowns that read as a pole with a few puffs at the top, so the
    // crown now starts low and the sticks (hidden inside it anyway) are gone.
    high: {
      density: 0.00094, minD: 20, maxD: 110, sRange: [0.9, 1.4],
      trunk: { topR: 0.09, botR: 0.34, h: 14.5, flare: 2.8 },
      bark: highBark,
      tex: highTex,
      crown: {
        crownBase: 2.6, crownTop: 15.8, radius: 2.9,
        profile: 'dome',
        hue: 0.28, sat: 0.22, light: 0.92,
      },
    },

    // ---- ginkgo — pale bent trunks near the banks, golden domes ----
    // sRange is much smaller than it used to be: the old card crowns only filled a
    // fraction of their nominal radius, so the ginkgo was scaled up to compensate.
    // A solid dome fills all of it, and at the old scale these became 13m golden
    // balloons that swallowed the foreground.
    ginkgo: {
      density: 0.00300, minD: 12, maxD: 45, sRange: [0.85, 1.25],
      fixed: [{ x: -30, z: -0.5, s: 1.2 }, { x: -16, z: -26, s: 1.15 }],
      trunk: { topR: 0.14, botR: 0.4, h: 8.6, flare: 2.6, bend: 0.4 },
      bark: ginkgoBark,
      tex: ginkgoTex,
      crown: {
        crownBase: 2.6, crownTop: 9.6, radius: 2.7,
        profile: 'dome',
        // Held below the greens. Gold at the same brightness as the canopy around it
        // stops being an accent — 38 ginkgos lit to 0.94 read as half the forest
        // being autumn, which is not what the banks are for.
        hue: 0.13, sat: 0.26, light: 0.82, hueVar: 0.03,
      },
    },

    // ---- red maple — the loud accent, deliberately sparse ----
    // Density is a third of the pagoda's on purpose. A scarlet crown carries far
    // more attention than its area suggests, so matching the greens' density here
    // would read as an autumn scene rather than a green valley with autumn in it.
    // Held wide of the water like the pagodas so the reds spread across the slope
    // instead of lining the banks.
    mapleRed: {
      density: 0.00048, minD: 14, maxD: 105, sRange: [0.85, 1.3],
      trunk: { topR: 0.12, botR: 0.38, h: 10.6, flare: 3.0, bend: 0.25 },
      bark: mapleBark,
      tex: mapleRedTex,
      crown: {
        crownBase: 3.0, crownTop: 11.4, radius: 3.1,
        profile: 'dome',
        // Red is the one hue where the texture cannot carry the colour alone: the
        // instance tint multiplies it, and any green in the tint would mud it. Hue
        // sits at the warm end and `light` stays below the greens so the crown
        // reads as saturated rather than pink.
        hue: 0.035, sat: 0.34, light: 0.8, hueVar: 0.022,
      },
    },

    // ---- orange maple — the middle step between the reds and the golds ----
    mapleOrange: {
      density: 0.00062, minD: 12, maxD: 95, sRange: [0.85, 1.3],
      trunk: { topR: 0.12, botR: 0.36, h: 10.2, flare: 3.0, bend: 0.3 },
      bark: mapleBark,
      tex: mapleOrangeTex,
      crown: {
        crownBase: 2.9, crownTop: 11.0, radius: 3.0,
        profile: 'dome',
        hue: 0.075, sat: 0.32, light: 0.84, hueVar: 0.026,
      },
    },

    // ---- deep green broadleaf — the anchor for the warm species above ----
    // Runs in the FAR tier: its job is to hold the slopes green
    // behind the accents, which is a background job, and the far tier is where the
    // background species live.
    // Density raised from 0.0012 to take over the slopes the pines and spruces
    // used to fill, and minD pulled in to where the pines started.
    deep: {
      density: 0.0030, minD: 24, maxD: 140, sRange: [0.8, 1.35],
      trunk: { topR: 0.12, botR: 0.42, h: 12.4, flare: 3.0 },
      bark: deepBark,
      tex: deepTex,
      crown: {
        crownBase: 3.2, crownTop: 13.6, radius: 3.2,
        profile: 'dome',
        // The deepest green in the scene, and the only one allowed below the others
        // in value — it is what the warm crowns are read against.
        hue: 0.33, sat: 0.3, light: 0.78,
      },
    },

  };

  // Resolve each species' shared geometry and materials once.
  for (const s of Object.values(SPECIES)) {
    // The trunk stops two-thirds of the way up the crown. Run to the crown top,
    // it showed through every gap between the leaf clumps as a long dark pole,
    // which is what made the tall species read as sticks with tufts on them.
    const c = s.crown;
    s.trunk.h = Math.min(s.trunk.h, c.crownBase + 0.65 * (c.crownTop - c.crownBase));
    s.trunkGeo = makeTrunkGeo(s.trunk);
    s.trunkMat = new THREE.MeshStandardMaterial({ map: s.bark, roughness: 0.95, metalness: 0 });
    Object.assign(s, makeCanopyAssets(s.tex, s.crown));
  }

  // The two tiers must stay DISJOINT — see the header note. The maples are
  // close-range accents so they join the near tier; `deep` is a background filler
  // so it joins the far one. No species appears in both.
  const NEAR = ['pagoda', 'high', 'ginkgo', 'mapleRed', 'mapleOrange'];
  const FAR = ['deep'];
  const materials = [];
  for (const s of Object.values(SPECIES)) {
    materials.push(s.trunkMat, s.canopyMat);
  }

  return {
    // Handed to toonifyMaterials: these materials exist from startup but the
    // meshes that use them do not, so traversing the scene would miss them.
    materials,
    layers: [
      makeTreeLayer(scene, SPECIES, NEAR, 'treesNear'),
      makeTreeLayer(scene, SPECIES, FAR, 'treesFar'),
    ],
  };
}

// One streaming layer covering a set of species. `build` places each species in
// the cell and returns every mesh it added so `dispose` can take them back out.
function makeTreeLayer(scene, SPECIES, names, id) {
  return {
    id,
    build(cell) {
      const meshes = [];
      for (let k = 0; k < names.length; k++) {
        const s = SPECIES[names[k]];
        // Each species gets its own sub-sequence, so adding or reordering species
        // cannot shift another one's layout. withSeed is re-entrant — the cell's
        // own generator is restored when this returns.
        withSeed(cellSeed(cell.i, cell.j, k * 977 + 31), () => {
          const trees = placeInCell(s, cell);
          if (!trees.length) return;
          addTrunks(scene, meshes, trees, s);
          addCanopy(scene, meshes, trees, s);
        });
      }
      return meshes;
    },
    dispose(meshes) {
      for (const m of meshes) {
        scene.remove(m);
        // Geometry and materials are shared across every cell, so only the
        // per-instance buffers are released. InstancedMesh.dispose() does exactly
        // that and leaves the shared geometry alone.
        m.dispose();
      }
    },
  };
}

// Global tree scale — trees tower over the grass and bushes; every species'
// trunk, branches and crown all run through the per-tree `s`.
const TREE_SCALE = 2;

// Rejection-sampled placements along the stream distance bands. The forest
// thickens away from the water, and the opening camera position stays clear
// so a random tree never spawns right in front of the initial view.
//
// Sampling is per cell and driven by DENSITY rather than by a target count. The
// field-wide version drew uniformly over 290x290 until it had `count` trees,
// which cannot be split across cells: each cell would have to know the whole
// field's tally. Attempts proportional to the cell's area gives the same expected
// density with no shared state, so a cell's contents depend only on where it is.
function placeInCell(s, cell) {
  const { density, minD, maxD, sRange, fixed } = s;
  const trees = [];
  const size = cell.size;
  const x0 = cell.cx - size / 2;
  const z0 = cell.cz - size / 2;

  // The hand-placed framing trees belong to whichever cell contains them, so they
  // are placed exactly once however the camera arrives. They keep the same water
  // test as the scattered ones: their coordinates were authored against a channel
  // a few units wide, and the pools have since opened out far enough to swallow
  // some of them.
  if (fixed) {
    for (const f of fixed) {
      if (f.x < x0 || f.x >= x0 + size || f.z < z0 || f.z >= z0 + size) continue;
      if (inWater(f.x, f.z, 1.2)) continue;
      trees.push({ x: f.x, z: f.z, rot: Math.random() * Math.PI * 2, s: f.s * TREE_SCALE });
    }
  }

  const camP = streamCurve.getPointAt(HOME_T);
  const camX = camP.x - 2, camZ = camP.z + 8;

  // Fractional attempts must not be truncated — at 0.00094/m² a 100m cell wants
  // 9.4 attempts, and flooring every cell would lose 4% of the high pines. Carry
  // the remainder as a probability instead.
  const want = density * size * size;
  const attempts = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);

  for (let a = 0; a < attempts; a++) {
    const x = x0 + Math.random() * size;
    const z = z0 + Math.random() * size;
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
function addTrunks(scene, out, trees, s) {
  const mesh = new THREE.InstancedMesh(s.trunkGeo, s.trunkMat, trees.length);
  mesh.castShadow = true;
  // Trunks do not take the canopy's cast shadow. The leafy crowns now block
  // nearly all the sun, so every trunk sat in shadow and the forest turned into
  // black bars; stylised forests keep the wood readable, lit on the sun side
  // and cool on the other by the cel shader alone.
  mesh.receiveShadow = false;
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
  out.push(mesh);
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
  // broadleaf: a ball — pinched where it meets the trunk, generous over the top
  dome: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.82)), 0.8),
  // pagoda: a wide flat plate that reaches full width low and holds it
  umbrella: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.55),
};

// One crown, as lumps of camera-facing leaf cards. Built in crown-local units
// (base at y=0, the species' own radius and height) so a tree is placed with a
// UNIFORM scale — a billboard under a non-uniform instance scale would smear.
//
// Lumps are scattered over the profile surface weighted by its radius, so wide
// bands get more lumps than the narrow tip.
function makeClumpCrownGeo(p) {
  const profile = CROWN_PROFILES[p.profile];
  const R = p.radius, H = p.crownTop - p.crownBase;
  const cy = H * 0.55;
  const lumps = [];

  // inverse CDF of the profile radius over height
  const STEPS = 64;
  const cdf = [0];
  for (let i = 1; i <= STEPS; i++) cdf.push(cdf[i - 1] + profile(i / STEPS));
  const umbrella = p.profile === 'umbrella';
  // Lump count grows with how TALL the crown is for its width. A fixed 13 was
  // tuned on round crowns; stretched over a tall narrow one it left gaps
  // between the lumps and the crown read as a few puffs strung up the trunk.
  const n = Math.round((umbrella ? 16 : 13) * Math.max(1, H / R / 2.7));
  const lr = R * (umbrella ? 0.46 : 0.44);
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * cdf[STEPS];
    let i = 1;
    while (cdf[i] < target) i++;
    const t = THREE.MathUtils.clamp(i / STEPS, 0.14, 0.9);
    const ring = profile(t) * R * 0.66;
    const a = k * 2.39996 + Math.random() * 0.5;
    lumps.push({ x: Math.cos(a) * ring, y: t * H, z: Math.sin(a) * ring, r: lr * (0.85 + Math.random() * 0.3), sy: umbrella ? 0.7 : 0.9 });
  }
  // a cap over the top
  lumps.push({ x: 0, y: H * 0.86, z: 0, r: lr * 0.95, sy: 0.8 });
  // A core so the gaps between lumps show leaves, not the bare trunk. Tall
  // crowns get a column of them, one per crown-width of height.
  const cores = Math.max(1, Math.round(H / (R * 1.6)));
  for (let k = 0; k < cores; k++) {
    const y = cores === 1 ? cy : H * (0.22 + 0.6 * (k / (cores - 1)));
    lumps.push({ x: 0, y, z: 0, r: R * 0.55, sy: 0.8, core: true });
  }

  const pos = [], nrm = [], col = [], uvs = [], card = [], idx = [];
  const c = new THREE.Vector3(), v = new THREE.Vector3(), d = new THREE.Vector3();
  const out = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  let maxHalf = 0;

  for (const L of lumps) {
    c.set(L.x, L.y, L.z);
    out.set(L.x, (L.y - cy) * 0.6, L.z);
    if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
    out.normalize();
    const M = L.core ? 14 : Math.max(7, Math.round(16 * (L.r / (R * 0.44)) ** 2));
    for (let m = 0; m < M; m++) {
      d.randomDirection();
      // cards crowd the lump's outer face — the inner face is hidden anyway
      if (!L.core) d.addScaledVector(out, 0.9).normalize();
      const rr = L.r * (0.45 + Math.random() * 0.45);
      v.set(L.x + d.x * rr, L.y + d.y * rr * L.sy, L.z + d.z * rr);
      const half = L.r * (0.4 + Math.random() * 0.22);
      maxHalf = Math.max(maxHalf, half);

      // crown-ellipsoid normal; its length doubles as "how far out" for the AO
      n2.set(v.x / R, (v.y - cy) / (H * 0.5), v.z / R);
      const q = n2.length();
      n2.normalize();
      if (L.core) n1.copy(n2);
      else n1.subVectors(v, c).normalize().add(n2).multiplyScalar(0.5);
      n1.y += 0.2;
      n1.normalize();

      let ao = (0.42 + 0.58 * smoothstep(0.25, 0.95, q)) * (0.64 + 0.36 * THREE.MathUtils.clamp(v.y / H, 0, 1));
      if (d.dot(out) < 0) ao *= 0.85;
      if (L.core) ao *= 0.7;
      const rot = Math.random() * Math.PI * 2;

      const base = pos.length / 3;
      for (const [cx, cz] of CORNERS) {
        pos.push(v.x, v.y, v.z);
        nrm.push(n1.x, n1.y, n1.z);
        col.push(ao, ao, ao);
        uvs.push((cx + 1) / 2, (cz + 1) / 2);
        card.push(cx, cz, half, rot);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(card, 4));
  g.setIndex(idx);
  // positions are card CENTRES; the cards reach maxHalf past them, and culling
  // must know that or crowns pop out at the screen edge
  g.computeBoundingSphere();
  g.boundingSphere.radius += maxHalf;
  return g;
}

// Turn each card (four vertices sharing one centre) into a quad facing the
// current camera. Done in LOCAL space, before the instance transform, so
// everything downstream — world position, shadow lookup, wind — sees the real
// corner. In the shadow pass viewMatrix is the sun's, so the cards turn to face
// the light and cast a full leafy shadow.
function applyBillboard(material) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.vertexShader = 'attribute vec4 aCard;\nvarying vec2 vCorner;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         float cr = cos(aCard.w), sr = sin(aCard.w);
         vCorner = vec2(aCard.x * cr - aCard.y * sr, aCard.x * sr + aCard.y * cr);
         vec2 cc = vCorner * aCard.z;
         vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
         vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
         mat3 im = mat3(instanceMatrix);
         // transpose(im) is scale * R^T; dividing the scale back out leaves the
         // world offset rotated into the instance's frame
         transformed += transpose(im) * (camR * cc.x + camU * cc.y) / length(im[0]);
       }`
    );
    // Bulge each card's normal like a little sphere. A flat card shades as one
    // tone, so overlapping cards read as a stack of coins; bent toward its own
    // rim it rounds off and melts into its neighbours. The card faces the camera,
    // so its corner offset is already a view-space direction.
    shader.fragmentShader = 'varying vec2 vCorner;\n' + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       normal = normalize(normal + vec3(vCorner * 0.55, 0.0));`
    ).replace(
      // Mip coverage fix. Averaging alpha down the mip chain drops thin leaf and
      // needle strokes under the alphaTest threshold, so distant crowns thin
      // out and needle crowns turn to specks. Scaling alpha up with the mip level
      // keeps the coverage roughly constant at every distance.
      '#include <map_fragment>',
      `#include <map_fragment>
       {
         vec2 tx = vMapUv * vec2(textureSize(map, 0));
         vec2 ddx = dFdx(tx), ddy = dFdy(tx);
         float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
         diffuseColor.a *= 1.0 + lod * 0.3;
       }`
    );
  };
  material.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : '') + '-billboard';
  };
  return material;
}

// The crown variants and materials for one species, built once and shared by
// every cell. Three variants, dealt out round-robin, so neighbours are not clones.
function makeCanopyAssets(tex, p) {
  const variants = [makeClumpCrownGeo(p), makeClumpCrownGeo(p), makeClumpCrownGeo(p)];
  // alphaTest 0.5 for a crisp painted leaf edge. The clump texture has an opaque
  // core, so the cut only ever bites the leaf tips at the rim.
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    alphaMap: tex.alphaMap,
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });
  applyCanopyWind(mat, { strength: 0.13, freq: 1.1 });
  keepAuthoredNormals(mat);
  applyBillboard(mat);
  // toonify() gives leaf surfaces a translucency floor so the crown's unlit
  // inner wall glows rather than going black; nothing else in the scene wants it.
  mat.userData.canopy = true;
  // Shadows must use the same cards and the same alpha cut, or the crown casts a
  // solid blot that disagrees with the leaves above it.
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: tex.map,
    alphaMap: tex.alphaMap,
    alphaTest: 0.5,
  });
  applyBillboard(depthMat);

  return { crownVariants: variants, canopyMat: mat, canopyDepthMat: depthMat };
}

// One cell's crowns: one InstancedMesh per shape variant. The cell is the cull
// unit, so each variant is a single mesh per cell.
function addCanopy(scene, out, trees, s) {
  const p = s.crown;
  const variants = s.crownVariants;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  // instances of one InstancedMesh must share geometry, so group by variant
  const groups = variants.map(() => ({ mats: [], cols: [] }));

  trees.forEach((tr, i) => {
    const g = groups[i % variants.length];
    const yBase = terrainHeight(tr.x, tr.z);
    dummy.position.set(tr.x, yBase + p.crownBase * tr.s, tr.z);
    dummy.rotation.set(0, tr.rot + Math.random() * Math.PI * 2, 0);
    // uniform: the cards are billboards, and a squashed instance would squash them
    const k = tr.s * (0.9 + Math.random() * 0.2);
    dummy.scale.set(k, k, k);
    dummy.updateMatrix();
    g.mats.push(dummy.matrix.clone());
    // one tint per tree — a crown has to read as a single object, so the colour
    // variation lives between trees, never within one crown
    // Tint spread stays small in every channel. This multiplies the texture, so
    // the only job here is telling one crown from the next — a wide lightness
    // range means some crowns come out visibly dark, which is what broke up the
    // canopy into a patchwork before.
    // Hue spread is per species. The greens get a WIDE one (±0.075 ≈ ±27°), which
    // is what puts yellow-green and blue-green crowns side by side inside a single
    // species instead of one flat green — the "same tone everywhere" complaint.
    // The warm species override it down to a narrow band: at ±27° a scarlet maple
    // would swing into magenta on one side and brown on the other, so for those the
    // variation has to live in saturation and value, not hue.
    col.setHSL(
      p.hue + (Math.random() - 0.5) * (p.hueVar ?? 0.075),
      (p.sat ?? 0.24) + (Math.random() - 0.5) * 0.1,
      p.light + (Math.random() - 0.5) * 0.09
    );
    g.cols.push(col.clone());
  });

  variants.forEach((geo, i) => {
    const { mats, cols } = groups[i];
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(geo, s.canopyMat, mats.length);
    mesh.castShadow = true;
    // Crowns cast but do not receive. The shadow map holds the cards turned to
    // the SUN, the frame shows them turned to the CAMERA, so the lookup slices
    // straight diagonal shadow bands across the leaves. The crown's depth comes
    // from its authored normals and baked AO instead, as in the reference games.
    mesh.receiveShadow = false;
    mesh.customDepthMaterial = s.canopyDepthMat;
    for (let k = 0; k < mats.length; k++) {
      mesh.setMatrixAt(k, mats[k]);
      mesh.setColorAt(k, cols[k]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    out.push(mesh);
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
