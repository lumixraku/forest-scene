import * as THREE from 'three';
import {
  streamCurve, levelAt, cascadeAt, halfWidthAt, narrownessAt, DROPS, DROP_LEN,
} from './streamPath.js';
import { terrainHeight } from './terrain.js';
import { makeRockTexture, makeFoamStreakTexture, makeBedTexture } from './textures.js';

// Terraced brook. The water ribbon follows the stepped elevation profile and
// uses a MeshStandardMaterial with injected flow/foam shading, so it sits in
// the real lighting pipeline: dappled tree shadows fall on the surface and
// the sun puts a moving specular on it. Fine anisotropic ripple/fleck noise
// streams downstream everywhere. Rocks get white foam collars.
// depth of the carved bed below the local water level, by normalized
// cross-channel position (0 centre, 1 edge) — shared by the bed ribbon
// and the pebbles sitting on it
function bedDepth(cross) {
  return 0.4 + 1.1 * (1 - cross * cross);
}

export function createStream(scene) {
  const group = new THREE.Group();

  group.add(buildBedRibbon());

  const water = buildWaterRibbon();
  group.add(water.mesh);

  const rockTex = makeRockTexture();
  const rockMat = new THREE.MeshStandardMaterial({
    map: rockTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const variants = [buildRockGeo(), buildRockGeo(), buildRockGeo()];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // foam wakes: collected while placing rocks that break the surface,
  // each remembers the downstream direction so the streaks trail with the flow
  const foamRings = [];
  const addRing = (x, z, t, s) => {
    const tan = streamCurve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1));
    const dl = Math.hypot(tan.x, tan.z) || 1;
    // t=1 is upstream, so downstream is -tangent
    foamRings.push({ x, z, y: levelAt(t) - 0.02, s, dx: -tan.x / dl, dz: -tan.z / dl });
  };

  const setRock = (mesh, i, cx, cz, y, s) => {
    dummy.position.set(cx, y, cz);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.set(s * (0.85 + Math.random() * 0.4), s * (0.6 + Math.random() * 0.4), s * (0.85 + Math.random() * 0.4));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // warm beige stone like the reference, not cold grey
    col.setHSL(0.09, 0.10 + Math.random() * 0.09, 0.55 + Math.random() * 0.2);
    mesh.setColorAt(i, col);
  };

  const lateral = (t, lat) => {
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    return { x: p.x + (bx / bl) * lat, z: p.z + (bz / bl) * lat };
  };

  // ---- stone sills across every cascade lip ----
  {
    const perDrop = 6;
    const rocks = new THREE.InstancedMesh(variants[0], rockMat, DROPS.length * perDrop);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    let i = 0;
    for (const d of DROPS) {
      const tLip = Math.min(d.t + DROP_LEN * 0.4, 1);
      const hw = halfWidthAt(tLip);
      const lipLvl = levelAt(Math.min(d.t + DROP_LEN, 1));
      for (let k = 0; k < perDrop; k++) {
        const lat = ((k + 0.5) / perDrop - 0.5) * 2 * (hw * 0.9) + (Math.random() - 0.5) * 1.2;
        const tt = tLip + (Math.random() - 0.5) * 0.004;
        const { x, z } = lateral(tt, lat);
        const s = 0.9 + Math.random() * 1.1;
        setRock(rocks, i++, x, z, lipLvl - 0.55 + s * 0.28, s);
        addRing(x, z, Math.min(d.t + DROP_LEN, 1), s * 1.6);
      }
    }
    rocks.count = i;
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    group.add(rocks);
  }

  // ---- pebbles on the bed, visible THROUGH the clear water ----
  {
    const COUNT = 420;
    const pebbles = new THREE.InstancedMesh(variants[2], rockMat, COUNT);
    pebbles.receiveShadow = true;
    for (let i = 0; i < COUNT; i++) {
      const tt = Math.random();
      const hw = halfWidthAt(tt);
      const lat = (Math.random() - 0.5) * 2 * (hw - 0.5);
      const { x, z } = lateral(tt, lat);
      const s = 0.18 + Math.random() * 0.5;
      // sit on the sandy bed ribbon so they show through the clear water
      const cross = Math.abs(lat) / (hw + 1.2);
      const y = levelAt(tt) - bedDepth(cross) + s * 0.35;
      setRock(pebbles, i, x, z, y, s);
    }
    pebbles.instanceMatrix.needsUpdate = true;
    if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
    group.add(pebbles);
  }

  // ---- bank boulders + loose stones in the water ----
  const sets = [
    { count: 30, latPad: [0.5, 5], sMin: 0.8, sMax: 2.0, bank: true },
    { count: 60, latPad: [-1, 1], sMin: 0.3, sMax: 1.0, bank: false },
  ];
  for (const set of sets) {
    const per = Math.ceil(set.count / variants.length);
    for (const geo of variants) {
      const rocks = new THREE.InstancedMesh(geo, rockMat, per);
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      for (let i = 0; i < per; i++) {
        const tt = Math.random();
        const hw = halfWidthAt(tt);
        const lat = set.bank
          ? (hw + set.latPad[0] + Math.random() * (set.latPad[1] - set.latPad[0])) * (Math.random() < 0.5 ? 1 : -1)
          : (Math.random() - 0.5) * 2 * (hw + set.latPad[1]);
        const { x, z } = lateral(tt, lat);
        const s = set.sMin + Math.random() * (set.sMax - set.sMin);
        const lvl = levelAt(tt);
        const y = Math.max(terrainHeight(x, z), lvl - 0.9) + s * 0.18;
        setRock(rocks, i, x, z, y, s);
        // collar only where the rock actually pokes through the surface
        if (!set.bank && y + s * 0.5 > lvl && y - s * 0.5 < lvl) addRing(x, z, tt, s * 2.0);
      }
      rocks.instanceMatrix.needsUpdate = true;
      if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
      group.add(rocks);
    }
  }

  // ---- hand-placed hero boulders near the start view ----
  {
    const hero = [
      { t: 0.405, lat: -3.5, s: 1.9 }, { t: 0.418, lat: 1.5, s: 1.4 },
      { t: 0.432, lat: 4.5, s: 2.3 }, { t: 0.445, lat: -1.0, s: 1.1 },
      { t: 0.458, lat: -5.0, s: 1.6 },
    ];
    const rocks = new THREE.InstancedMesh(variants[1], rockMat, hero.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    hero.forEach((hr, i) => {
      const { x, z } = lateral(hr.t, hr.lat);
      setRock(rocks, i, x, z, levelAt(hr.t) - 0.7 + hr.s * 0.35, hr.s);
      addRing(x, z, hr.t, hr.s * 1.9);
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    group.add(rocks);
  }

  // ---- foam wakes riding on the surface, trailing downstream of rocks ----
  {
    const wakeTex = makeFoamStreakTexture();
    const wakeGeo = new THREE.PlaneGeometry(1, 1);
    wakeGeo.rotateX(-Math.PI / 2);
    const wakeMat = new THREE.MeshBasicMaterial({
      map: wakeTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const wakes = new THREE.InstancedMesh(wakeGeo, wakeMat, foamRings.length);
    wakes.renderOrder = 3;
    foamRings.forEach((r, i) => {
      // local +x of the card points downstream (texture bow sits upstream)
      dummy.position.set(r.x + r.dx * r.s * 0.45, r.y + 0.06, r.z + r.dz * r.s * 0.45);
      dummy.rotation.set(0, Math.atan2(-r.dz, r.dx), 0);
      dummy.scale.set(r.s * 2.1, 1, r.s * (0.9 + Math.random() * 0.3));
      dummy.updateMatrix();
      wakes.setMatrixAt(i, dummy.matrix);
    });
    wakes.instanceMatrix.needsUpdate = true;
    group.add(wakes);
  }

  return {
    group,
    update(dt) {
      water.uniforms.uTime.value += dt;
    },
  };
}

// Ribbon following the curve in plan AND the terraced profile in elevation.
// MeshStandardMaterial with injected flow/foam shading: receives shadows,
// gets sun specular, fogs with the scene.
function buildWaterRibbon() {
  const SEGS = 420;
  const positions = [];
  const uvs = [];
  const foamAttr = [];
  const depthAttr = [];
  const index = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    const w = halfWidthAt(t) + 1.8; // tucked under both banks
    const y = levelAt(t) - 0.1;
    for (const side of [-1, 1]) {
      const x = p.x + (bx / bl) * w * side;
      const z = p.z + (bz / bl) * w * side;
      positions.push(x, y, z);
      // water depth below this point: 0 at the shoreline -> 1 over the deep
      // middle. Drives clarity: shallow edges are almost glass.
      depthAttr.push(THREE.MathUtils.clamp((y - terrainHeight(x, z)) / 1.6, 0, 1));
    }
    uvs.push(t, 0, t, 1);
    const c = Math.min(1, cascadeAt(t) * (0.85 + narrownessAt(t) * 0.15));
    foamAttr.push(c, c);
    if (i < SEGS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foamAttr, 1));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depthAttr, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    roughness: 0.16,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = `
      attribute float aFoam;
      attribute vec2 aUv;
      attribute float aDepth;
      varying float vFoam;
      varying vec2 vUvS;
      varying float vDepth;
      uniform float uTime;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vFoam = aFoam;
       vUvS = aUv;
       vDepth = aDepth;
       // churned surface on the cascades
       transformed.y += aFoam * 0.09 * sin(aUv.x * 400.0 + uTime * 6.0);`
    );
    shader.fragmentShader = `
      varying float vFoam;
      varying vec2 vUvS;
      varying float vDepth;
      uniform float uTime;
      float gFoam = 0.0;
      float gAgit = 0.0;
      float hashW(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noiseW(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hashW(i), hashW(i + vec2(1,0)), f.x),
                   mix(hashW(i + vec2(0,1)), hashW(i + vec2(1,1)), f.x), f.y);
      }
    ` + shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      {
        float u = vUvS.x * 140.0;
        float v = vUvS.y;
        float crossW = abs(v * 2.0 - 1.0);
        // anisotropic ripple layers, all streaming downstream
        float f1 = noiseW(vec2(u * 0.7 + uTime * 1.4, v * 10.0));
        float f2 = noiseW(vec2(u * 1.8 + uTime * 3.2, v * 24.0 + 5.0));
        float f3 = noiseW(vec2(u * 3.8 + uTime * 5.5, v * 48.0 + 13.0));
        gAgit = clamp(0.35 + vFoam, 0.0, 1.0);
        // clear glassy water: pale over the shallows, teal over the deep middle
        vec3 deepC = vec3(0.17, 0.31, 0.28);
        vec3 shalC = vec3(0.48, 0.58, 0.52);
        vec3 wcol = mix(shalC, deepC, vDepth * (0.7 + 0.3 * f1));
        // cascade foam broken into long streaks by stretched noise
        float streak = noiseW(vec2(u * 2.4 + uTime * 4.2, v * 14.0));
        float casc = vFoam * smoothstep(0.25, 0.72, streak * 0.55 + f2 * 0.45);
        // streaming white flecks — sparse in the pools, dense in the rush
        float fleck = smoothstep(0.8 - vFoam * 0.25, 0.97, f2 * 0.5 + f3 * 0.5);
        // broken foam line where the water meets the banks
        float edge = smoothstep(0.74, 0.96, crossW) * smoothstep(0.35, 0.75, f3);
        gFoam = clamp(casc * 1.25 + fleck * (0.2 + 0.6 * gAgit) + edge * 0.7, 0.0, 1.0);
        wcol = mix(wcol, vec3(0.96, 0.98, 0.96), gFoam);
        diffuseColor.rgb = wcol;
        // transparency sells the clarity: nearly glass at the shallows,
        // still translucent over depth, opaque only where it froths
        diffuseColor.a = clamp(mix(0.14, 0.46, vDepth) + gFoam * 0.9, 0.0, 1.0);
      }`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
      {
        // streaming ripple bumps -> the sun glitter slides downstream
        float u = vUvS.x * 140.0;
        float v = vUvS.y;
        float e = 0.22;
        float n0 = noiseW(vec2(u * 2.1 + uTime * 2.8, v * 30.0));
        float nx = noiseW(vec2((u + e) * 2.1 + uTime * 2.8, v * 30.0));
        float nz = noiseW(vec2(u * 2.1 + uTime * 2.8, (v + e * 0.08) * 30.0));
        vec3 bump = vec3(nx - n0, 0.0, nz - n0) * (1.6 + 2.2 * gAgit) * (1.0 - gFoam * 0.7);
        normal = normalize(normal + bump);
      }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.12, 0.85, gFoam);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      {
        // sun sparkle riding the current — rotated noise domains so the
        // glints stay point-like instead of forming axis-aligned zigzags
        float su = vUvS.x * 140.0;
        float sv = vUvS.y;
        float sp  = noiseW(vec2(su * 2.6 + sv * 31.0 + uTime * 6.0, su * 1.1 - sv * 47.0));
        float sp2 = noiseW(vec2(su * 1.9 - sv * 39.0 - uTime * 4.2, su * 2.3 + sv * 27.0 + 7.0));
        float glint = smoothstep(0.80, 0.97, sp * sp2 * 1.7);
        totalEmissiveRadiance += vec3(1.0, 1.0, 0.92) * glint * (0.25 + 0.85 * gAgit);
      }`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, uniforms };
}

// Sandy pebble bed carved below the waterline — the clear water reads as
// water precisely because this is visible through it.
function buildBedRibbon() {
  const SEGS = 420;
  const STEPS = 6;
  const positions = [];
  const uvs = [];
  const colors = [];
  const index = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    const hw = halfWidthAt(t) + 1.2;
    const lvl = levelAt(t);
    for (let k = 0; k <= STEPS; k++) {
      const v = k / STEPS;
      const lat = (v * 2 - 1) * hw;
      const cross = Math.abs(v * 2 - 1);
      positions.push(p.x + (bx / bl) * lat, lvl - bedDepth(cross), p.z + (bz / bl) * lat);
      uvs.push(t * 90, v * 3);
      // slightly dimmer toward the deep centre line
      const shade = 1.0 - (1 - cross) * 0.3;
      colors.push(shade, shade, shade);
    }
    if (i < SEGS) {
      const row = STEPS + 1;
      for (let k = 0; k < STEPS; k++) {
        const a = i * row + k;
        index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: makeBedTexture(),
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildRockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const pos = g.attributes.position;
  const f1 = 1.5 + Math.random() * 1.5;
  const f2 = 2.5 + Math.random() * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * f1 + y * 1.3) * Math.cos(z * f2) * 0.5
            + Math.sin(y * f2 + z * f1) * 0.5;
    const f = 1 + n * 0.12;
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
