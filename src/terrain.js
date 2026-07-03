import * as THREE from 'three';
import { streamAt, levelAt, levelSmoothAt, halfWidthAt, waterLevelAt } from './streamPath.js';

// A terraced brook valley: the floor follows the stream's stepped elevation
// profile, so the whole scene descends downstream. Away from the water the
// slopes climb with rolling knolls — no more billiard-table flatness.
export function terrainHeight(x, z) {
  const { d, t } = streamAt(x, z);
  const lvlSharp = levelAt(t);
  // terrace steps only near the water; hillsides follow the smooth grade
  const lvl = THREE.MathUtils.lerp(lvlSharp, levelSmoothAt(t), smoothstep(8, 28, d));

  // valley sides climbing away from the local water level
  let h = lvl + 1.0 + 15.0 * smoothstep(10, 95, d);

  // fine roughness, damped right next to the water
  const rough = 0.35 + 0.65 * smoothstep(7, 22, d);
  h += (Math.sin(x * 0.045) * 1.1 + Math.cos(z * 0.05) * 0.9 + Math.sin(x * 0.13 + z * 0.11) * 0.5) * rough;

  // broad grassy knolls for real relief on the slopes
  h += Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.024 + 0.5) * 2.6 * smoothstep(12, 34, d);

  // carve the channel below the local waterline
  const bed = halfWidthAt(t);
  const bank = bed + 4;
  if (d < bank) {
    const k = THREE.MathUtils.clamp((bank - d) / (bank - bed), 0, 1);
    h = THREE.MathUtils.lerp(h, lvlSharp - 1.6, smoothstep(0.15, 1.0, k));
  }
  return h;
}

export function isLand(x, z, margin = 0.8) {
  return terrainHeight(x, z) > waterLevelAt(x, z) + margin;
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
