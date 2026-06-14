import * as THREE from 'three';
import { STREAM_HALF_WIDTH, distToStream } from './streamPath.js';

export const WATER_LEVEL = 0;

// Solid grassy/forested LAND everywhere. Only the river channel is carved below
// the waterline. Because the water mesh is just a ribbon along the channel (not
// a big plane), water exists ONLY in the river — the rest is all grass & trees.
export function terrainHeight(x, z) {
  const d = Math.sqrt(x * x + z * z);

  // gently rolling grassy land, well above the water
  let h = 2.2;
  h += Math.sin(x * 0.05) * 0.8 + Math.cos(z * 0.045) * 0.7 + Math.sin(x * 0.13 + z * 0.11) * 0.4;

  // flatten a clearing around the sunlit spot (0, -16)
  const cd = Math.hypot(x, z + 16);
  h *= 0.65 + 0.35 * smoothstep(2, 28, cd);

  // raise the far edges for an enclosed meadow
  h += smoothstep(70, 150, d) * 4.0;

  // carve the river channel below the waterline (water only here)
  const sd = distToStream(x, z);
  const bed = STREAM_HALF_WIDTH;
  const bank = STREAM_HALF_WIDTH + 4;
  if (sd < bank) {
    const k = THREE.MathUtils.clamp((bank - sd) / (bank - bed), 0, 1);
    h = THREE.MathUtils.lerp(h, -1.4, smoothstep(0.15, 1.0, k));
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
