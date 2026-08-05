// Catch ground cells that vanish while the camera is moving.
//
// `walk.mjs` teleports and then waits for the build queue to drain, so it only
// ever measures a settled world — it cannot see a flicker by construction. A
// flicker is a transient, so it has to be sampled every frame during motion.
//
// The test: glide the camera continuously and, each frame, record the set of
// ground cells that have geometry. A cell that was present, is still well inside
// the layer's radius, and now has nothing is a hole the viewer sees as a missing
// tile. Report how many frames each such gap lasted.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.SCENE_URL || 'http://localhost:5173/?capture';
const PORT = Number(process.env.CDP_FLICKER_PORT || 9466);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'forest-flicker-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=1470,774', '--hide-scrollbars', '--no-first-run', '--use-angle=metal', URL_BASE,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === 'page' && t.url.includes('localhost'));
    if (target?.webSocketDebuggerUrl) break;
  } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Runtime.enable');
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
};

// let the cold start settle
await ev(`(async () => {
  for (let i = 0; i < 300; i++) {
    await new Promise(r => requestAnimationFrame(r));
    if (window.__scene?.streaming?.pending() === 0 && i > 60) break;
  }
  return true;
})()`);

// Glide the camera in a straight line at a walking-ish speed, sampling the loaded
// ground set every single frame.
//
// A cell counts as "should be covered" only when it is comfortably inside the
// radius, so cells legitimately entering or leaving at the boundary are not
// mistaken for flicker.
const run = (dx, dz, frames, step) => ev(`(async () => {
  const s = window.__scene;
  const cam = s.camera, ctl = s.controls;
  const inner = ${Number(process.env.INNER_R || 600)};   // well inside the ground radius of 700
  let prev = null;
  const events = [];       // {key, gapFrames}
  const openGaps = new Map();
  let maxPending = 0, frameCount = 0;

  for (let f = 0; f < ${frames}; f++) {
    cam.position.x += ${dx} * ${step};
    cam.position.z += ${dz} * ${step};
    ctl.target.x += ${dx} * ${step};
    ctl.target.z += ${dz} * ${step};
    await new Promise(r => requestAnimationFrame(r));
    frameCount++;
    maxPending = Math.max(maxPending, s.streaming.pending());

    // the ground layer's own view of what is loaded
    const st = s.streaming.stats();
    const loaded = new Set(s.streaming.loadedKeys ? s.streaming.loadedKeys('ground') : []);

    if (prev) {
      for (const key of prev) {
        if (loaded.has(key)) {
          const g = openGaps.get(key);
          if (g !== undefined) { events.push({ key, gapFrames: frameCount - g }); openGaps.delete(key); }
          continue;
        }
        // absent this frame. is it still supposed to be covered?
        const [i, j] = key.split(',').map(Number);
        const cx = (i + 0.5) * 100, cz = (j + 0.5) * 100;
        const d = Math.hypot(cx - cam.position.x, cz - cam.position.z);
        if (d < inner && !openGaps.has(key)) openGaps.set(key, frameCount);
      }
    }
    prev = loaded;
  }
  // gaps still open when the run ended
  for (const [key, g] of openGaps) events.push({ key, gapFrames: frameCount - g, stillOpen: true });
  return { events, maxPending, frameCount, groundCells: s.streaming.stats().find(x => x.id === 'ground')?.cells };
})()`);

const hasKeys = await ev(`typeof window.__scene.streaming.loadedKeys === 'function'`);
if (!hasKeys) {
  console.log('streaming.loadedKeys(id) is not exposed — add it before running this harness.');
  try { ws.close(); } catch {}
  chrome.kill('SIGKILL'); await sleep(200);
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}

const LEGS = [
  { name: 'east   ', dx: 1, dz: 0 },
  { name: 'north  ', dx: 0, dz: -1 },
  { name: 'diag NE', dx: 0.707, dz: -0.707 },
  { name: 'back W ', dx: -1, dz: 0 },
];

let total = 0;
const all = [];
for (const leg of LEGS) {
  // 400 frames at 0.9 units/frame ≈ 360 units of travel — several LOD ring crossings
  const r = await run(leg.dx, leg.dz, 400, 0.9);
  const worst = r.events.reduce((m, e) => Math.max(m, e.gapFrames), 0);
  total += r.events.length;
  all.push({ leg: leg.name, ...r });
  console.log(`${leg.name}  frames ${r.frameCount}  ground cells ${r.groundCells}  peak queue ${String(r.maxPending).padStart(3)}  disappearances ${String(r.events.length).padStart(3)}  worst gap ${worst} frames`);
}

console.log('\n--- verdict ---');
console.log('cells that vanished while still well inside the radius:', total, total === 0 ? '(none — no flicker)' : '(FLICKER)');
if (total) {
  const byLen = all.flatMap(a => a.events).sort((a, b) => b.gapFrames - a.gapFrames).slice(0, 8);
  console.log('longest gaps:');
  for (const e of byLen) console.log(`   cell ${e.key.padEnd(10)} missing for ${e.gapFrames} frames${e.stillOpen ? ' (still missing at end of leg)' : ''}`);
}
if (logs.length) { console.log('exceptions:'); for (const l of logs) console.log('  ', l); }

writeFileSync(process.argv[2] || '/tmp/flicker.json', JSON.stringify(all, null, 2));
try { ws.close(); } catch {}
chrome.kill('SIGKILL');
await sleep(300);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
if (total) process.exitCode = 1;
