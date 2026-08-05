// Headless-Chrome capture harness driven over CDP.
//
// Launches its OWN Chrome (own --user-data-dir, own port) so it never touches a
// browser the user is working in. Node has a global WebSocket, so there is no
// puppeteer dependency.
//
//   node .shot/cdp.mjs shot <outfile>            one screenshot at the opening view
//   node .shot/cdp.mjs probe <outfile.json>      renderer stats + a walk of the map
//
// Not part of the scene — a dev tool, kept out of src/.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.SCENE_URL || 'http://localhost:5173/?capture';
const PORT = Number(process.env.CDP_PORT || 9333);
const W = 1470, H = 774;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const dir = mkdtempSync(join(tmpdir(), 'forest-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dir}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--use-angle=metal',
    URL_BASE,
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
  if (!target) throw new Error('chrome did not expose a page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push({ type: 'exception', text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
    } else if (m.method === 'Log.entryAdded') {
      logs.push({ type: m.params.entry.level, text: m.params.entry.text, url: m.params.entry.url || '' });
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    return r.result.value;
  };

  return {
    logs, evaluate, send,
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    async close() {
      try { ws.close(); } catch {}
      chrome.kill('SIGKILL');
      await sleep(300);
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

// Wait until the scene has drawn a few frames (and any streaming queue drains).
const SETTLE = `(async () => {
  for (let i = 0; i < 240; i++) {
    await new Promise(r => requestAnimationFrame(r));
    if (window.__scene?.streaming && window.__scene.streaming.pending() === 0 && i > 60) break;
  }
  return true;
})()`;

const cmd = process.argv[2];
const out = process.argv[3];

const c = await connect();
try {
  await c.evaluate(SETTLE);

  if (cmd === 'shot') {
    await c.shot(out);
    console.log('wrote', out);
  } else if (cmd === 'fingerprint') {
    // Screenshots cannot be compared byte-for-byte: water uTime, dust and wind all
    // advance with wall-clock time, so two runs of the SAME build differ. The
    // layout is the thing that must stay stable, so hash the instance transforms
    // instead — that is what "the forest is laid out identically" actually means.
    const fp = await c.evaluate(`(() => {
      const s = window.__scene;
      if (!s) return { error: 'window.__scene not exposed' };
      const rows = [];
      s.scene.traverse(o => {
        if (!o.isInstancedMesh) return;
        const a = o.instanceMatrix.array;
        // FNV-1a over the matrices, quantised to 0.001 so float noise in the
        // last mantissa bits cannot make an identical layout look different.
        let h = 0x811c9dc5;
        for (let i = 0; i < a.length; i++) {
          h ^= Math.round(a[i] * 1000) | 0;
          h = Math.imul(h, 0x01000193);
        }
        rows.push({ count: o.count, verts: o.geometry.attributes.position.count, hash: (h >>> 0).toString(16) });
      });
      rows.sort((p, q) => p.hash.localeCompare(q.hash));
      const total = rows.reduce((n, r) => n + r.count, 0);
      return { meshes: rows.length, totalInstances: total, rows };
    })()`);
    writeFileSync(out, JSON.stringify(fp, null, 2));
    console.log('meshes', fp.meshes, 'totalInstances', fp.totalInstances);
    console.log('wrote', out);
  } else if (cmd === 'probe') {
    const stats = await c.evaluate(`(() => {
      const s = window.__scene;
      if (!s) return { error: 'window.__scene not exposed' };
      // renderer.info is reset per render() call, and the composer's last pass is
      // a fullscreen quad — reading it after a frame reports 1 triangle. Render
      // the scene directly to measure what the scene itself actually costs.
      s.renderer.render(s.scene, s.camera);
      const info = s.renderer.info;
      let meshes = 0, instances = 0;
      s.scene.traverse(o => { if (o.isMesh) meshes++; if (o.isInstancedMesh) instances += o.count; });
      return {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? null,
        meshes, instances,
        streaming: s.streaming?.stats() ?? null,
        pending: s.streaming?.pending() ?? null,
        camera: s.camera.position.toArray().map(v => +v.toFixed(2)),
      };
    })()`);
    const report = { stats, logs: c.logs };
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }

  // The page ships no favicon, so Chrome always logs one 404 for it. That is not
  // a scene error, and letting it through would mask the ones that are.
  const bad = c.logs.filter((l) => (l.type === 'error' || l.type === 'exception')
    && !/favicon/i.test(l.text + (l.url || '')));
  if (bad.length) {
    console.log('\n--- console errors ---');
    for (const b of bad) console.log(b.type, b.text);
    process.exitCode = 1;
  } else {
    console.log('console: clean');
  }
} finally {
  await c.close();
}
