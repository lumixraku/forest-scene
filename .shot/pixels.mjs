// Ask the scene what is actually AT a screen position.
//
// A luma diff says "this band got darker" but not why. Raycasting the same
// normalised device coordinates tells you whether that pixel is sky, ground, or a
// crown, and how far away it is — which distinguishes "the lighting changed" from
// "there is now distant meadow where the sky used to be".
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.SCENE_URL || 'http://localhost:5173/?capture';
const PORT = Number(process.env.CDP_PIX_PORT || 9455);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'forest-pix-'));
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Runtime.enable');
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
};

await evaluate(`(async () => {
  for (let i = 0; i < 240; i++) {
    await new Promise(r => requestAnimationFrame(r));
    if (window.__scene?.streaming && window.__scene.streaming.pending() === 0 && i > 60) break;
  }
  return true;
})()`);

const out = await evaluate(`(async () => {
  const s = window.__scene;
  const THREE = s.THREE;
  const rc = new THREE.Raycaster();
  rc.far = 4000;
  const rows = [];
  // sample the centre of each third of the frame, matching diff.mjs regions
  for (const [ry, ylabel] of [[-0.667,'top'], [0,'mid'], [0.667,'bottom']]) {
    for (const [rx, xlabel] of [[-0.667,'left'], [0,'centre'], [0.667,'right']]) {
      rc.setFromCamera(new THREE.Vector2(rx, -ry), s.camera);
      const hits = rc.intersectObjects(s.scene.children, true)
        .filter(h => h.object.visible && h.object.type !== 'Mesh' || true);
      const h = hits[0];
      rows.push({
        region: ylabel + '-' + xlabel,
        hit: h ? (h.object.name || h.object.type + (h.object.isInstancedMesh ? '(inst)' : '')) : 'SKY',
        dist: h ? +h.distance.toFixed(1) : null,
        y: h ? +h.point.y.toFixed(2) : null,
        geoVerts: h ? h.object.geometry?.attributes?.position?.count ?? null : null,
      });
    }
  }
  return { camera: s.camera.position.toArray().map(v=>+v.toFixed(1)), rows };
})()`);

console.log('camera', JSON.stringify(out.camera));
console.log('region          what was hit                    dist      y   verts');
for (const r of out.rows) {
  console.log(`${r.region.padEnd(15)} ${String(r.hit).padEnd(30)} ${String(r.dist ?? '-').padStart(6)} ${String(r.y ?? '-').padStart(6)} ${String(r.geoVerts ?? '-').padStart(7)}`);
}

try { ws.close(); } catch {}
chrome.kill('SIGKILL');
await sleep(300);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
