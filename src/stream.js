import * as THREE from 'three';
import {
  streamCurve, levelAt, cascadeAt, halfWidthAt, narrownessAt, DROPS, DROP_LEN,
} from './streamPath.js';
import { terrainHeight } from './terrain.js';
import { makeRockTexture, makeFoamRingTexture } from './textures.js';

// Terraced brook. The water ribbon follows the stepped elevation profile and
// uses a MeshStandardMaterial with injected flow/foam shading, so it sits in
// the real lighting pipeline: dappled tree shadows fall on the surface and
// the sun puts a moving specular on it. Fine anisotropic ripple/fleck noise
// streams downstream everywhere. Rocks get white foam collars.
export function createStream(scene) {
  const group = new THREE.Group();

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

  // foam collars: collected while placing rocks that break the surface
  const foamRings = [];
  const addRing = (x, z, t, s) => {
    foamRings.push({ x, z, y: levelAt(t) - 0.02, s });
  };

  const setRock = (mesh, i, cx, cz, y, s) => {
    dummy.position.set(cx, y, cz);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.set(s * (0.85 + Math.random() * 0.4), s * (0.6 + Math.random() * 0.4), s * (0.85 + Math.random() * 0.4));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.1, 0.04 + Math.random() * 0.06, 0.5 + Math.random() * 0.2);
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
      const y = Math.min(terrainHeight(x, z), levelAt(tt) - 1.4) + s * 0.4;
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

  // ---- foam collars riding on the surface around emergent rocks ----
  {
    const ringTex = makeFoamRingTexture();
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    });
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, foamRings.length);
    rings.renderOrder = 3;
    foamRings.forEach((r, i) => {
      dummy.position.set(r.x, r.y + 0.06, r.z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(r.s, 1, r.s);
      dummy.updateMatrix();
      rings.setMatrixAt(i, dummy.matrix);
    });
    rings.instanceMatrix.needsUpdate = true;
    group.add(rings);
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
  const index = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    const w = halfWidthAt(t) + 1.8; // tucked under both banks
    const y = levelAt(t) - 0.1;
    positions.push(p.x - (bx / bl) * w, y, p.z - (bz / bl) * w);
    positions.push(p.x + (bx / bl) * w, y, p.z + (bz / bl) * w);
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
  geo.setIndex(index);
  geo.computeVertexNormals();

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    roughness: 0.25,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = `
      attribute float aFoam;
      attribute vec2 aUv;
      varying float vFoam;
      varying vec2 vUvS;
      uniform float uTime;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vFoam = aFoam;
       vUvS = aUv;
       // churned surface on the cascades
       transformed.y += aFoam * 0.09 * sin(aUv.x * 400.0 + uTime * 6.0);`
    );
    shader.fragmentShader = `
      varying float vFoam;
      varying vec2 vUvS;
      uniform float uTime;
      float hashW(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noiseW(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hashW(i), hashW(i + vec2(1,0)), f.x),
                   mix(hashW(i + vec2(0,1)), hashW(i + vec2(1,1)), f.x), f.y);
      }
    ` + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float u = vUvS.x * 140.0;
        float v = vUvS.y;
        // anisotropic ripple layers, all streaming downstream
        float f1 = noiseW(vec2(u * 0.6 + uTime * 1.3, v * 9.0));
        float f2 = noiseW(vec2(u * 1.6 + uTime * 2.8, v * 20.0 + 5.0));
        float f3 = noiseW(vec2(u * 3.4 + uTime * 4.6, v * 42.0 + 13.0));
        float agitation = clamp(0.4 + vFoam, 0.0, 1.0);
        vec3 deepC = vec3(0.20, 0.33, 0.29);
        vec3 shalC = vec3(0.42, 0.52, 0.47);
        vec3 wcol = mix(deepC, shalC, clamp(f1 * 0.5 + f2 * 0.3 + f3 * 0.2, 0.0, 1.0) * agitation);
        // streaming white flecks — sparse in the pools, dense in the cascades
        float fleck = smoothstep(0.74 - vFoam * 0.3, 0.95, f2 * 0.55 + f3 * 0.45);
        float edge = smoothstep(0.72, 0.98, abs(v * 2.0 - 1.0)) * (0.3 + 0.5 * f3);
        float foam = clamp(
          vFoam * 1.3 * (0.45 + 0.55 * f2) +
          fleck * (0.15 + 0.6 * agitation) +
          edge * 0.3, 0.0, 1.0);
        wcol = mix(wcol, vec3(0.94, 0.97, 0.94), foam);
        diffuseColor.rgb = wcol;
        diffuseColor.a = mix(0.32, 1.0, clamp(foam * 1.1 + vFoam * 0.6, 0.0, 1.0));
      }`
    );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, uniforms };
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
