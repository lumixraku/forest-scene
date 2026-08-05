// Compare two PNGs captured by cdp.mjs.
//
// Screenshots of this scene are never byte-identical between runs (water uTime,
// dust and wind all advance with wall-clock time), so a hash tells you nothing.
// What is comparable is the overall exposure and the per-region means: if the
// meadow has gone dark or the sky has shifted, that shows up here even though
// the ripples differ.
//
// Decoding is done in Chrome via a canvas rather than with a PNG library, to keep
// this dependency-free.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_DIFF_PORT || 9444);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: node .shot/diff.mjs <before.png> <after.png>');

const dir = mkdtempSync(join(tmpdir(), 'forest-diff-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === 'page');
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
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Runtime.enable');

const toDataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const load = (src) => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
    });
    const A = await load(${JSON.stringify(toDataUrl(a))});
    const B = await load(${JSON.stringify(toDataUrl(b))});
    if (A.width !== B.width || A.height !== B.height) {
      return { error: 'size mismatch: ' + A.width + 'x' + A.height + ' vs ' + B.width + 'x' + B.height };
    }
    const W = A.width, H = A.height;
    const px = (im) => {
      const cv = new OffscreenCanvas(W, H);
      const cx = cv.getContext('2d');
      cx.drawImage(im, 0, 0);
      return cx.getImageData(0, 0, W, H).data;
    };
    const pa = px(A), pb = px(B);

    // 3x3 regions: the sky band, the mid ground and the near foreground each
    // fail in different ways, and a single whole-frame mean hides all of them.
    const rows = 3, cols = 3;
    const regions = [];
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const x0 = Math.floor(rx * W / cols), x1 = Math.floor((rx + 1) * W / cols);
        const y0 = Math.floor(ry * H / rows), y1 = Math.floor((ry + 1) * H / rows);
        let la = 0, lb = 0, n = 0, bigDiff = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const ya = 0.299 * pa[i] + 0.587 * pa[i+1] + 0.114 * pa[i+2];
            const yb = 0.299 * pb[i] + 0.587 * pb[i+1] + 0.114 * pb[i+2];
            la += ya; lb += yb; n++;
            if (Math.abs(ya - yb) > 40) bigDiff++;
          }
        }
        regions.push({
          region: ['top','mid','bottom'][ry] + '-' + ['left','centre','right'][rx],
          lumaBefore: +(la / n).toFixed(1),
          lumaAfter: +(lb / n).toFixed(1),
          delta: +((lb - la) / n).toFixed(1),
          pctChanged: +(100 * bigDiff / n).toFixed(1),
        });
      }
    }
    let la = 0, lb = 0;
    for (let i = 0; i < pa.length; i += 4) {
      la += 0.299 * pa[i] + 0.587 * pa[i+1] + 0.114 * pa[i+2];
      lb += 0.299 * pb[i] + 0.587 * pb[i+1] + 0.114 * pb[i+2];
    }
    const n = pa.length / 4;
    return { W, H, wholeFrame: { before: +(la/n).toFixed(1), after: +(lb/n).toFixed(1), delta: +((lb-la)/n).toFixed(1) }, regions };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

const out = r.result.value;
if (out.error) {
  console.log('ERROR', out.error);
} else {
  console.log(`${out.W}x${out.H}  whole frame luma ${out.wholeFrame.before} -> ${out.wholeFrame.after}  (delta ${out.wholeFrame.delta})`);
  console.log('region          before  after   delta  %pixels>40');
  for (const g of out.regions) {
    console.log(`${g.region.padEnd(15)} ${String(g.lumaBefore).padStart(6)} ${String(g.lumaAfter).padStart(6)} ${String(g.delta).padStart(7)} ${String(g.pctChanged).padStart(10)}`);
  }
}

try { ws.close(); } catch {}
chrome.kill('SIGKILL');
await sleep(300);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
