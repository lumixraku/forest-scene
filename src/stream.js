import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { streamCurve, STREAM_HALF_WIDTH } from './streamPath.js';
import { WATER_LEVEL, terrainHeight } from './terrain.js';
import { makeRockTexture } from './textures.js';

// Bright lively mountain stream: the official Water plane underneath (shows
// only inside the carved channel), an animated white-foam ribbon riding just
// above it, and rounded textured boulders along the banks and in the water.
export function createStream(scene, sunDir) {
  const group = new THREE.Group();

  const waterGeometry = new THREE.PlaneGeometry(300, 300);
  const water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load('/waternormals.jpg', (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }),
    sunDirection: sunDir.clone().normalize(),
    sunColor: 0xfff4dd,
    waterColor: 0x4d7d6a, // bright glacial green
    distortionScale: 1.0,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  group.add(water);

  // ---- animated foam ribbon along the channel ----
  const foam = buildFoamRibbon();
  group.add(foam.mesh);

  // ---- rounded boulders: big on the banks, small in the water ----
  const rockTex = makeRockTexture();
  const rockMat = new THREE.MeshStandardMaterial({
    map: rockTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const variants = [buildRockGeo(), buildRockGeo(), buildRockGeo()];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  const sets = [
    { count: 30, latMin: STREAM_HALF_WIDTH + 0.5, latMax: STREAM_HALF_WIDTH + 5, sMin: 0.8, sMax: 2.0 }, // bank boulders
    { count: 60, latMin: 0, latMax: STREAM_HALF_WIDTH + 1, sMin: 0.3, sMax: 1.0 },                        // stones in the water
  ];
  for (const set of sets) {
    const per = Math.ceil(set.count / variants.length);
    for (const geo of variants) {
      const rocks = new THREE.InstancedMesh(geo, rockMat, per);
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      for (let i = 0; i < per; i++) {
        const tt = Math.random();
        const p = streamCurve.getPointAt(tt);
        const tan = streamCurve.getTangentAt(tt);
        const bx = -tan.z, bz = tan.x;
        const bl = Math.hypot(bx, bz) || 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        const lat = set.latMin + Math.random() * (set.latMax - set.latMin);
        const cx = p.x + (bx / bl) * lat * side;
        const cz = p.z + (bz / bl) * lat * side;
        const s = set.sMin + Math.random() * (set.sMax - set.sMin);
        const groundY = terrainHeight(cx, cz);
        dummy.position.set(cx, Math.max(groundY, WATER_LEVEL - 0.9) + s * 0.18, cz);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.scale.set(s * (0.85 + Math.random() * 0.4), s * (0.6 + Math.random() * 0.4), s * (0.85 + Math.random() * 0.4));
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
        col.setHSL(0.1, 0.04 + Math.random() * 0.06, 0.5 + Math.random() * 0.2);
        rocks.setColorAt(i, col);
      }
      rocks.instanceMatrix.needsUpdate = true;
      if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
      group.add(rocks);
    }
  }

  // hand-placed hero boulders in the water near the start view
  {
    const hero = [
      { t: 0.405, lat: -3.5, s: 1.9 }, { t: 0.418, lat: 1.5, s: 1.4 },
      { t: 0.432, lat: 4.5, s: 2.3 }, { t: 0.445, lat: -1.0, s: 1.1 },
      { t: 0.458, lat: -5.0, s: 1.6 },
    ];
    const rocks = new THREE.InstancedMesh(variants[0], rockMat, hero.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    hero.forEach((hr, i) => {
      const p = streamCurve.getPointAt(hr.t);
      const tan = streamCurve.getTangentAt(hr.t);
      const bx = -tan.z, bz = tan.x;
      const bl = Math.hypot(bx, bz) || 1;
      const cx = p.x + (bx / bl) * hr.lat;
      const cz = p.z + (bz / bl) * hr.lat;
      dummy.position.set(cx, WATER_LEVEL - 0.7 + hr.s * 0.35, cz);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(hr.s, hr.s * 0.75, hr.s);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.1, 0.05, 0.55 + Math.random() * 0.15);
      rocks.setColorAt(i, col);
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    group.add(rocks);
  }

  return {
    group,
    update(dt) {
      water.material.uniforms['time'].value += dt * 0.6;
      foam.uniforms.uTime.value += dt;
    },
  };
}

// Ribbon following the stream curve, with scrolling procedural foam noise.
function buildFoamRibbon() {
  const SEGS = 240;
  const halfW = STREAM_HALF_WIDTH - 1.4;
  const positions = [];
  const uvs = [];
  const index = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const p = streamCurve.getPointAt(t);
    const tan = streamCurve.getTangentAt(t);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    positions.push(p.x - (bx / bl) * halfW, WATER_LEVEL + 0.07, p.z - (bz / bl) * halfW);
    positions.push(p.x + (bx / bl) * halfW, WATER_LEVEL + 0.07, p.z + (bz / bl) * halfW);
    uvs.push(t, 0, t, 1);
    if (i < SEGS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      void main() {
        float u = vUv.x * 60.0;
        float v = vUv.y;
        float n1 = noise(vec2(u * 1.0 - uTime * 1.7, v * 7.0));
        float n2 = noise(vec2(u * 2.4 - uTime * 3.1, v * 16.0 + 7.0));
        float foam = smoothstep(0.55, 0.88, n1 * 0.55 + n2 * 0.45);
        float edge = smoothstep(0.75, 0.99, abs(v * 2.0 - 1.0)) * (0.4 + 0.6 * n2);
        float a = clamp(foam * 0.6 + edge * 0.45, 0.0, 1.0) * 0.65;
        vec3 col = mix(vec3(0.82, 0.9, 0.86), vec3(1.0), foam);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
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
