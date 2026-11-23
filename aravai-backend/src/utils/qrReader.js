// Machine QR reader (Node only: sharp + jsQR, no Python).
//
//   readQr(jpegBuffer) -> { found, value, attempts, location }
//     found = true when a REAL QR code was decoded from the pixels (the printed text under the QR is never used)
//     value = the decoded QR payload exactly as stored in the QR (machine code, token, or APP_URL/machine/<token>)
//
// A QR sticker on a phone photo is usually small, tilted, glary or blurred, so the decoder is run on a ladder of
// preprocessed versions of the SAME image (stops at the first success):
//   full image at 3 sizes  ->  normalised / sharpened / thresholded  ->  inverted  ->  90/180/270 rotation  ->  overlapping tiles
// jsQR is pure JavaScript, zxing-wasm is WebAssembly (no native build, no Python). Install:  npm i jsqr zxing-wasm
//
// extractMachineRefs(value) -> candidate strings that may identify a machine (machine code, token, URL part, JSON field ...)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
let jsQR = null;
try { jsQR = require('jsqr'); } catch (e) { /* optional when zxing-wasm is installed */ }

// zxing-wasm (optional, npm i zxing-wasm): much better than jsQR on small / soft QR codes. Loaded once; if it is missing or cannot start, jsQR alone is used.
let zxP = null;
function loadZxing() {
  if (zxP) return zxP;
  zxP = (async () => {
    const mod = await import('zxing-wasm/reader'); // eslint-disable-line global-require
    // package folder: its exports map does not allow require.resolve, so look in the node_modules folders ourselves
    const dir = (require.resolve.paths('zxing-wasm') || []).map((d) => path.join(d, 'zxing-wasm')).find((d) => fs.existsSync(path.join(d, 'package.json')));
    const pkg = dir || '';
    const wasm = [path.join(pkg, 'dist', 'reader', 'zxing_reader.wasm'), path.join(pkg, 'dist', 'es', 'reader', 'zxing_reader.wasm')].find((f) => fs.existsSync(f));
    if (wasm) mod.setZXingModuleOverrides({ wasmBinary: fs.readFileSync(wasm) }); // read the file ourselves: no network fetch
    return mod;
  })().catch((e) => { console.warn('zxing-wasm not available, using jsQR only:', e.message); return null; });
  return zxP;
}

// Time budget for one photo. 5 s was far too short: the plain full-image ladder alone needs ~20 decodes, so the TILE stage (the one that
// finds a small QR sticker in a big photo) was never reached and "QR not detected" was reported for a perfectly visible QR.
const MAX_MS = Number(process.env.WEIGHING_QR_TIMEOUT_MS) > 0 ? Number(process.env.WEIGHING_QR_TIMEOUT_MS) : 12000;
const WORK_PX = 3000; // longest side the search works on (the old 2000 px cap shrank a small QR sticker below what a decoder can read)

// RGBA pixels of an image buffer, optionally after a sharp pipeline.
// sharp keeps greyscale images as 1 channel (or 2 with alpha), so they are expanded to RGBA by hand: jsQR needs 4 channels.
async function pixels(pipeline) {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height, c = info.channels;
  if (c === 4) return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (c === 1 || c === 2) { out[o] = out[o + 1] = out[o + 2] = data[i * c]; }
    else { out[o] = data[i * c]; out[o + 1] = data[i * c + 1]; out[o + 2] = data[i * c + 2]; }
    out[o + 3] = 255;
  }
  return { data: out, width: info.width, height: info.height };
}

// -> { data, location } or null. zxing first (fast, strong), then jsQR on the same pixels.
async function tryDecode(p) {
  const zx = await loadZxing();
  if (zx) {
    try {
      const res = await zx.readBarcodes({ data: p.data, width: p.width, height: p.height, colorSpace: 'srgb' }, { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 1 });
      if (res.length && res[0].text && String(res[0].text).trim()) return { data: res[0].text, location: null };
    } catch (e) { /* fall through to jsQR */ }
  }
  if (!jsQR) return null;
  const r = jsQR(p.data, p.width, p.height, { inversionAttempts: 'attemptBoth' });
  return r && r.data && String(r.data).trim() ? r : null;
}

async function readQr(buffer) {
  if (!jsQR && !(await loadZxing())) throw new Error('QR decoder is not installed on the server (npm i jsqr zxing-wasm)');
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Image buffer is missing');
  const t0 = Date.now();
  let attempts = 0;
  // decode the JPEG ONCE into raw pixels (EXIF-rotated, max WORK_PX); every attempt below starts from these pixels instead of decoding the file again
  const { data: rawBuf, info } = await sharp(buffer, { limitInputPixels: 100e6 }).rotate().removeAlpha()
    .resize({ width: WORK_PX, height: WORK_PX, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const src = () => sharp(rawBuf, { raw: { width: W, height: H, channels: 3 } });
  const expired = () => Date.now() - t0 > MAX_MS;
  const hit = (r, how) => ({ found: true, value: String(r.data).trim(), attempts, how, location: r.location || null });
  const none = (how) => ({ found: false, value: null, attempts, how, location: null });
  const run = async (pipeline, how) => {
    attempts += 1;
    const r = await tryDecode(await pixels(pipeline));
    return r ? hit(r, how) : null;
  };
  const filters = {
    plain: (p) => p,
    norm: (p) => p.greyscale().normalise(),
    sharp: (p) => p.greyscale().normalise().sharpen({ sigma: 1.2 }),
    thr: (p) => p.greyscale().normalise().threshold(128),
    adapt: (p) => p.greyscale().clahe({ width: 32, height: 32, maxSlope: 4 }),
  };
  const fit = (p, s) => p.resize({ width: s, height: s, fit: 'inside', withoutEnlargement: s <= Math.max(W, H) });

  // 1. quick full-image tries (a big, sharp QR is found here in well under a second)
  for (const s of [1600, 1000]) for (const f of ['plain', 'norm']) {
    if (expired()) return none('timeout');
    const r = await run(filters[f](fit(src(), s)), `full-${s}-${f}`); if (r) return r;
  }

  // 2. TILES, before the slow full-image ladder: a small QR sticker in a big photo decodes much better when cropped and enlarged
  const tileStage = async (fracs, names) => {
    for (const frac of fracs) {
      const tw = Math.round(W * frac), th = Math.round(H * frac);
      const sx = Math.max(1, Math.round(tw / 2)), sy = Math.max(1, Math.round(th / 2));
      for (let y = 0; y < H; y += sy) for (let x = 0; x < W; x += sx) {
        if (expired()) return { timeout: true };
        const left = Math.min(x, W - tw), top = Math.min(y, H - th);
        const tile = src().extract({ left, top, width: tw, height: th }).resize({ width: 1000, height: 1000, fit: 'inside' }); // enlarged when the tile is smaller
        for (const f of names) { const r = await run(filters[f](tile.clone()), `tile-${frac}-${left}x${top}-${f}`); if (r) return { hit: r }; }
        if (top + th >= H) break;
      }
    }
    return {};
  };
  let t = await tileStage([0.5, 0.33], ['plain', 'norm']);
  if (t.hit) return t.hit; if (t.timeout) return none('timeout');

  // 3. rest of the full-image ladder: other sizes and enhancements (glare, low contrast, soft focus)
  for (const s of [1600, 1000, 640, 2400]) for (const f of ['sharp', 'thr', 'adapt', 'norm', 'plain']) {
    if (expired()) return none('timeout');
    if ((s === 1600 || s === 1000) && (f === 'plain' || f === 'norm')) continue; // already done in step 1
    const r = await run(filters[f](fit(src(), s)), `full-${s}-${f}`); if (r) return r;
  }

  // 4. rotated (sticker sideways / upside down)
  for (const deg of [90, 180, 270]) {
    if (expired()) return none('timeout');
    const r = await run(src().rotate(deg).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).greyscale().normalise(), `rot${deg}`); if (r) return r;
  }

  // 5. smaller tiles with stronger enhancement for a really small / soft QR
  t = await tileStage([0.25], ['plain', 'sharp', 'adapt']);
  if (t.hit) return t.hit;
  return none(t.timeout ? 'timeout' : null);
}

// What can the QR text mean?  Order = most specific first. All of them are tried against machine_master by the caller.
//   "MCH-003"                       machine code
//   "https://app/machine/<token>"   link printed by the system (token or code after /machine/ or /m/)
//   "<32 hex token>"                token only
//   '{"machine_id":"MCH-003"}'      JSON
//   "machine_id=MCH-003" / "MACHINE: MCH-003" / "ID:MCH-003"   key-value text
function extractMachineRefs(value) {
  const raw = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!raw) return [];
  const out = [];
  const add = (x) => { const s = String(x ?? '').trim(); if (s && !out.includes(s)) out.push(s); };
  add(raw);
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      for (const k of ['machine_code', 'machineCode', 'machine_id', 'machineId', 'code', 'id', 'machine', 'token', 'qr_token']) if (j[k] !== undefined) add(j[k]);
    }
  } catch (e) { /* not JSON */ }
  const kv = /(?:machine[\s_-]*(?:id|code|no)?|code|id|token)\s*[:=]\s*([A-Za-z0-9_-]{3,64})/i.exec(raw);
  if (kv) add(kv[1]);
  const path = /\/(?:machine|m)\/([A-Za-z0-9_-]{3,64})\/?(?:[?#].*)?$/.exec(raw);
  if (path) add(path[1]);
  const code = raw.match(/\b[A-Za-z]{2,6}[-_ ]?\d{1,6}\b/g);
  if (code) code.forEach((c) => add(c.replace(/[ _]/g, '-')));
  return out.slice(0, 8);
}

module.exports = { readQr, extractMachineRefs };
