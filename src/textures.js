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

// Leafy mound studded with five-petal blossoms — the vivid flower bushes
// hugging the banks in the reference footage.
export function makeFlowerBushTexture(petal = '#d13d9e', centre = '#f6e08a') {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');

  // dark leafy base cluster
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 105;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r * 0.9;
    const litK = THREE.MathUtils.clamp(0.5 - (y - S / 2) / 200, 0, 1);
    ctx.fillStyle = `hsl(${112 + (Math.random() - 0.5) * 20}, ${40 + Math.random() * 14}%, ${24 + litK * 22 + Math.random() * 8}%)`;
    const w = 9 + Math.random() * 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, w * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // blossoms: five petals + a warm centre dot
  const petalCol = new THREE.Color(petal);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 92;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r * 0.9;
    const pr = 4.5 + Math.random() * 4;
    const tone = petalCol.clone().offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.12 + 0.04);
    ctx.fillStyle = `#${tone.getHexString()}`;
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(pa) * pr, y + Math.sin(pa) * pr, pr * 0.75, pr * 0.55, pa, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = centre;
    ctx.beginPath();
    ctx.arc(x, y, pr * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

// Fan of slender arcing sedge blades, dark green with pale tips — the grassy
// clumps overhanging the waterline.
export function makeSedgeTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const baseX = S / 2, baseY = S - 6;
  for (let i = 0; i < 46; i++) {
    const lean = (Math.random() - 0.5) * 1.7;
    const len = 150 + Math.random() * 95;
    const hue = 100 + (Math.random() - 0.5) * 24;
    const light = 20 + Math.random() * 12;
    // draw each blade as tapering segments, lightening toward the tip
    const STEPS = 8;
    let px = baseX + (Math.random() - 0.5) * 26, py = baseY;
    for (let sgm = 0; sgm < STEPS; sgm++) {
      const k = sgm / STEPS;
      const nx = baseX + Math.sin(lean * (k + 1 / STEPS)) * len * (k + 1 / STEPS);
      const ny = baseY - Math.cos(lean * (k + 1 / STEPS) * 0.6) * len * (k + 1 / STEPS);
      ctx.strokeStyle = `hsl(${hue}, ${38 + Math.random() * 10}%, ${light + k * 16}%)`;
      ctx.lineWidth = (1 - k) * 4.5 + 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      px = nx; py = ny;
    }
  }
  return toTexture(c);
}

// A single pointed-oval leaf: two quadratic curves from the base, a midrib,
// and the occasional sunlit rim — the unit every foliage texture is built of.
function drawLeaf(ctx, x, y, ang, len, colors, widthK = 0.42) {
  const w = len * widthK * (0.85 + Math.random() * 0.3);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const tx = x + dx * len, ty = y + dy * len;
  const mx = x + dx * len * 0.45, my = y + dy * len * 0.45;
  const r = Math.random();
  ctx.fillStyle = r < 0.34 ? colors[0] : r < 0.72 ? colors[1] : colors[2];
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx - dy * w, my + dx * w, tx, ty);
  ctx.quadraticCurveTo(mx + dy * w, my - dx * w, x, y);
  ctx.closePath();
  ctx.fill();
  if (len > 14) {
    ctx.strokeStyle = 'rgba(26,38,20,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  if (Math.random() < 0.2) {
    ctx.strokeStyle = 'rgba(214,232,150,0.5)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx - dy * w, my + dx * w, tx, ty);
    ctx.stroke();
  }
}

// Sun/shade grade baked into a foliage card: warm light from above, cool
// depth below. Applied source-atop so the alpha silhouette is untouched.
function shadeTopDown(ctx, W, H, topA = 0.2, botA = 0.42) {
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(255,248,214,${topA})`);
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(8,16,6,${botA})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

// One whole pagoda-tree branch drawn side-on (小叶榄仁): a woody stem that
// FORKS repeatedly — main branch splits into 2-3 sub-branches, each splitting
// again, fanning out toward the card edge — with leaf rosettes riding the
// forks and clustering densest at the fine twig tips. The ramified skeleton
// stays readable through the foliage. Used on fanned instanced cards.
export function makePagodaBranchTexture(colors = ['#3f6626', '#5d8836', '#8cb050']) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';

  // rosette of leaves radiating from a twig tip
  function rosette(x, y, size) {
    const n = 8 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) {
      drawLeaf(ctx, x, y, Math.random() * Math.PI * 2, size * (0.7 + Math.random() * 0.6), colors, 0.5);
    }
  }

  const segs = [];
  // recursive forking skeleton: each segment splits into 2 (sometimes 3)
  // thinner children that diverge and drift slightly upward, like the flat
  // twig fans of a real Terminalia mantaly tier
  function fork(x, y, ang, len, w, depth) {
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    ctx.strokeStyle = depth < 2 ? '#584430' : '#4a3a26';
    ctx.globalAlpha = 0.92 - depth * 0.06;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5 + 3, ex, ey);
    ctx.stroke();
    ctx.globalAlpha = 1;
    segs.push({ x, y, ex, ey, depth });
    if (depth >= 3 || ex > 495) {
      rosette(ex, ey - 4, 17 + Math.random() * 9);
      return;
    }
    const spread = 0.2 + Math.random() * 0.14 + depth * 0.05;
    const upDrift = -0.05; // tips turn up a touch
    fork(ex, ey, ang - spread + upDrift, len * 0.74, w * 0.62, depth + 1);
    fork(ex, ey, ang + spread + upDrift, len * 0.74, w * 0.62, depth + 1);
    if (depth < 2 && Math.random() < 0.45) {
      fork(ex, ey, ang + (Math.random() - 0.5) * 0.16 + upDrift, len * 0.68, w * 0.55, depth + 1);
    }
  }
  fork(8, 172, -0.04, 160, 5.5, 0);

  // leaf rosettes riding along the top of every branch segment — sparser on
  // the thick inner wood so the fork structure stays visible, denser out on
  // the fine twigs
  for (const s of segs) {
    const n = s.depth === 0 ? 2 : s.depth + 1;
    for (let i = 0; i < n; i++) {
      const t = 0.25 + Math.random() * 0.7;
      const px = s.x + (s.ex - s.x) * t;
      const py = s.y + (s.ey - s.y) * t;
      rosette(px + (Math.random() - 0.5) * 8, py - 5 - Math.random() * (10 + s.depth * 10), 11 + Math.random() * 7 + s.depth * 2);
    }
    // a few leaves hanging under the fine twigs
    if (s.depth >= 2 && Math.random() < 0.7) {
      drawLeaf(ctx, s.ex - 8, s.ey + 4 + Math.random() * 6, Math.PI / 2 + (Math.random() - 0.5) * 1.4, 11 + Math.random() * 8, colors, 0.5);
    }
  }

  shadeTopDown(ctx, W, H, 0.24, 0.3);
  return toTexture(c);
}

// One whole ginkgo branch drawn side-on: a woody twig forking gently upward,
// with tufts of FAN-shaped leaves (the unmistakable ginkgo silhouette) riding
// spur shoots along every segment — autumn gold. Same recipe as the pagoda
// branch: readable skeleton, foliage densest at the fine twig tips.
export function makeGinkgoBranchTexture(colors = ['#c99a20', '#e2b93e', '#f2d465']) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';

  // one fan leaf: short petiole, then a circle sector spreading ~60-80°
  function fanLeaf(x, y, ang, size) {
    const px = x + Math.cos(ang) * size * 0.45, py = y + Math.sin(ang) * size * 0.45;
    ctx.strokeStyle = 'rgba(120,88,28,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(px, py);
    ctx.stroke();
    const r = Math.random();
    ctx.fillStyle = r < 0.34 ? colors[0] : r < 0.72 ? colors[1] : colors[2];
    const spread = 1.0 + Math.random() * 0.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, size * (0.8 + Math.random() * 0.3), ang - spread / 2, ang + spread / 2);
    ctx.closePath();
    ctx.fill();
  }

  // spur shoot: a tuft of fans spraying up and outward from one point
  function spur(x, y, size) {
    const n = 4 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      fanLeaf(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 4, ang, size * (0.75 + Math.random() * 0.5));
    }
  }

  const segs = [];
  function fork(x, y, ang, len, w, depth) {
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    ctx.strokeStyle = depth < 2 ? '#6b573c' : '#5a4832';
    ctx.globalAlpha = 0.95 - depth * 0.08;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5 + 2, ex, ey);
    ctx.stroke();
    ctx.globalAlpha = 1;
    segs.push({ x, y, ex, ey, depth });
    if (depth >= 3 || ex > 495) {
      spur(ex, ey - 3, 15 + Math.random() * 7);
      return;
    }
    const spread = 0.16 + Math.random() * 0.12 + depth * 0.04;
    const upDrift = -0.08; // ginkgo twigs angle upward
    fork(ex, ey, ang - spread + upDrift, len * 0.72, w * 0.6, depth + 1);
    fork(ex, ey, ang + spread + upDrift, len * 0.72, w * 0.6, depth + 1);
  }
  fork(8, 165, -0.12, 155, 5, 0);

  // spur shoots dotted along every segment, denser toward the tips
  for (const s of segs) {
    const n = s.depth + 1;
    for (let i = 0; i < n; i++) {
      const t = 0.3 + Math.random() * 0.65;
      const px = s.x + (s.ex - s.x) * t;
      const py = s.y + (s.ey - s.y) * t;
      spur(px, py - 4 - Math.random() * (6 + s.depth * 6), 10 + Math.random() * 6 + s.depth * 2);
    }
    // a few fans hanging below the fine twigs
    if (s.depth >= 2 && Math.random() < 0.6) {
      fanLeaf(s.ex - 6, s.ey + 5, Math.PI / 2 + (Math.random() - 0.5) * 0.8, 12 + Math.random() * 6);
    }
  }

  shadeTopDown(ctx, W, H, 0.22, 0.26);
  return toTexture(c);
}

export function makeLeafBlobTexture(colors = ['#57652a', '#7c9440', '#a4b858']) {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 1100; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.5) * 214;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r * 0.88;
    drawLeaf(ctx, x, y, Math.random() * Math.PI * 2, 11 + Math.random() * 20, colors, 0.62);
  }
  // pale glints clustered toward the top
  for (let i = 0; i < 150; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * 190;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r * 0.7 - 30;
    const o = 3.5 + Math.random() * 7;
    ctx.fillStyle = 'rgba(196,214,136,0.7)';
    ctx.beginPath();
    ctx.ellipse(x, y, o, o * 0.55, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  shadeTopDown(ctx, S, S, 0.18, 0.5);
  return toTexture(c);
}

// Leaves covering the whole canvas edge-to-edge — for wrapping SMALL foliage
// blobs, where the disc layout of makeLeafBlobTexture would leave the poles
// and seam transparent and the blob would read as a hollow wreath.
export function makeLeafFillTexture(colors = ['#57652a', '#7c9440', '#a4b858']) {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 700; i++) {
    drawLeaf(ctx, Math.random() * S, Math.random() * S, Math.random() * Math.PI * 2, 8 + Math.random() * 13, colors, 0.62);
  }
  shadeTopDown(ctx, S, S, 0.15, 0.4);
  return toTexture(c);
}

// One whole spruce branch drawn side-on: a bezier stem with alternating side
// twigs, every twig fringed with curved needle strokes in three green tones.
export function makeNeedleBranchTexture(colors = ['#24421f', '#3a5c2a', '#5c7c3a']) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const p0 = { x: 8, y: 120 }, p1 = { x: 280, y: 100 }, p2 = { x: 504, y: 152 };
  const at = (t) => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  });
  const tangent = (t) => {
    const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  };

  function needle(x, y, ang, len, width, alpha) {
    const r = Math.random();
    ctx.strokeStyle = r < 0.3 ? colors[0] : r < 0.68 ? colors[1] : colors[2];
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    const curl = (Math.random() - 0.5) * 0.5;
    const mx = x + Math.cos(ang + curl * 0.5) * len * 0.55;
    const my = y + Math.sin(ang + curl * 0.5) * len * 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, x + Math.cos(ang + curl) * len, y + Math.sin(ang + curl) * len);
    ctx.stroke();
    if (Math.random() < 0.16) {
      ctx.strokeStyle = 'rgba(214,228,182,0.5)';
      ctx.lineWidth = width * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(mx, my - 0.8, x + Math.cos(ang + curl) * len, y + Math.sin(ang + curl) * len - 0.8);
      ctx.stroke();
    }
  }
  function tuft(x, y, ang, count, len, width) {
    for (let i = 0; i < count; i++) {
      needle(x, y, ang + (i % 2 === 0 ? 1 : -1) * (0.45 + Math.random() * 0.85), len * (0.6 + Math.random() * 0.65), width, 0.66 + Math.random() * 0.34);
    }
  }

  // alternating side twigs, drooping slightly, fringed with needle tufts
  for (let i = 0; i < 26; i++) {
    const t = 0.05 + (i / 26) * 0.86 + Math.random() * 0.03;
    const s = at(t), tg = tangent(t);
    const side = i % 2 === 0 ? -1 : 1;
    const ang = Math.atan2(tg.y, tg.x) + side * (0.45 + Math.random() * 0.45);
    const len = (1 - t) * 64 + 22 + Math.random() * 20;
    ctx.strokeStyle = '#4a3a26';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.4;
    const ex = s.x + Math.cos(ang) * len, ey = s.y + Math.sin(ang) * len + side * 6;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + Math.cos(ang) * len * 0.5, s.y + Math.sin(ang) * len * 0.5 + side * 3, ex, ey);
    ctx.stroke();
    for (let k = 1; k <= 9; k++) {
      const q = k / 9;
      tuft(s.x + (ex - s.x) * q, s.y + (ey - s.y) * q + side * 6 * q * q, ang, 7, 20 - q * 8, 1.4);
    }
    for (let k = 0; k < 5; k++) needle(ex, ey, ang + (Math.random() - 0.5) * 1.2, 8 + Math.random() * 8, 1.2, 0.8 + Math.random() * 0.2);
  }

  // woody stem over the twig roots
  ctx.globalAlpha = 0.78;
  ctx.strokeStyle = '#54402a';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(140,112,76,0.45)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - 1.6);
  ctx.quadraticCurveTo(p1.x, p1.y - 1.6, p2.x, p2.y - 1.6);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // needle fringe along the whole stem
  for (let i = 0; i < 130; i++) {
    const t = i / 129;
    const s = at(t), tg = tangent(t);
    tuft(s.x, s.y, Math.atan2(tg.y, tg.x), 8, 34 - t * 12, 1.7);
  }
  // burst at the tip
  const tip = at(1);
  for (let i = 0; i < 26; i++) {
    const a = -0.6 + Math.random() * 1.2;
    ctx.strokeStyle = colors[2];
    ctx.globalAlpha = 0.85 + Math.random() * 0.15;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(tip.x - 8, tip.y);
    ctx.lineTo(tip.x - 8 + Math.cos(a) * (16 + Math.random() * 16), tip.y + Math.sin(a) * (16 + Math.random() * 16));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
}

// Vertical spire for the spruce top — a leader stem ringed with needle
// whorls that tighten toward the tip. Used on 3 crossed cards per tree.
export function makeSpruceTopTexture(colors = ['#24421f', '#3a5c2a', '#5c7c3a']) {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.globalAlpha = 0.78;
  ctx.strokeStyle = '#54402a';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(128, 500);
  ctx.quadraticCurveTo(120, 260, 128, 16);
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (let r = 0; r < 72; r++) {
    const t = r / 71;
    const y = 492 - t * 464;
    const halfW = 14 + (1 - t) * 84;
    if (r % 4 === 0 && t < 0.85) {
      const side = (r / 4) % 2 === 0 ? -1 : 1;
      const len = halfW * 0.8;
      ctx.strokeStyle = '#4a3a26';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(128, y);
      ctx.quadraticCurveTo(128 + side * len * 0.5, y + 4, 128 + side * len, y + 10 + Math.random() * 8);
      ctx.stroke();
    }
    for (let k = 0; k < 9; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const droop = 0.35 + Math.random() * 0.65;
      const len = halfW * (0.5 + Math.random() * 0.55);
      const q = Math.random();
      ctx.strokeStyle = q < 0.3 ? colors[0] : q < 0.68 ? colors[1] : colors[2];
      ctx.globalAlpha = 0.7 + Math.random() * 0.3;
      ctx.lineWidth = 1.9;
      const x0 = 128 + (Math.random() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.quadraticCurveTo(x0 + side * len * 0.5 * Math.cos(droop), y + len * 0.45 * Math.sin(droop), x0 + side * len * Math.cos(droop), y + len * Math.sin(droop));
      ctx.stroke();
    }
  }
  // tip burst
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
    ctx.strokeStyle = colors[2];
    ctx.globalAlpha = 0.8 + Math.random() * 0.2;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(128, 22);
    ctx.lineTo(128 + Math.cos(a) * (12 + Math.random() * 14), 22 + Math.sin(a) * (12 + Math.random() * 14));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
}

// Rich bark: wavy vertical fissures with lit ridges, bark plates, thousands
// of thin fibre strokes, a few knots, moss flecks, and a darkened mossy base
// (v maps once over the trunk height, so the base shading lands at the roots).
export function makeBarkTexture({ base = '#6a5844', crack = 'rgba(24,18,12,1)', ridge = 'rgba(158,136,104,1)', knots = true } = {}) {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // deep vertical fissures, each shadow crack paired with a lit ridge
  for (let i = 0; i < 26; i++) {
    const x0 = Math.random() * W;
    ctx.strokeStyle = crack;
    ctx.globalAlpha = 0.22 + Math.random() * 0.36;
    ctx.lineWidth = 2 + Math.random() * 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let x = x0;
    ctx.moveTo(x, -8);
    for (let y = 0; y <= H + 12; y += 30) { x += (Math.random() - 0.5) * 16; ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.strokeStyle = ridge;
    ctx.globalAlpha = 0.1 + Math.random() * 0.15;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    x = x0 + 3 + Math.random() * 3;
    ctx.moveTo(x, -8);
    for (let y = 0; y <= H + 12; y += 30) { x += (Math.random() - 0.5) * 16; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // bark plates — small outlined quads between the fissures
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const w = 5 + Math.random() * 16, h = 9 + Math.random() * 30;
    ctx.fillStyle = Math.random() < 0.5 ? crack : ridge;
    ctx.globalAlpha = 0.05 + Math.random() * 0.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + (Math.random() - 0.5) * 5);
    ctx.lineTo(x + w + (Math.random() - 0.5) * 4, y + h);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, y + h + (Math.random() - 0.5) * 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(16,12,8,0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // thin vertical fibre strokes give the grain
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const len = 20 + Math.random() * 130;
    ctx.strokeStyle = Math.random() < 0.6 ? crack : ridge;
    ctx.globalAlpha = 0.07 + Math.random() * 0.16;
    ctx.lineWidth = 0.8 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 14, y + len * 0.5, x + (Math.random() - 0.5) * 8, y + len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // a few knots
  if (knots) {
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * W, y = 40 + Math.random() * (H - 120);
      const g = ctx.createRadialGradient(x, y, 1, x, y, 10 + Math.random() * 14);
      g.addColorStop(0, 'rgba(22,16,12,0.85)');
      g.addColorStop(0.55, 'rgba(38,30,22,0.45)');
      g.addColorStop(1, 'rgba(38,30,22,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 12 + Math.random() * 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(96,80,60,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 25 + Math.random() * 4, 15 + Math.random() * 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // moss flecks, denser toward one side
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W * 0.6, y = Math.random() * H;
    const r = 2 + Math.random() * 7;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(140,156,96,0.16)' : 'rgba(112,132,76,0.14)';
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.arc(x + (Math.random() - 0.5) * r * 1.6, y + (Math.random() - 0.5) * r * 1.6, r * (0.3 + Math.random() * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // fine speckle
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.1)' : 'rgba(255,252,244,0.05)';
    ctx.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random(), 1 + Math.random());
  }

  // shaded, mossy base
  const dark = ctx.createLinearGradient(0, H, 0, H * 0.68);
  dark.addColorStop(0, 'rgba(10,12,6,0.55)');
  dark.addColorStop(1, 'rgba(10,12,6,0)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  const moss = ctx.createLinearGradient(0, H, 0, H * 0.78);
  moss.addColorStop(0, 'rgba(84,104,56,0.38)');
  moss.addColorStop(1, 'rgba(84,104,56,0)');
  ctx.fillStyle = moss;
  ctx.fillRect(0, 0, W * 0.55, H);

  return toTexture(c, { repeat: true });
}

export function makeBirchTexture() {
  const W = 128, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d3cebe';
  ctx.fillRect(0, 0, W, H);
  // faint vertical grey smears
  for (let i = 0; i < 55; i++) {
    ctx.fillStyle = `rgba(110, 110, 100, ${0.06 + Math.random() * 0.12})`;
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
