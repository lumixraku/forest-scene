import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWind, keepAuthoredNormals } from './wind.js';
import { terrainHeight } from './terrain.js';
import { streamAt, levelAt } from './streamPath.js';
import { makeLeafClusterTexture, makeCanopyTexture, makeBarkTexture, makeBirchTexture, makeSpruceTexture } from './textures.js';

// Volumetric card-foliage forest. Each crown is built from three layers so it
// reads as a solid 3D canopy instead of floating discs:
//   1. a dark displaced "core" blob — gaps show shaded interior, not sky
//   2. dozens of SMALL leaf-cluster cards grouped into branch clumps, each
//      oriented tangent to the crown ellipsoid (never face-on plates)
//   3. a bent textured trunk with a few branches reaching into the crown
// Everything is InstancedMesh per variant (trunk + core + cards share the
// same instance matrices), so the whole forest is a handful of draw calls.
export function createTrees(scene) {
  const barkTex = makeBarkTexture();
  const birchTex = makeBirchTexture();
  const leafTex = makeLeafClusterTexture({ hue: 96, sat: 46, light: 42 });
  const birchLeafTex = makeLeafClusterTexture({ hue: 78, sat: 48, light: 48, leafW: 8, round: true });
  const spruceTex = makeSpruceTexture();

  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1.0 });
  const birchTrunkMat = new THREE.MeshStandardMaterial({ map: birchTex, roughness: 0.9 });
  const leafMat = leafMaterial(leafTex);
  const birchLeafMat = leafMaterial(birchLeafTex);
  const spruceMat = leafMaterial(spruceTex, { windStrength: 0.06, grade: false });
  const canopyTex = makeCanopyTexture({ hue: 96 });
  canopyTex.repeat.set(2, 2);
  const coreMat = new THREE.MeshStandardMaterial({ map: canopyTex, roughness: 1.0, metalness: 0.0 });
  applyWind(coreMat, { strength: 0.1, freq: 1.15, heightFactor: 0.06 });
  applyCanopyGrade(coreMat);

  const groups = [
    // tiered pagoda canopy (小叶榄仁-style) — the signature valley tree:
    // straight trunk, whorls of horizontal branches, flat umbrella layers
    ...range(4).map(() => {
      const h = 11 + Math.random() * 5;
      const tiers = 4 + ((Math.random() * 2) | 0);
      const r0 = 3.8 + Math.random() * 1.6;
      const built = buildTieredTree({ h, tiers, r0 });
      return {
        trunk: built.trunk,
        crown: built.crown,
        core: built.core,
        trunkMat,
        crownMat: leafMat,
        count: 52,
        minD: 10, maxD: 130,
        hRange: [0.8, 1.45],
        tintH: 0, tintL: 0,
        coreCol: '#c2cb96',
        tex: leafTex,
      };
    }),
    // birch — slim white trunks near the banks
    ...range(3).map(() => {
      const cy = 12.5 + Math.random() * 2.5;
      const rx = 3.0 + Math.random() * 0.8;
      const ry = 3.6 + Math.random() * 1.0;
      return {
        trunk: buildTrunk({ topR: 0.13, botR: 0.3, h: 11 + Math.random() * 4, bend: 1.2, branches: 0, crownY: cy }),
        crown: buildLeafCrown({ cy, rx, ry, clumps: 16, size: 2.0 }),
        core: buildCoreBlob({ cy, rx: rx * 0.58, ry: ry * 0.58 }),
        trunkMat: birchTrunkMat,
        crownMat: birchLeafMat,
        count: 34,
        minD: 9, maxD: 45,
        hRange: [0.85, 1.4],
        tintH: -0.01, tintL: 0.04,
        coreCol: '#bfc490',
        tex: birchLeafTex,
      };
    }),
    // spruce — dark spires filling the upper slopes / background
    {
      trunk: null,
      crown: buildSpruceCards({ h: 19, w: 10 }),
      core: buildSpruceCore({ h: 19, w: 10 }),
      trunkMat: null,
      crownMat: spruceMat,
      count: 110,
      minD: 48, maxD: 140,
      hRange: [0.7, 1.5],
      tintH: 0, tintL: 0,
      coreCol: '#26361a',
      tex: spruceTex,
    },
  ];

  // hand-placed trees framing the opening camera view from both banks
  groups[0].fixed = [
    { x: -26, z: -24.5, hs: 1.25 },
    { x: -13, z: -2.5, hs: 1.35 },
  ];
  groups[4].fixed = [
    { x: -30, z: -0.5, hs: 1.2 },
    { x: -16, z: -26, hs: 1.15 },
  ];

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const coreColVar = new THREE.Color();

  for (const g of groups) {
    const matrices = [];
    for (const f of g.fixed ?? []) {
      dummy.position.set(f.x, terrainHeight(f.x, f.z) - 0.3, f.z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(1, f.hs, 1);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    let attempts = 0;
    while (matrices.length < g.count && attempts < g.count * 40) {
      attempts++;
      const x = (Math.random() - 0.5) * 290;
      const z = (Math.random() - 0.5) * 290;
      const { d: sd, t } = streamAt(x, z);
      if (sd < g.minD || sd > g.maxD) continue;
      // forest thickens away from the water
      const keep = THREE.MathUtils.clamp((sd - g.minD) / 40 + 0.35, 0, 1);
      if (Math.random() > keep) continue;
      const h = terrainHeight(x, z);
      if (h < levelAt(t) + 0.5) continue;

      const hs = g.hRange[0] + Math.random() * (g.hRange[1] - g.hRange[0]);
      const ws = 0.85 + Math.random() * 0.3;
      dummy.position.set(x, h - 0.3, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(ws, hs, ws);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    const n = matrices.length;
    if (n === 0) continue;

    const crowns = new THREE.InstancedMesh(g.crown, g.crownMat, n);
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    crowns.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: g.tex,
      alphaTest: 0.5,
    });
    for (let i = 0; i < n; i++) {
      crowns.setMatrixAt(i, matrices[i]);
      // near-white tint so the multiply barely darkens the leaf texture
      col.setHSL(0.26 + g.tintH + (Math.random() - 0.5) * 0.03, 0.24, 0.74 + g.tintL + (Math.random() - 0.5) * 0.08);
      crowns.setColorAt(i, col);
    }
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    scene.add(crowns);

    if (g.core) {
      const cores = new THREE.InstancedMesh(g.core, coreMat, n);
      cores.castShadow = true;
      cores.receiveShadow = true;
      const base = new THREE.Color(g.coreCol);
      for (let i = 0; i < n; i++) {
        cores.setMatrixAt(i, matrices[i]);
        coreColVar.copy(base).offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.05);
        cores.setColorAt(i, coreColVar);
      }
      cores.instanceMatrix.needsUpdate = true;
      if (cores.instanceColor) cores.instanceColor.needsUpdate = true;
      scene.add(cores);
    }

    if (g.trunk) {
      const trunks = new THREE.InstancedMesh(g.trunk, g.trunkMat, n);
      trunks.castShadow = true;
      trunks.receiveShadow = true;
      for (let i = 0; i < n; i++) trunks.setMatrixAt(i, matrices[i]);
      trunks.instanceMatrix.needsUpdate = true;
      scene.add(trunks);
    }
  }
}

function leafMaterial(tex, { windStrength = 0.14, grade = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.0,
  });
  applyWind(mat, { strength: windStrength, freq: 1.15, heightFactor: 0.08 });
  keepAuthoredNormals(mat);
  if (grade) applyCanopyGrade(mat);
  return mat;
}

// Two-tone canopy grade like the reference footage: surfaces facing the sky
// get a warm yellow-green sun wash, undersides fall into cool deep green —
// far stronger separation than plain lambert gives at this leaf scale.
// Trees only rotate around Y, so objectNormal.y == world up-ness.
function applyCanopyGrade(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.vertexShader = ('varying float vUpY;\n' + shader.vertexShader).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vUpY = objectNormal.y;`
    );
    shader.fragmentShader = ('varying float vUpY;\n' + shader.fragmentShader).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float up = clamp(vUpY * 0.5 + 0.5, 0.0, 1.0);
        diffuseColor.rgb *= mix(vec3(0.6, 0.66, 0.62), vec3(1.38, 1.32, 0.88), up);
      }`
    );
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => prevKey() + '-canopy-grade';
  return mat;
}

// 小叶榄仁-style tiered tree: straight trunk, whorls of near-horizontal
// branches, and flat umbrella foliage layers shrinking toward the top.
// Returns { trunk, core, crown }:
//   trunk — trunk + whorled branch cylinders (bark material)
//   core  — flattened solid blobs, one per tier (dark interior)
//   crown — small leaf cards lying on each tier's upper surface
function buildTieredTree({ h, tiers, r0 }) {
  const trunkParts = [];
  const coreParts = [];
  const cardParts = [];

  // straight trunk with a gentle taper
  const trunk = new THREE.CylinderGeometry(0.14, 0.42, h, 7, 4, false);
  trunk.translate(0, h / 2, 0);
  trunkParts.push(trunk);

  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const y = h * (0.42 + 0.58 * k) + (Math.random() - 0.5) * h * 0.04;
    const r = r0 * (1 - 0.68 * k) * (0.9 + Math.random() * 0.2);
    // thick puffy tiers, not plates — the ref canopy reads as one broken mass
    const thick = 0.85 + r * 0.24;
    const ox = (Math.random() - 0.5) * 1.2;
    const oz = (Math.random() - 0.5) * 1.2;

    // whorl of horizontal branches reaching to the tier edge
    const nBr = 4 + ((Math.random() * 2) | 0);
    for (let b = 0; b < nBr; b++) {
      const ang = (b / nBr) * Math.PI * 2 + Math.random() * 0.6;
      const len = r * (0.75 + Math.random() * 0.2);
      const br = new THREE.CylinderGeometry(0.03, 0.09, len, 4, 1, false);
      br.translate(0, len / 2, 0);
      br.rotateZ(Math.PI / 2 - 0.12 - Math.random() * 0.1); // near-horizontal, tips up a touch
      br.rotateY(ang);
      br.translate(0, y - thick * 0.35, 0);
      trunkParts.push(br);
    }

    // lumpy blob — the leafy mass of the tier, tilted a touch off-level
    const blob = new THREE.IcosahedronGeometry(1, 4);
    const bp = blob.attributes.position;
    for (let vi = 0; vi < bp.count; vi++) {
      const x = bp.getX(vi), yy = bp.getY(vi), z = bp.getZ(vi);
      const n = Math.sin(x * 3.4 + z * 2.6) * 0.5 + Math.sin(yy * 4.1 + x * 2.2) * 0.5;
      const f = 1 + n * 0.42;
      bp.setXYZ(vi, x * f, yy * f, z * f);
    }
    bp.needsUpdate = true;
    blob.computeVertexNormals();
    blob.scale(r * (0.85 + Math.random() * 0.3), thick * (0.8 + Math.random() * 0.45), r * (0.85 + Math.random() * 0.3));
    blob.rotateX((Math.random() - 0.5) * 0.24);
    blob.rotateZ((Math.random() - 0.5) * 0.24);
    blob.translate(ox, y, oz);
    coreParts.push(blob);

    // dense leaf cards mounding over the tier's sunlit top
    const nCards = Math.max(11, Math.round(r * 7));
    for (let c = 0; c < nCards; c++) {
      const s = 1.6 + Math.random() * 1.2;
      const card = new THREE.PlaneGeometry(s, s);
      card.rotateZ(Math.random() * Math.PI * 2);
      card.rotateX(-Math.PI / 2 + (Math.random() - 0.5) * 0.7);
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r * 0.95;
      const px = ox + Math.cos(a) * rr;
      const pz = oz + Math.sin(a) * rr;
      const py = y + thick * (0.35 + Math.random() * 0.75) * (1 - (rr / r) * 0.45);
      card.translate(px, py, pz);
      // up-tilted normals so the mounds read as sunlit clumps
      const nrm = card.attributes.normal;
      const nv = new THREE.Vector3(px * 0.25, 1, pz * 0.25).normalize();
      for (let vi = 0; vi < nrm.count; vi++) nrm.setXYZ(vi, nv.x, nv.y, nv.z);
      cardParts.push(card);
    }

    // rim cards tilted outward — breaks the smooth disc silhouette
    const nRim = Math.max(7, Math.round(r * 3.6));
    for (let c = 0; c < nRim; c++) {
      const s = 1.4 + Math.random() * 1.0;
      const card = new THREE.PlaneGeometry(s, s);
      const a = (c / nRim) * Math.PI * 2 + Math.random() * 0.5;
      card.rotateZ(Math.random() * Math.PI * 2);
      card.rotateX(-Math.PI / 2 + 0.55 + Math.random() * 0.4); // leaning off the edge
      card.rotateY(a);
      const px = ox + Math.cos(a) * r * (0.92 + Math.random() * 0.18);
      const pz = oz + Math.sin(a) * r * (0.92 + Math.random() * 0.18);
      const py = y + (Math.random() - 0.35) * thick * 0.8;
      card.translate(px, py, pz);
      const nrm = card.attributes.normal;
      const nv = new THREE.Vector3(Math.cos(a) * 0.7, 0.75, Math.sin(a) * 0.7).normalize();
      for (let vi = 0; vi < nrm.count; vi++) nrm.setXYZ(vi, nv.x, nv.y, nv.z);
      cardParts.push(card);
    }

    // a few underside cards facing down — the canopy grade turns them into
    // the deep shadowed belly each tier needs to read as a volume
    const nUnder = Math.max(4, Math.round(r * 2.2));
    for (let c = 0; c < nUnder; c++) {
      const s = 1.4 + Math.random() * 1.0;
      const card = new THREE.PlaneGeometry(s, s);
      card.rotateZ(Math.random() * Math.PI * 2);
      card.rotateX(Math.PI / 2 + (Math.random() - 0.5) * 0.6);
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r * 0.8;
      const px = ox + Math.cos(a) * rr;
      const pz = oz + Math.sin(a) * rr;
      const py = y - thick * (0.45 + Math.random() * 0.4);
      card.translate(px, py, pz);
      const nrm = card.attributes.normal;
      const nv = new THREE.Vector3(px * 0.3, -0.8, pz * 0.3).normalize();
      for (let vi = 0; vi < nrm.count; vi++) nrm.setXYZ(vi, nv.x, nv.y, nv.z);
      cardParts.push(card);
    }
  }

  const trunkGeo = mergeGeometries(trunkParts, false);
  trunkGeo.computeVertexNormals();
  return {
    trunk: trunkGeo,
    core: mergeGeometries(coreParts, false),
    crown: mergeGeometries(cardParts, false),
  };
}

// Bent tapered trunk + a few branches angling up into the crown.
function buildTrunk({ topR, botR, h, bend, branches = 0, crownY = h }) {
  const parts = [];
  const g = new THREE.CylinderGeometry(topR, botR, h, 7, 6, false);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const dir = Math.random() * Math.PI * 2;
  const bx = Math.cos(dir) * bend, bz = Math.sin(dir) * bend;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) + bx * t * t);
    pos.setZ(i, pos.getZ(i) + bz * t * t);
  }
  pos.needsUpdate = true;
  parts.push(g);

  for (let b = 0; b < branches; b++) {
    const len = 2.6 + Math.random() * 2.2;
    const br = new THREE.CylinderGeometry(0.05, 0.13, len, 5, 1, false);
    br.translate(0, len / 2, 0);
    const pitch = 0.6 + Math.random() * 0.5; // lean away from vertical
    const yaw = Math.random() * Math.PI * 2;
    br.rotateZ(pitch);
    br.rotateY(yaw);
    const hy = h * (0.55 + Math.random() * 0.3);
    const t = hy / h;
    br.translate(bx * t * t, hy, bz * t * t);
    parts.push(br);
  }
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

// Small leaf-cluster cards grouped into branch clumps on the crown ellipsoid,
// each card tangent to the surface (plane normal = radial) with a bit of
// random tilt/roll — no big face-on plates, silhouette stays puffy.
function buildLeafCrown({ cy, rx, ry, clumps, size }) {
  const parts = [];
  const Z = new THREE.Vector3(0, 0, 1);
  const radial = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let c = 0; c < clumps; c++) {
    // clump centre on the shell (slightly biased upward for a sunlit top)
    const dir = new THREE.Vector3().randomDirection();
    dir.y = dir.y * 0.85 + 0.15;
    dir.normalize();
    const cxp = dir.x * rx, cyp = dir.y * ry, czp = dir.z * rx;

    const nCards = 6 + ((Math.random() * 4) | 0);
    for (let k = 0; k < nCards; k++) {
      const s = size * (0.75 + Math.random() * 0.6);
      const card = new THREE.PlaneGeometry(s, s);
      // roll + slight tilt in card space, then orient tangent to the shell
      card.rotateZ(Math.random() * Math.PI * 2);
      card.rotateX((Math.random() - 0.5) * 0.8);
      card.rotateY((Math.random() - 0.5) * 0.8);

      const px = cxp + (Math.random() - 0.5) * size * 1.3;
      const py = cyp + (Math.random() - 0.5) * size * 1.3;
      const pz = czp + (Math.random() - 0.5) * size * 1.3;
      radial.set(px / rx, py / ry, pz / rx).normalize();
      q.setFromUnitVectors(Z, radial);
      card.applyQuaternion(q);
      card.translate(px, cy + py, pz);

      // radial normals -> the whole crown shades like one rounded mass
      const nrm = card.attributes.normal;
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, radial.x, radial.y, radial.z);
      parts.push(card);
    }
  }
  return mergeGeometries(parts, false);
}

// Dark displaced blob filling the crown interior.
function buildCoreBlob({ cy, rx, ry }) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 3.1 + y * 2.2) * Math.cos(z * 2.7) * 0.5
            + Math.sin(y * 4.3 + z * 3.4) * 0.5;
    const f = 1 + n * 0.22;
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.scale(rx, ry, rx);
  g.translate(0, cy, 0);
  return g;
}

function buildSpruceCards({ h, w }) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const card = new THREE.PlaneGeometry(w, h);
    card.rotateY((i / 3) * Math.PI);
    card.translate(0, h / 2 - 0.4, 0);
    parts.push(card);
  }
  const g = mergeGeometries(parts, false);
  // upward-tilted normals so spruces catch skylight instead of going black
  const n = g.attributes.normal;
  const up = new THREE.Vector3();
  for (let k = 0; k < n.count; k++) {
    up.set(n.getX(k), 0.9, n.getZ(k)).normalize();
    n.setXYZ(k, up.x, up.y, up.z);
  }
  return g;
}

// Solid dark cone inside the crossed spruce cards.
function buildSpruceCore({ h, w }) {
  const g = new THREE.ConeGeometry(w * 0.30, h * 0.9, 7, 3);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 2.5 + y * 1.8) * Math.cos(z * 2.2);
    pos.setXYZ(i, x * (1 + n * 0.12), y, z * (1 + n * 0.12));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.translate(0, h * 0.45, 0);
  return g;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}
