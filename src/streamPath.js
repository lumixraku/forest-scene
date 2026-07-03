import * as THREE from 'three';

// One river through the sunlit clearing, kept within the terrain bounds.
export const STREAM_HALF_WIDTH = 7.0;

const points = [
  [-150, 9],
  [-95, -2],
  [-40, -11],
  [-5, -15],
  [40, -18],
  [95, -22],
  [150, -27],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export const streamCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
export const streamSamples = streamCurve.getSpacedPoints(200);

export function distToStream(x, z) {
  let min = Infinity;
  for (const p of streamSamples) {
    const dx = x - p.x;
    const dz = z - p.z;
    const d = dx * dx + dz * dz;
    if (d < min) min = d;
  }
  // wobble so the banks meander instead of running like a canal
  return Math.sqrt(min) + Math.sin(x * 0.16) * 0.9 + Math.cos(z * 0.2) * 0.7;
}
