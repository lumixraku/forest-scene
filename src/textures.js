import * as THREE from 'three';

// All textures are drawn procedurally on canvas — no external assets.
// They aim for the soft painterly-realistic look of the reference footage
// (leaf-card tree crowns, streaked bark, mottled meadow ground).

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Cluster of individual leaves with transparency — used on tree-crown cards.
export function makeLeafClusterTexture({ hue = 96, hueVar = 20, sat = 42, light = 34, leafW = 11, round = false } = {}) {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');

  // soft dark backdrop blobs give the cluster interior depth
  for (let i = 0; i < 7; i++) {
    const x = S / 2 + (Math.random() - 0.5) * 110;
    const y = S / 2 + (Math.random() - 0.5) * 110;
    const r = 34 + Math.random() * 40;
    // alpha kept below the material alphaTest so lone blobs clip out instead
    // of reading as solid dark discs — they only deepen leaf overlaps
    ctx.fillStyle = `hsla(${hue - 6}, ${sat}%, ${light * 0.6}%, 0.3)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // sub-cluster centres
  const centres = [];
  for (let i = 0; i < 6; i++) {
    centres.push({
      x: S / 2 + (Math.random() - 0.5) * 120,
      y: S / 2 + (Math.random() - 0.5) * 120,
    });
  }

  for (let i = 0; i < 180; i++) {
    const cc = centres[(Math.random() * centres.length) | 0];
    const x = cc.x + (Math.random() - 0.5) * 78;
    const y = cc.y + (Math.random() - 0.5) * 78;
    const dx = x - S / 2;
    const dy = y - S / 2;
    if (dx * dx + dy * dy > 118 * 118) continue;

    // leaves toward the upper-left catch the sun: brighter AND yellower,
    // shaded leaves stay deep cool green — the painterly two-tone of the ref
    const litK = THREE.MathUtils.clamp(0.55 - dx / 280 - dy / 190, 0, 1);
    const h = hue - litK * 26 + (Math.random() - 0.5) * hueVar;
    const s = sat + litK * 12 + Math.random() * 14;
    const l = light + litK * 28 + Math.random() * 10;

    const w = leafW * (0.7 + Math.random() * 0.6);
    const hh = w * (round ? 0.85 : 0.45);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, hh, 0, 0, Math.PI * 2);
    ctx.fill();
    // small sun-glint on the upper edge of lit leaves
    if (litK > 0.4) {
      ctx.fillStyle = `hsl(${h - 8}, ${Math.min(s + 8, 90)}%, ${Math.min(l + 13, 80)}%)`;
      ctx.beginPath();
      ctx.ellipse(-w * 0.15, -hh * 0.3, w * 0.55, hh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return toTexture(c);
}

// Opaque mottled leaf-mass tile for the solid crown cores, so the interior
// blobs read as dappled foliage instead of smooth plastic.
export function makeCanopyTexture({ hue = 96 } = {}) {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `hsl(${hue + 8}, 40%, 30%)`;
  ctx.fillRect(0, 0, S, S);
  // layered leaf daubs, dark first then sunlit
  for (let i = 0; i < 900; i++) {
    const k = i / 900; // later daubs are the lit ones
    const h = hue - k * 24 + (Math.random() - 0.5) * 18;
    const s = 40 + k * 14 + Math.random() * 12;
    const l = 28 + k * 28 + Math.random() * 10;
    ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${0.5 + Math.random() * 0.5})`;
    const w = 7 + Math.random() * 9;
    const x = Math.random() * S;
    const y = Math.random() * S;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, w * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // wrap edges roughly for tiling
    if (x < 20 || x > S - 20 || y < 20 || y > S - 20) {
      ctx.save();
      ctx.translate((x + S / 2) % S, (y + S / 2) % S);
      ctx.rotate(Math.random() * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, w, w * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  return toTexture(c, { repeat: true });
}

// Full spruce silhouette — drawn once, used on 3 crossed vertical cards.
export function makeSpruceTexture() {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');

  // trunk
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(W / 2, 40);
  ctx.lineTo(W / 2, H - 4);
  ctx.stroke();

  // drooping needle branches, denser + wider toward the bottom
  for (let i = 0; i < 900; i++) {
    const y = 34 + Math.pow(Math.random(), 0.8) * (H - 70);
    const halfW = 8 + ((y - 20) / H) * 108;
    const x0 = W / 2 + (Math.random() - 0.5) * 10;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const len = (0.35 + Math.random() * 0.65) * halfW;
    const droop = len * (0.25 + Math.random() * 0.3);
    const l = 16 + Math.random() * 16;
    ctx.strokeStyle = `hsla(${100 + Math.random() * 20}, ${30 + Math.random() * 18}%, ${l}%, 0.9)`;
    ctx.lineWidth = 2 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0 + dir * len * 0.6, y + droop * 0.35, x0 + dir * len, y + droop);
    ctx.stroke();
  }
  return toTexture(c);
}

export function makeBarkTexture() {
  const W = 128, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6a5844';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const light = Math.random() < 0.5;
    ctx.strokeStyle = light
      ? `rgba(150, 130, 100, ${0.12 + Math.random() * 0.2})`
      : `rgba(40, 30, 20, ${0.15 + Math.random() * 0.25})`;
    ctx.lineWidth = 1.5 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(x, -8);
    for (let y = 0; y <= H + 8; y += 32) {
      ctx.lineTo(x + (Math.random() - 0.5) * 10, y);
    }
    ctx.stroke();
  }
  const tex = toTexture(c, { repeat: true });
  return tex;
}

export function makeBirchTexture() {
  const W = 128, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e7e3d7';
  ctx.fillRect(0, 0, W, H);
  // faint vertical grey smears
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(120, 120, 110, ${0.05 + Math.random() * 0.1})`;
    const x = Math.random() * W;
    ctx.fillRect(x, 0, 2 + Math.random() * 8, H);
  }
  // dark horizontal lenticel dashes
  for (let i = 0; i < 34; i++) {
    const y = Math.random() * H;
    const x = Math.random() * W;
    const w = 8 + Math.random() * 30;
    const h = 2 + Math.random() * 5;
    ctx.fillStyle = `rgba(30, 30, 26, ${0.55 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { repeat: true });
}

// Mottled meadow ground — tiled under the instanced grass.
export function makeGroundTexture() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a682f';
  ctx.fillRect(0, 0, S, S);
  const tones = ['#4c5c28', '#66772f', '#7c8c3c', '#57512c', '#6f7f38'];
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
    ctx.globalAlpha = 0.15 + Math.random() * 0.3;
    const r = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: true });
}

// Lupine-like flower spike (stem + coloured dot column) on a transparent card.
export function makeFlowerSpikeTexture(base = '#8a55c0', tip = '#d9a0e8') {
  const W = 64, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const cb = new THREE.Color(base);
  const ct = new THREE.Color(tip);

  // stem + two little leaves
  ctx.strokeStyle = '#40582a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2, H);
  ctx.quadraticCurveTo(W / 2 + 4, H * 0.7, W / 2, H * 0.4);
  ctx.stroke();
  ctx.fillStyle = '#4a6430';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(W / 2 + side * 9, H * 0.82, 10, 4, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // blossom column, tighter and lighter toward the top
  for (let i = 0; i < 60; i++) {
    const t = Math.random(); // 0 top -> 1 bottom of the blossom column
    const y = H * 0.06 + t * H * 0.48;
    const spread = 4 + t * 7;
    const x = W / 2 + (Math.random() - 0.5) * spread * 2;
    const col = ct.clone().lerp(cb, t * (0.7 + Math.random() * 0.3));
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.beginPath();
    ctx.arc(x, y, 1.7 + Math.random() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

// Small meadow flower cluster (daisy-ish dots) on a transparent card.
export function makeMeadowFlowerTexture() {
  const S = 64;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const cols = ['#f4e26a', '#fdfbee', '#f0c74a', '#f3ae59'];
  for (let i = 0; i < 9; i++) {
    const x = S / 2 + (Math.random() - 0.5) * 40;
    const y = S / 2 + (Math.random() - 0.5) * 40;
    const r = 3.5 + Math.random() * 3.5;
    const col = cols[(Math.random() * cols.length) | 0];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,140,30,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

// White wake around an emergent rock: a foam bow on the upstream side (left)
// breaking into streaks that trail off downstream (+x = downstream).
export function makeFoamStreakTexture() {
  const W = 256, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const cx = 70, cy = H / 2;

  // upstream bow — dense broken froth wrapping the left side
  for (let i = 0; i < 260; i++) {
    const a = Math.PI * 0.5 + Math.random() * Math.PI;
    const r = 34 + (Math.random() - 0.5) * 16;
    const x = cx + Math.cos(a) * r * 1.05;
    const y = cy + Math.sin(a) * r * 0.8;
    ctx.fillStyle = `rgba(255,255,252,${0.28 + Math.random() * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + Math.random() * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // foam trails fading downstream
  for (let i = 0; i < 90; i++) {
    const y = cy + (Math.random() - 0.5) * 62;
    const x0 = cx + Math.random() * 30;
    const len = 30 + Math.random() * 130;
    const grad = ctx.createLinearGradient(x0, 0, x0 + len, 0);
    grad.addColorStop(0, `rgba(255,255,252,${0.22 + Math.random() * 0.35})`);
    grad.addColorStop(1, 'rgba(255,255,252,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0 + len * 0.5, y + (Math.random() - 0.5) * 8, x0 + len, y + (Math.random() - 0.5) * 14);
    ctx.stroke();
  }
  return toTexture(c);
}

// Sunlit sandy streambed strewn with pale pebbles — what you see THROUGH the
// clear water, so it's kept warm and bright like the reference footage.
export function makeBedTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8f8468';
  ctx.fillRect(0, 0, S, S);
  const tones = ['#a99d7f', '#7c745c', '#b5ab8e', '#94886a', '#6f6852'];
  for (let i = 0; i < 650; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 2 + Math.random() * 7;
    ctx.globalAlpha = 0.5 + Math.random() * 0.5;
    ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    // pebble top-light
    ctx.globalAlpha *= 0.45;
    ctx.fillStyle = '#cfc5a8';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.25, r * 0.45, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: true });
}

export function makeRockTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a9488';
  ctx.fillRect(0, 0, S, S);
  const tones = ['#6e695e', '#b3aea1', '#847e70', '#a49e8f'];
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
    ctx.globalAlpha = 0.1 + Math.random() * 0.22;
    const r = 1 + Math.random() * 5;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // a few hairline cracks
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = 'rgba(50,46,40,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = Math.random() * S, y = Math.random() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (Math.random() - 0.5) * 30;
      y += (Math.random() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c, { repeat: true });
}
