import * as THREE from 'three';

// Drifting dust motes caught in the light + small birds circling the clearing.
export function createParticles(scene, clearing) {
  // ---- dust motes ----
  const N = 900;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const box = { x: 34, y: 14, z: 34, cx: clearing.x, cy: 7, cz: clearing.y };
  for (let i = 0; i < N; i++) {
    pos[i * 3] = box.cx + (Math.random() - 0.5) * box.x;
    pos[i * 3 + 1] = box.cy + Math.random() * box.y;
    pos[i * 3 + 2] = box.cz + (Math.random() - 0.5) * box.z;
    vel[i * 3] = (Math.random() - 0.5) * 0.3;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 0.15 + 0.05;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(
    g,
    new THREE.PointsMaterial({
      size: 0.5,
      map: dotTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color('#fff2c8'),
      opacity: 0.85,
      sizeAttenuation: true,
    })
  );
  scene.add(dust);

  // ---- birds ----
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x33291c, fog: true, side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < 6; i++) {
    const b = makeBird(birdMat);
    Object.assign(b.userData, {
      radius: 22 + Math.random() * 16,
      speed: 0.18 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
      height: 15 + Math.random() * 6,
      cx: clearing.x,
      cz: clearing.y,
      flap: Math.random() * Math.PI * 2,
    });
    scene.add(b);
    birds.push(b);
  }

  return {
    update(dt, t) {
      const arr = g.attributes.position.array;
      for (let i = 0; i < N; i++) {
        arr[i * 3] += vel[i * 3] * dt + Math.sin(t * 0.5 + i) * 0.01;
        arr[i * 3 + 1] += vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += vel[i * 3 + 2] * dt + Math.cos(t * 0.4 + i) * 0.01;
        if (arr[i * 3 + 1] > box.cy + box.y) {
          arr[i * 3 + 1] = box.cy;
          arr[i * 3] = box.cx + (Math.random() - 0.5) * box.x;
          arr[i * 3 + 2] = box.cz + (Math.random() - 0.5) * box.z;
        }
        if (Math.abs(arr[i * 3] - box.cx) > box.x / 2) arr[i * 3] = box.cx + (Math.random() - 0.5) * box.x;
        if (Math.abs(arr[i * 3 + 2] - box.cz) > box.z / 2) arr[i * 3 + 2] = box.cz + (Math.random() - 0.5) * box.z;
      }
      g.attributes.position.needsUpdate = true;

      for (const b of birds) {
        const u = b.userData;
        u.phase += u.speed * dt;
        b.position.set(
          u.cx + Math.cos(u.phase) * u.radius,
          u.height + Math.sin(u.phase * 2) * 1.2,
          u.cz + Math.sin(u.phase) * u.radius
        );
        b.rotation.y = -u.phase;
        const flap = Math.sin(t * 8 + u.flap) * 0.6;
        b.userData.lw.rotation.z = flap;
        b.userData.rw.rotation.z = -flap;
      }
    },
  };
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,248,214,1)');
  grad.addColorStop(0.35, 'rgba(255,240,190,0.55)');
  grad.addColorStop(1, 'rgba(255,240,190,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeBird(mat) {
  const g = new THREE.Group();
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1.5, 0, 0.25, 1.5, 0.05, -0.9], 3)
  );
  wingGeo.computeVertexNormals();
  const lw = new THREE.Mesh(wingGeo, mat);
  const rw = new THREE.Mesh(wingGeo, mat);
  rw.scale.x = -1;
  g.add(lw, rw);
  g.userData = { lw, rw };
  return g;
}
