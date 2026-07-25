import * as THREE from 'three';

// A single InstancedMesh spanning the whole ~290m field can never be frustum
// culled: its bounds cover everything, so every instance is submitted every
// frame and its wind vertex shader runs even for the crowns and bushes behind
// the camera. Bucketing the instances into a grid of chunks — one mesh per
// cell, all sharing the same material — lets three.js drop the cells that are
// off-screen. The grass field already does this inline; tree branches and
// understory blobs use the helpers here.
//
// GRID is a real trade-off, not a free win: finer cells cull more geometry but
// cost one draw call each. Measured on an M4 at 1470x774 — branches + blobs,
// median of ~1000 frames:
//   no chunking  121 calls  1,497,240 tris  2.4 ms CPU
//   GRID 3       147 calls  1,295,849 tris  2.6 ms CPU
//   GRID 6       187 calls  1,116,972 tris  3.1 ms CPU
// GPU frame time was identical across all three (min frame time 5.2-5.9 ms in
// every variant) because this scene is fragment-bound — alpha-tested foliage
// overdraw and the water shader — not triangle-bound. So 3 is the setting that
// buys the culling without the CPU regression; raise it only if the scene ever
// becomes vertex-heavy enough for triangles to matter.
const GRID = 3;
const FIELD = 300;

function chunkOf(x, z) {
  const c = FIELD / GRID;
  const cx = THREE.MathUtils.clamp(Math.floor((x + FIELD / 2) / c), 0, GRID - 1);
  const cz = THREE.MathUtils.clamp(Math.floor((z + FIELD / 2) / c), 0, GRID - 1);
  return cz * GRID + cx;
}

// Grab (creating if needed) the bucket of instances for whichever chunk holds
// this world position. Callers push matrices into `mats` and optional
// per-instance colours into `cols`.
export function bucketFor(buckets, x, z) {
  const key = chunkOf(x, z);
  let b = buckets.get(key);
  if (!b) buckets.set(key, (b = { mats: [], cols: [] }));
  return b;
}

// Turn the buckets into one InstancedMesh per chunk. The material and depth
// material are shared, so splitting costs no extra shader programs.
export function addChunkedInstances(scene, buckets, geo, mat, opts = {}) {
  const { castShadow = false, receiveShadow = false, depthMat = null } = opts;
  for (const { mats, cols } of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    if (depthMat) mesh.customDepthMaterial = depthMat;
    for (let i = 0; i < mats.length; i++) {
      mesh.setMatrixAt(i, mats[i]);
      if (cols.length) mesh.setColorAt(i, cols[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // instance-aware bounds -> real frustum culling
    scene.add(mesh);
  }
}
