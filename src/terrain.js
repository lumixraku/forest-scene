import * as THREE from 'three';
import { STREAM_HALF_WIDTH, distToStream } from './streamPath.js';

export const WATER_LEVEL = 0;

// A grassy stream valley: the land rises gently away from the water on both
// sides, so a ground-level camera by the stream sees sunlit slopes climbing
// into the treeline — matching the reference footage composition.
export function terrainHeight(x, z) {
  const sd = distToStream(x, z);

  // broad valley sides climbing away from the stream
  let h = 0.9 + 15.0 * smoothstep(10, 95, sd);

  // rolling irregularity, damped right next to the water so banks stay clean
  const rough = 0.35 + 0.65 * smoothstep(7, 22, sd);
  h += (Math.sin(x * 0.045) * 1.1 + Math.cos(z * 0.05) * 0.9 + Math.sin(x * 0.13 + z * 0.11) * 0.5) * rough;

  // carve the river channel below the waterline (water shows only here)
  const bed = STREAM_HALF_WIDTH;
  const bank = STREAM_HALF_WIDTH + 4;
  if (sd < bank) {
    const k = THREE.MathUtils.clamp((bank - sd) / (bank - bed), 0, 1);
    h = THREE.MathUtils.lerp(h, -1.7, smoothstep(0.15, 1.0, k));
  }
  return h;
}

export function isLand(x, z, margin = 0.8) {
  return terrainHeight(x, z) > WATER_LEVEL + margin;
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
