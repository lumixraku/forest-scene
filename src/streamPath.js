import * as THREE from 'three';

// One river through the sunlit clearing, kept within the terrain bounds.
export const STREAM_HALF_WIDTH = 7.0;

const points = [
  [-120, 4],
  [-60, -6],
  [-20, -13],
  [12, -16],
  [50, -19],
  [120, -24],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export const streamCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
export const streamSamples = streamCurve.getSpacedPoints(140);

export function distToStream(x, z) {
  let min = Infinity;
  for (const p of streamSamples) {
    const dx = x - p.x;
    const dz = z - p.z;
    const d = dx * dx + dz * dz;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}
