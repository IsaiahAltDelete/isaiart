// Upscale worker: downloads/caches an ONNX model, then runs tiled inference
// off the main thread and streams finished tiles back as RGBA.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
importScripts(ORT + 'ort.webgpu.min.js');
ort.env.wasm.wasmPaths = ORT;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;

const CACHE = 'upscale-models-v1';
let session = null, sessionKey = '', backend = '', cancelled = false;

async function fetchModel(url) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch {}
  const hit = cache && await cache.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(url);
  if (!res.ok) throw new Error('Model download failed (' + res.status + ')');
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    postMessage({ type: 'download', got, total });
  }
  const buf = new Uint8Array(got); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  try { await cache?.put(url, new Response(buf)); } catch {}
  return buf;
}

async function load(url) {
  if (session && sessionKey === url) return;
  session?.release?.(); session = null;
  const bytes = await fetchModel(url);
  postMessage({ type: 'status', text: 'Compiling model' });
  const eps = [];
  if (self.navigator.gpu) {
    try { if (await navigator.gpu.requestAdapter()) eps.push('webgpu'); } catch {}
  }
  eps.push('wasm');
  let err;
  for (const ep of eps) {
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
      backend = ep; break;
    } catch (e) { err = e; }
  }
  if (!session) throw err || new Error('Could not start inference');
  sessionKey = url;
  postMessage({ type: 'backend', backend });
}

// Tile origins along one axis: fixed tile size T with overlap, last tile clamped
// to the edge. Each tile keeps the pixels up to the midpoint of its overlaps.
function axis(len, T, ov) {
  const step = T - 2 * ov, xs = [];
  for (let x = 0; ; x += step) {
    if (x + T >= len) { xs.push(Math.max(0, len - T)); break; }
    xs.push(x);
  }
  const keep = xs.map((x, i) => [
    i === 0 ? 0 : Math.floor((xs[i - 1] + T + x) / 2),
    i === xs.length - 1 ? len : Math.floor((x + T + xs[i + 1]) / 2),
  ]);
  return xs.map((x, i) => ({ x, k0: keep[i][0], k1: keep[i][1] }));
}

async function run({ pixels, w, h, tile, overlap }) {
  let scale = 0;
  cancelled = false;
  const T = tile, inName = session.inputNames[0], outName = session.outputNames[0];
  const cols = axis(w, T, overlap), rows = axis(h, T, overlap);
  const jobs = [];
  for (const r of rows) for (const c of cols) jobs.push({ r, c });
  // Centre-out order so the part you're looking at resolves first.
  const cx = w / 2, cy = h / 2;
  jobs.sort((a, b) =>
    Math.hypot(a.c.x + T / 2 - cx, a.r.x + T / 2 - cy) - Math.hypot(b.c.x + T / 2 - cx, b.r.x + T / 2 - cy));

  const input = new Float32Array(3 * T * T), plane = T * T;
  for (let j = 0; j < jobs.length; j++) {
    if (cancelled) { postMessage({ type: 'cancelled' }); return; }
    const { r, c } = jobs[j];
    for (let y = 0; y < T; y++) {
      let si = ((r.x + y) * w + c.x) * 4, di = y * T;
      for (let x = 0; x < T; x++, si += 4, di++) {
        input[di] = pixels[si] / 255;
        input[di + plane] = pixels[si + 1] / 255;
        input[di + 2 * plane] = pixels[si + 2] / 255;
      }
    }
    const feeds = { [inName]: new ort.Tensor('float32', input, [1, 3, T, T]) };
    const out = (await session.run(feeds))[outName];
    const S = out.dims[3]; scale = S / T;
    const data = out.data, oplane = S * S;

    const kx0 = (c.k0 - c.x) * scale, kx1 = (c.k1 - c.x) * scale;
    const ky0 = (r.k0 - r.x) * scale, ky1 = (r.k1 - r.x) * scale;
    const ow = kx1 - kx0, oh = ky1 - ky0;
    const rgba = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) {
      let si = (ky0 + y) * S + kx0, di = y * ow * 4;
      for (let x = 0; x < ow; x++, si++, di += 4) {
        rgba[di] = data[si] * 255 + 0.5;
        rgba[di + 1] = data[si + oplane] * 255 + 0.5;
        rgba[di + 2] = data[si + 2 * oplane] * 255 + 0.5;
        rgba[di + 3] = 255;
      }
    }
    out.dispose?.();
    postMessage({ type: 'tile', x: c.k0 * scale, y: r.k0 * scale, w: ow, h: oh, rgba, done: j + 1, total: jobs.length },
      [rgba.buffer]);
  }
  postMessage({ type: 'done' });
}

onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'cancel') { cancelled = true; return; }
    if (m.type === 'run') {
      postMessage({ type: 'status', text: 'Loading model' });
      await load(m.url);
      await run(m);
    }
  } catch (e) {
    postMessage({ type: 'error', text: String(e?.message || e) });
  }
};
