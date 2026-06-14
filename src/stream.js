import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { streamCurve, STREAM_HALF_WIDTH } from './streamPath.js';
import { WATER_LEVEL, terrainHeight } from './terrain.js';

// Official three.js Water (normal-mapped, reflective, animated) on a large flat
// plane at the water level. The terrain is solid land everywhere EXCEPT the
// river channel (carved below the waterline), so this plane is hidden under the
// ground everywhere except along the river — water shows ONLY in the river.
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
    sunColor: 0xfff0cc,
    waterColor: 0x2d5247,
    distortionScale: 3.6,
    fog: false,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  group.add(water);

  // ---- rocks in / along the river, poking through the surface ----
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8b8676'),
    roughness: 0.95,
    flatShading: true,
  });
  const RC = 64;
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, RC);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const base = new THREE.Color('#8b8676');
  const moss = new THREE.Color('#5d6a3a');
  const dark = new THREE.Color('#6c6757');
  for (let i = 0; i < RC; i++) {
    const tt = Math.random();
    const p = streamCurve.getPointAt(tt);
    const tan = streamCurve.getTangentAt(tt);
    const bx = -tan.z, bz = tan.x;
    const bl = Math.hypot(bx, bz) || 1;
    const lat = (Math.random() - 0.5) * (STREAM_HALF_WIDTH + 2) * 2;
    const cx = p.x + (bx / bl) * lat;
    const cz = p.z + (bz / bl) * lat;
    const s = 0.8 + Math.random() * 2.0;
    const groundY = terrainHeight(cx, cz);
    dummy.position.set(cx, Math.max(groundY, WATER_LEVEL - 0.4) + s * 0.3, cz);
    dummy.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
    dummy.scale.set(s * (0.9 + Math.random() * 0.5), s * (0.55 + Math.random() * 0.4), s * (0.9 + Math.random() * 0.5));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    const pick = Math.random();
    col.copy(pick < 0.4 ? moss : pick < 0.7 ? base : dark);
    rocks.setColorAt(i, col);
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  group.add(rocks);

  return {
    group,
    update(dt) {
      water.material.uniforms['time'].value += dt * 0.7;
    },
  };
}
