// Drive the camera on a long route and check the streaming invariants.
//
// Three things can only be tested by actually moving:
//   1. Determinism — leaving an area and coming back must rebuild it identically.
//      This is the property `withSeed` exists to provide, and the one a shared
//      global RNG could not give once build order depends on the player's path.
//   2. Disposal — geometry count must not climb monotonically as cells cycle.
//   3. Coverage — there must be ground under the camera everywhere, with no holes
//      at cell seams.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.SCENE_URL || 'http://localhost:5173/?capture';
const PORT = Number(process.env.CDP_WALK_PORT || 9477);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'forest-walk-'));
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push({ type: 'exception', text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
  } else if (m.method === 'Log.entryAdded') {
    logs.push({ type: m.params.entry.level, text: m.params.entry.text, url: m.params.entry.url || '' });
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
};

// Teleport, then let the queue drain fully so measurements are of a settled world.
const goTo = (x, z) => ev(`(async () => {
  const s = window.__scene;
  s.camera.position.set(${x}, s.camera.position.y, ${z});
  s.controls.target.set(${x} + 6, s.camera.position.y - 4, ${z} - 10);
  s.controls.update();
  for (let i = 0; i < 900; i++) {
    await new Promise(r => requestAnimationFrame(r));
    if (s.streaming.pending() === 0 && i > 20) break;
  }
  return { pending: s.streaming.pending() };
})()`);

// Fingerprint the ground under and around a point, plus memory counters.
const probe = () => ev(`(() => {
  const s = window.__scene, THREE = s.THREE;
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const cp = s.camera.position;
  let holes = 0, hits = 0, hsum = 0;
  // sample a 9x9 lattice of downward rays over a 160-unit square around the camera
  for (let a = -4; a <= 4; a++) {
    for (let b = -4; b <= 4; b++) {
      const x = cp.x + a * 20, z = cp.z + b * 20;
      rc.set(new THREE.Vector3(x, 400, z), down);
      rc.far = 900;
      const hit = rc.intersectObjects(s.scene.children, true).find(h => h.object.isMesh);
      if (!hit) { holes++; continue; }
      hits++;
      hsum += Math.round(hit.point.y * 1000);
    }
  }
  const info = s.renderer.info;
  return {
    cam: [Math.round(cp.x), Math.round(cp.z)],
    holes, hits, heightHash: hsum,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? null,
    cells: s.streaming.stats(),
  };
})()`);

await ev(`(async () => {
  for (let i = 0; i < 240; i++) {
    await new Promise(r => requestAnimationFrame(r));
    if (window.__scene?.streaming && window.__scene.streaming.pending() === 0 && i > 60) break;
  }
  return true;
})()`);

// A route that leaves the composed area entirely, visits far corners, and returns
// to two places it has already been.
const ROUTE = [
  [-45, 0], [120, -60], [340, 40], [430, -120],
  [120, 260], [-260, 120], [-430, -80], [-120, -260],
  [340, 40],   // revisit
  [-45, 0],    // revisit: home
];

const seen = new Map();
const rows = [];
let determinismFailures = 0;
let maxGeo = 0;

for (const [x, z] of ROUTE) {
  await goTo(x, z);
  const p = await probe();
  maxGeo = Math.max(maxGeo, p.geometries);
  const key = `${x},${z}`;
  let verdict = '';
  if (seen.has(key)) {
    const before = seen.get(key);
    if (before.heightHash === p.heightHash && before.holes === p.holes) verdict = 'REVISIT ok (identical)';
    else { verdict = `REVISIT MISMATCH (was ${before.heightHash}, now ${p.heightHash})`; determinismFailures++; }
  } else {
    seen.set(key, p);
  }
  rows.push({ ...p, verdict });
  console.log(`(${String(x).padStart(5)},${String(z).padStart(5)})  ground hits ${p.hits}/81  holes ${p.holes}  geo ${String(p.geometries).padStart(4)}  cells ${p.cells.map(c => c.id + ':' + c.cells).join(' ')}  ${verdict}`);
}

const totalHoles = rows.reduce((n, r) => n + r.holes, 0);
console.log('\n--- verdict ---');
console.log('ground holes across the whole route:', totalHoles, totalHoles === 0 ? '(none)' : '(HOLES FOUND)');
console.log('revisit determinism:', determinismFailures === 0 ? 'identical on every return' : `${determinismFailures} MISMATCHES`);
console.log('geometry count: start', rows[0].geometries, ' peak', maxGeo, ' end', rows[rows.length - 1].geometries);
const leak = rows[rows.length - 1].geometries > rows[0].geometries * 1.6;
console.log('dispose:', leak ? 'GEOMETRY MAY BE LEAKING' : 'bounded (no monotonic growth)');

const bad = logs.filter((l) => (l.type === 'error' || l.type === 'exception') && !/favicon/i.test(l.text + (l.url || '')));
console.log('console:', bad.length ? 'ERRORS' : 'clean');
for (const b of bad) console.log('  ', b.type, b.text);

writeFileSync(process.argv[2] || '/tmp/walk.json', JSON.stringify({ rows, totalHoles, determinismFailures }, null, 2));

try { ws.close(); } catch {}
chrome.kill('SIGKILL');
await sleep(300);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
if (totalHoles || determinismFailures || bad.length) process.exitCode = 1;
