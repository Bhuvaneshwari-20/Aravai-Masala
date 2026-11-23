// Weighing machine display reader - Node.js only (sharp + tesseract.js). No Python, no OpenCV.
//
// Public contract is unchanged (used by batchWeightImageService and weighingService):
//   readWeight(jpegBuffer) -> { value, unit, confidence, text, engine, reason }
//     value = number as shown on the display, or null when the display cannot be read with certainty
//     unit  = always null (callers treat "no unit" as kg)
//     reason = clear message when value is null
// The QR code is NOT read here (see qrReader.js); both run independently on the same photo.
//
// Pipeline
//   1. Find the DIGIT DISPLAY only: lit LED pixels (red / green / amber / cyan) are masked, grouped into blobs, and the
//      wide, dense blob is cropped. A QR code, labels, buttons and stickers are black/white or not LED-coloured, so they are ignored.
//      When no LED blob is found (LCD, dark digits on grey) a few wide bands of the photo are tried as fallback candidates.
//      When no display is found at all, the photo is also tried rotated by 90 / 270 degrees (phone held sideways).
//   2. Each crop is enhanced (greyscale, normalise, threshold, closed so the gaps between 7-segment bars join) in several variants.
//   3. LED crops: a built-in 7-segment decoder (sevenSeg.js) reads the lit segments at several brightness levels (best for LED digits).
//      Other crops, or when the decoder cannot read: tesseract.js reads digits only (whitelist 0-9 and '.'), single text line.
//   4. A weight is accepted only when at least WEIGHING_OCR_MIN_AGREE variants read the SAME number.
//   5. A time budget is enforced: when the caller's timeout fires, the running job is cancelled (it no longer blocks later photos).
//
// .env (all optional)
//   WEIGHING_OCR_TIMEOUT_MS      max time for one photo                     default 25000
//   WEIGHING_OCR_REQUIRE_DECIMAL true|false  refuse a reading without '.'  default true
//   WEIGHING_OCR_DECIMALS        e.g. 1  -> if tesseract loses the dot, the last N digits are the decimals (112.2 shows as 1122)
//   WEIGHING_OCR_MIN_AGREE       variants that must agree                   default 2
//   WEIGHING_OCR_MAX_TESS        max tesseract calls per photo (fallback)   default 12
//   WEIGHING_OCR_LANG            tesseract language / model                 default eng  (e.g. letsgodigital for a 7-segment model)
//   WEIGHING_OCR_LANG_PATH       folder (or URL) holding <lang>.traineddata  default: tesseract.js CDN download on first use
//   WEIGHING_OCR_CACHE_DIR       where tesseract.js caches the language file default <cwd>/.tesseract
//   WEIGHING_OCR_DEBUG_DIR       folder to save the crops that were read, for troubleshooting
//   WEIGHING_OCR_DEBUG_LOG       true|false  one log line per step (image size, crop box, OCR text, confidence, parsed weight)  default true
//   WEIGHING_OCR_SKIP_7SEG       true = skip the 7-segment decoder (diagnostics: test tesseract alone)   default false
//   WEIGHING_OCR_TESS_MIN_CONF   a tesseract read below this confidence is ignored          default 60
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { decode: decodeSevenSeg } = require('./sevenSeg');

const OCR_VERSION = '2026-11-23-core-crop-v2';
const ENGINE = 'tesseract-digits';
const ENGINE_7SEG = 'led-7segment';
// brightness levels (share of the brightest pixels) at which the lit segments are decoded. Glow merges the bars at low levels and thin bars vanish at
// very high ones, so several levels are tried; a number counts only when at least WEIGHING_OCR_MIN_AGREE levels give the SAME digits.
const LED_LEVELS = [0.78, 0.84, 0.88, 0.91, 0.94, 0.97];
const BRIGHT_LEVELS = [0.74, 0.78, 0.82, 0.86, 0.9]; // share of the brightest lit-core level (colour independent mask, e.g. cyan VFD)
const envNum = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const requireDecimal = () => String(process.env.WEIGHING_OCR_REQUIRE_DECIMAL ?? 'true').toLowerCase() !== 'false';
const forcedDecimals = () => { const n = parseInt(process.env.WEIGHING_OCR_DECIMALS, 10); return Number.isFinite(n) && n > 0 && n <= 3 ? n : null; };

/* ---------------- debug log + crop validation ---------------- */
const debugLog = () => String(process.env.WEIGHING_OCR_DEBUG_LOG ?? 'true').toLowerCase() !== 'false';
const dbg = (...a) => { if (debugLog()) console.log('[ocr]', ...a); };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const MAX_UP_W = 3600; // widest upscaled crop handed to tesseract (px)

// Snap a box to whole pixels INSIDE the image (never negative, never past the edge, at least 1 px).
function fitBox(left, top, width, height, W, H) {
  const l = clamp(Math.round(left), 0, W - 1), t = clamp(Math.round(top), 0, H - 1);
  const r = clamp(Math.round(left + width), l + 1, W), b = clamp(Math.round(top + height), t + 1, H);
  return { left: l, top: t, width: r - l, height: b - t };
}
// A display crop must be a believable digit display. Returns a reason string, or null when the box is fine.
// A 2 px wide (or 2 px tall) crop can never reach sharp / tesseract: it is refused here, with the reason in the log.
function checkBox(b, W, H) {
  if (![b.left, b.top, b.width, b.height].every(Number.isInteger)) return 'crop values are not whole pixels';
  if (b.left < 0 || b.top < 0 || b.width <= 0 || b.height <= 0 || b.left + b.width > W || b.top + b.height > H) return `crop is outside the ${W}x${H} image`;
  const minW = Math.max(40, Math.round(W * 0.04)), minH = 24;
  if (b.width < minW) return `crop width ${b.width}px is below the minimum ${minW}px`;
  if (b.height < minH) return `crop height ${b.height}px is below the minimum ${minH}px`;
  const ar = b.width / b.height;
  if (ar < 0.8 || ar > 14) return `crop aspect ratio ${ar.toFixed(2)} is not that of a digit display`;
  return null;
}
// the ONLY place that cuts a crop out of the photo. The original buffer is never modified: every version is a fresh pipeline.
function cropPipe(jpeg, c) {
  const why = checkBox(c, c.imgW, c.imgH);
  if (why) throw new Error(`invalid crop (${c.name}): ${why}`);
  return sharp(jpeg).extract({ left: c.left, top: c.top, width: c.width, height: c.height });
}
const boxStr = (c) => `left=${c.left} top=${c.top} width=${c.width} height=${c.height}`;

/* ---------------- tesseract worker (one, created lazily, reused) ---------------- */
let workerP = null;
let queue = Promise.resolve();
async function getWorker() {
  if (workerP) return workerP;
  workerP = (async () => {
    const { createWorker, PSM } = require('tesseract.js'); // eslint-disable-line global-require
    const lang = process.env.WEIGHING_OCR_LANG || 'eng';
    let fail; const failed = new Promise((_, rej) => { fail = rej; });
    // errorHandler: a failed language load must reject readWeight() quickly, never crash the Node process or hang until the timeout
    const opts = { cachePath: process.env.WEIGHING_OCR_CACHE_DIR || path.join(process.cwd(), '.tesseract'), errorHandler: (e) => { console.error('Tesseract worker:', e && e.message ? e.message : e); fail(new Error(`Tesseract failed: ${e && e.message ? e.message : e}`)); } };
    const lp = process.env.WEIGHING_OCR_LANG_PATH;
    if (lp) {
      opts.langPath = lp;
      // a local folder holding a plain <lang>.traineddata (not .gz): tell tesseract.js not to look for the gzip version
      if (!/^https?:/i.test(lp) && fs.existsSync(path.join(lp, `${lang}.traineddata`))) opts.gzip = false;
    }
    const w = await Promise.race([createWorker(lang, 1, opts), failed]);
    await w.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: PSM.SINGLE_LINE, user_defined_dpi: '300' });
    try { await w.setParameters({ debug_file: '/dev/null' }); } catch (e) { /* ignore */ } // tesseract prints 'Line cannot be recognized' etc. for every empty read
    try { await w.setParameters({ classify_bln_numeric_mode: '1' }); } catch (e) { /* older tesseract.js: whitelist alone is enough */ }
    return w;
  })().catch((e) => { workerP = null; throw e; });
  return workerP;
}
// tesseract workers are not re-entrant: photos are read one after another
const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

// psm 7 = one text line, psm 8 = one word. Both are tried on every version of the crop (see readOnceInner).
async function recognise(buf, psm) {
  const w = await getWorker();
  const { PSM } = require('tesseract.js'); // eslint-disable-line global-require
  await w.setParameters({ tessedit_pageseg_mode: psm === 8 ? PSM.SINGLE_WORD : PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789.' });
  const { data } = await w.recognize(buf);
  return { text: String(data.text || ''), confidence: Number(data.confidence) || 0 };
}

/* ---------------- 1. find the digit display ---------------- */
const SCAN_W = 480;

// lit-LED mask on a small copy. 1 = pixel that looks like a lit segment
function isLit(r, g, b) {
  const mx = Math.max(r, g, b);
  if (mx < 110) return false;
  if (r > 140 && r > g * 1.7 && r > b * 1.7) return true;          // red LED
  if (g > 130 && g > r * 1.5 && g > b * 1.3) return true;          // green LED
  if (r > 170 && g > 110 && b < 90 && r > b * 2) return true;      // amber / orange LED
  if (g > 140 && b > 110 && r < g * 0.75 && b > r * 1.2) return true; // cyan / teal VFD: g and b both high, so the green rule above misses it
  return false;
}

// connected blobs of lit pixels, on an 6px block grid after dilation. Returns boxes in SCAN_W coordinates.
function litBlobs(raw, w, h) {
  const B = 6, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const cnt = new Uint16Array(bw * bh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (isLit(raw[i], raw[i + 1], raw[i + 2])) cnt[Math.floor(y / B) * bw + Math.floor(x / B)]++;
  }
  const on = new Uint8Array(bw * bh);
  for (let i = 0; i < on.length; i++) on[i] = cnt[i] >= 3 ? 1 : 0;
  // join blocks that are 2 blocks apart (gap between digits)
  const joined = new Uint8Array(on);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (on[y * bw + x]) {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < bw && ny < bh) joined[ny * bw + nx] = 1;
    }
  }
  const seen = new Uint8Array(bw * bh), out = [];
  for (let s = 0; s < joined.length; s++) {
    if (!joined[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1; let x0 = bw, y0 = bh, x1 = 0, y1 = 0, lit = 0;
    while (st.length) {
      const c = st.pop(), cx = c % bw, cy = (c - cx) / bw;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; lit += cnt[c];
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const n = ny * bw + nx; if (joined[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    const bwid = (x1 - x0 + 1) * B, bhei = (y1 - y0 + 1) * B;
    out.push({ x: x0 * B, y: y0 * B, w: bwid, h: bhei, lit, aspect: bwid / bhei });
  }
  return out;
}

// A narrow digit ('1' lights only its two right-hand bars) leaves a big empty gap, so the 2-block join above can split ONE display into
// several blobs - the leading 1s of 112.2 / 100.0 were then cut off the crop. Blobs that sit on the same row (>= 60 % vertical overlap) and are
// no further apart than 1.3 x the digit height are one display.
function mergeRow(list) {
  const bl = list.map((b) => ({ ...b }));
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < bl.length && !again; i++) for (let j = i + 1; j < bl.length && !again; j++) {
      const a = bl[i], b = bl[j];
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (oy < 0.6 * Math.min(a.h, b.h)) continue;
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      if (gap > 1.3 * Math.max(a.h, b.h)) continue;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
      bl[i] = { x, y, w: x1 - x, h: y1 - y, lit: a.lit + b.lit, aspect: (x1 - x) / (y1 - y) };
      bl.splice(j, 1); again = true;
    }
  }
  return bl;
}

// -> [{ name, left, top, width, height, led, imgW, imgH }] in ORIGINAL image pixels, best first. Every box is validated (checkBox).
// quiet = true: no log lines (used for the cheap "is there a display at all" scan before rotating).
async function candidates(jpeg, quiet = false) {
  const log = quiet ? () => {} : dbg;
  const meta = await sharp(jpeg).metadata();
  const W = meta.width, H = meta.height;
  log(`original image ${W}x${H}`);
  const scale = W / SCAN_W;
  const { data, info } = await sharp(jpeg).resize({ width: SCAN_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const list = [];
  const add = (c) => {
    const why = checkBox(c, W, H);
    log(`candidate ${c.name}: ${boxStr(c)} (${c.width}x${c.height}px)${why ? ` REJECTED: ${why}` : ' ok'}`);
    if (!why) list.push({ ...c, imgW: W, imgH: H });
  };
  const blobs = mergeRow(litBlobs(data, info.width, info.height))
    .filter((b) => b.lit >= 25 && b.w >= 30 && b.h >= 10 && b.aspect >= 1.4 && b.aspect <= 9 && b.w < info.width * 0.95)
    .sort((a, b) => b.lit - a.lit).slice(0, 3);
  for (const [i, b] of blobs.entries()) {
    // Keep a generous margin around the detected glow. The display detector can
    // find the bright core but the outer digit strokes / decimal point may sit
    // beyond the tight colour blob, especially with perspective or glare.
    const padX = Math.max(b.w * 0.28, 12), padY = Math.max(b.h * 0.42, 12);
    // box in the small scan image -> original pixels, then snapped INSIDE the photo.
    const f = fitBox((b.x - padX) * scale, (b.y - padY) * scale, (b.w + 2 * padX) * scale, (b.h + 2 * padY) * scale, W, H);
    add({ name: `led${i + 1}`, ...f, led: true });
  }
  // fallback for LCD / unusual displays: wide bands (never the whole photo: it holds the QR, labels and other numbers).
  // Trusted less than an LED blob: see 'needed' in readOnceInner.
  for (const [i, [fy, fh]] of [[0.30, 0.25], [0.15, 0.25], [0.45, 0.25], [0.0, 0.25], [0.60, 0.25]].entries()) {
    add({ name: `band${i + 1}`, ...fitBox(W * 0.05, H * fy, W * 0.9, H * fh, W, H), led: false });
  }
  return list;
}

/* ---------------- 2. enhance a crop in several ways ---------------- */
// 4x / 5x / 6x upscales (smaller when the crop is already big: never wider than MAX_UP_W). The ORIGINAL photo is never touched: each version
// is built from a fresh crop of it.
function upscales(width) {
  const ok = [4, 5, 6].filter((k) => width * k <= MAX_UP_W);
  return ok.length ? ok : [Math.max(1, Math.floor((MAX_UP_W / width) * 10) / 10)];
}
// Async generator, so reading stops as soon as enough versions agree. 7-segment digits are separate bars: the 'closed' versions blur then
// re-threshold so each digit is one solid glyph. LED = bright digits on dark: negated so tesseract sees dark digits on white.
async function* variants(jpeg, c) {
  const pad = (p) => p.extend({ top: 40, bottom: 40, left: 60, right: 60, background: '#ffffff' });
  // LED crops: every 4x/5x/6x scale. LCD fallback bands are big and only a last resort: one scale, two versions.
  for (const k of (c.led ? upscales(c.width) : upscales(c.width).slice(0, 1))) {
    const up = () => cropPipe(jpeg, c).resize({ width: Math.max(1, Math.round(c.width * k)), kernel: 'lanczos3' });
    const grey = () => { const p = up().greyscale().normalise(); return c.led ? p.negate() : p; };
    const defs = c.led ? [
      ['led-r', () => up().extractChannel(0).normalise().negate().threshold(110).median(3)],
      ['led-g', () => up().extractChannel(1).normalise().negate().threshold(110).median(3)],
      ['grey-contrast', () => grey().linear(1.4, -40)],
      ['grey-thr', () => grey().threshold(128)],
      ['grey-closed', () => grey().blur(1.5).threshold(140)],
    ] : [
      ['grey-contrast', () => grey().sharpen().linear(1.4, -40)],
      ['grey-thr', () => grey().sharpen().threshold(120)],
      ['grey-inv', () => up().greyscale().normalise().negate().threshold(120)],
      ['grey-closed', () => grey().blur(1.2).threshold(130)],
    ];
    for (const [name, build] of (c.led ? defs : defs.slice(0, 2))) {
      try { const { data, info } = await pad(build()).png().toBuffer({ resolveWithObject: true }); yield { name: `${name}-x${k}`, buf: data, w: info.width, h: info.height }; } catch (e) { dbg(`version ${c.name}/${name}-x${k} skipped: ${e.message}`); }
    }
  }
}

/* ---------------- 2b. LED display: lit-segment mask -> 7-segment decoder ---------------- */
// Returns [{ text, value }] one per brightness level that could be decoded.
// alive(): throws when the caller's time limit has passed, so a timed-out photo stops using the CPU.
async function readLed(jpeg, c, alive = () => {}) {
  // A small display (far away / low resolution photo) is enlarged first, so the thin segment bars are wide enough to be told apart.
  let pipe = cropPipe(jpeg, c);
  // Enlarged first: thin segment bars become wider and the pixel grid of a photographed screen (moire) is smoothed out by the resampling.
  const up = clamp(Math.min(3, 2400 / c.width, 840 / c.height), 1, 4);
  if (up > 1.05) pipe = pipe.resize({ width: Math.round(c.width * up), height: Math.round(c.height * up), kernel: 'lanczos3' });
  const { data, info } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  alive();
  const W = info.width, H = info.height;
  // Find the bright LED cores, not the whole coloured glow / tinted display panel.
  // Including the panel in this box makes the decoder treat the background as lit
  // segments and often pushes the crop to an edge.
  const maxPixels = new Uint8Array(W * H);
  for (let i = 0; i < maxPixels.length; i++) {
    const j = i * 3;
    maxPixels[i] = Math.max(data[j], data[j + 1], data[j + 2]);
  }
  const sorted = Uint8Array.from(maxPixels).sort();
  const p98 = sorted[Math.floor(sorted.length * 0.98)];
  const coreThreshold = Math.max(105, p98 * 0.78);
  const xs = [], ys = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = maxPixels[y * W + x];
    const mid = r + g + b - max - Math.min(r, g, b);
    if (max >= coreThreshold && mid > 55 && isLit(r, g, b)) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 60) { dbg(`7-seg ${c.name}: only ${xs.length} bright core pixels, not a readable display`); return []; }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  // Keep nearly all core pixels so the first / last digit and decimal point are not clipped.
  let x0 = q(xs, 0.001), x1 = q(xs, 0.999), y0 = q(ys, 0.001), y1 = q(ys, 0.999);
  const mX = Math.max(3, Math.round((x1 - x0 + 1) * 0.08)), mY = Math.max(3, Math.round((y1 - y0 + 1) * 0.10));
  x0 = Math.max(0, x0 - mX); x1 = Math.min(W - 1, x1 + mX); y0 = Math.max(0, y0 - mY); y1 = Math.min(H - 1, y1 + mY);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  dbg(`7-seg ${c.name}: crop ${c.width}x${c.height} -> read at ${W}x${H}, bright-core box x=${x0}..${x1} y=${y0}..${y1} (${bw}x${bh}), threshold=${coreThreshold.toFixed(1)}`);
  if (bw < 30 || bh < 20) { dbg(`7-seg ${c.name}: bright-core box ${bw}x${bh}px is too small`); return []; }
  // brightness of every pixel inside the box (mean of R, G, B): the pale core of a lit segment is brighter than its coloured glow whatever the
  // LED colour is (red, green, cyan ...), so this mask needs no colour rule. p98 of it = the lit cores.
  const mean = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = ((y0 + y) * W + x0 + x) * 3; mean[y * bw + x] = (data[i] + data[i + 1] + data[i + 2]) / 3; }
  const mSorted = Uint8Array.from(mean).sort(); const mp98 = mSorted[Math.floor(mSorted.length * 0.98)];
  const out = [];
  const attempt = (label, m) => {
    alive();
    let d; try { d = decodeSevenSeg(m, bw, bh); } catch (e) { d = { ok: false }; }
    dbg(`7-seg ${c.name}: ${label} -> ${d.ok ? `"${d.text}"` : `unreadable (${d.reason})`}`);
    if (d.ok) out.push({ text: d.text, value: toNumber(d.text, { insertDot: false }) });
  };
  for (const frac of LED_LEVELS) { // model A: colour mask (lit segment = bright AND not a pure glow colour)
    const cth = p98 * frac, m = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = ((y0 + y) * W + x0 + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
      const med = r + g + b - Math.max(r, g, b) - Math.min(r, g, b);   // middle channel: lit segment cores are pale, the red glow around them is not
      if (Math.max(r, g, b) > cth && med > 60) m[y * bw + x] = 1;
    }
    attempt(`colour level ${frac}`, m);
  }
  for (const frac of BRIGHT_LEVELS) { // model B: brightness mask (any LED colour)
    const th = mp98 * frac, m = new Uint8Array(bw * bh);
    for (let i = 0; i < m.length; i++) if (mean[i] >= th) m[i] = 1;
    attempt(`brightness level ${frac}`, m);
  }
  // The small decimal point is the first thing to vanish when the brightness level changes (112.2 at one level, 1122 at the next).
  // A level that shows the SAME digits without a dot supports the level that found the dot (a dot is never invented, only lost);
  // dots at different places, or different digits, still disagree and the photo is refused.
  const dotted = out.find((r) => r.text.includes('.'));
  if (dotted) {
    const bare = dotted.text.replace('.', '');
    for (const r of out) if (!r.text.includes('.') && r.text === bare) { r.text = dotted.text; r.value = toNumber(dotted.text, { insertDot: false }); }
  }
  return out;
}

/* ---------------- 3. text -> number ---------------- */
// opts.insertDot: tesseract often loses the dot, so WEIGHING_OCR_DECIMALS may put it back. The 7-segment decoder sees the dot itself: never inserted for it.
function toNumber(text, opts = {}) {
  const insertDot = opts.insertDot !== false;
  const t = String(text).replace(/[\s,]/g, '').replace(/[^0-9.]/g, '');
  const m = t.match(/\d+\.\d+|\d{2,}|\d/g);
  if (!m) return null;
  if ((t.match(/\./g) || []).length > 1) return null;               // "1.1.22" is a misread
  let s = m.sort((a, b) => b.length - a.length)[0];           // the longest run of digits is the weight
  const fd = forcedDecimals();
  if (!s.includes('.')) {
    if (insertDot && fd && s.length > fd) s = `${s.slice(0, -fd)}.${s.slice(-fd)}`; // dot lost by the engine: the machine always shows N decimals
    else if (requireDecimal()) return null;                           // no visible decimal point: not certain enough
  } else if (fd && s.split('.')[1].length !== fd) return null;
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(s)) return null;               // digits [. up to 3 decimals]: anything else is a misread
  const v = Number(s);
  if (!Number.isFinite(v) || !(v > 0) || v > 1000000) return null;
  if (/^0\d/.test(s)) return null;                                    // "012.2" is a misread
  return Math.round(v * 1000) / 1000;
}

/* ---------------- 4. read ---------------- */
const refuse = (text, reason, engine = ENGINE) => ({ value: null, unit: null, confidence: null, text: text || null, engine, reason });

// ctx.dead is set by readWeight() when its time limit passes; every long step checks it and stops.
async function readOnce(jpeg, ctx = { dead: false }) {
  const t0 = Date.now();
  dbg(`ocr.js version ${OCR_VERSION}`);
  if (ctx.dead) throw new Error('OCR timed out');
  let work = jpeg;
  // Phone held sideways: when no lit display is found upright, try the photo turned by 90 / 270 degrees (cheap scan, no OCR).
  if (!(await candidates(jpeg, true)).some((x) => x.led)) {
    for (const deg of [90, 270]) {
      if (ctx.dead) throw new Error('OCR timed out');
      const rj = await sharp(jpeg).rotate(deg).jpeg({ quality: 92 }).toBuffer();
      if ((await candidates(rj, true)).some((x) => x.led)) { dbg(`display found after rotating ${deg} degrees`); work = rj; break; }
    }
  }
  const res = await readOnceInner(work, ctx);
  dbg(`FINAL value=${res.value} confidence=${res.confidence} engine=${res.engine} text=${JSON.stringify(res.text)}${res.reason ? ` reason="${res.reason}"` : ''} (${Date.now() - t0} ms)`);
  return res;
}

async function readOnceInner(jpeg, ctx = { dead: false }) {
  const alive = () => { if (ctx.dead) throw new Error('OCR timed out'); };
  const minAgree = Math.max(1, Math.round(envNum('WEIGHING_OCR_MIN_AGREE', 2)));
  const tessMin = envNum('WEIGHING_OCR_TESS_MIN_CONF', 60);
  const maxTess = Math.round(envNum('WEIGHING_OCR_MAX_TESS', 12));
  const cands = await candidates(jpeg);
  const debugDir = process.env.WEIGHING_OCR_DEBUG_DIR;
  const save = (name, buf) => { if (!debugDir) return; try { fs.mkdirSync(debugDir, { recursive: true }); fs.writeFileSync(path.join(debugDir, `${Date.now()}-${name}.png`), buf); } catch (e) { /* ignore */ } };
  const votes = new Map(); // number -> { n, conf, texts, led, seg }
  let tried = 0, sawText = '', tessCalls = 0;
  const deadline = Date.now() + envNum('WEIGHING_OCR_TIMEOUT_MS', 25000) * 0.5; // leave time to answer: a late 'timed out' hides the real reason
  if (!cands.some((x) => x.led)) dbg('no lit-LED display found: falling back to LCD bands (stricter agreement)');

  // Phase 1: the 7-segment decoder on EVERY lit-LED candidate first. It is exact when the segments are visible and never guesses.
  // (Other lit things in the photo - e.g. the green keys under the display - decode to nothing useful and are simply ignored.)
  const segVotes = new Map();
  const skipSeg = String(process.env.WEIGHING_OCR_SKIP_7SEG || '').toLowerCase() === 'true'; // diagnostics only: test the tesseract path on its own
  for (const c of skipSeg ? [] : cands.filter((x) => x.led)) {
    alive();
    let reads = [];
    try { reads = (await readLed(jpeg, c, alive)).filter((r) => r.value !== null); } catch (e) { if (/timed out/i.test(e.message)) throw e; dbg(`7-seg ${c.name} skipped: ${e.message}`); }
    tried += LED_LEVELS.length + BRIGHT_LEVELS.length;
    for (const r of reads) { const e = segVotes.get(r.value) || { n: 0, texts: [] }; e.n += 1; e.texts.push(r.text); segVotes.set(r.value, e); }
  }
  if (segVotes.size) {
    const ranked = [...segVotes.entries()].sort((a, b) => b[1].n - a[1].n);
    const [value, top] = ranked[0], second = ranked[1];
    const total = ranked.reduce((a, [, e]) => a + e.n, 0);
    dbg(`7-seg votes: ${ranked.map(([v, e]) => `${v} x${e.n}`).join(', ')} (need >= ${minAgree} and 2x the runner-up)`);
    // a clear majority of the brightness levels must agree; a close second reading means the digits are not clear enough (a wrong weight is worse than none)
    if (top.n >= minAgree && (!second || top.n >= second[1].n * 2)) {
      const confidence = Math.round(Math.min(99, 0.5 * 92 + 0.5 * (top.n / total) * 100) * 10) / 10;
      return { value, unit: null, confidence, text: top.texts[0], engine: ENGINE_7SEG, reason: null };
    }
    if (second && top.n < second[1].n * 2) return refuse(ranked.map(([, e]) => e.texts[0]).join(' / '), 'The display digits are too small or blurred to read safely. Move closer so the display fills more of the photo and retake it', ENGINE_7SEG);
    for (const [k, e] of segVotes) votes.set(k, { n: e.n, conf: 92 * e.n, texts: e.texts, led: true, seg: e.n });
  }

  // Phase 2: tesseract (digits only, PSM 7 = line and PSM 8 = word) on 4x-6x enhanced versions of each crop, at most maxTess calls per photo.
  // A read counts only when tesseract itself is confident AND the text parses to a number with a visible decimal point.
  const haveDisplay = cands.some((x) => x.led);
  // A lit display was located but could not be read: wandering over the rest of the photo (labels, stickers, QR) can only find the wrong
  // numbers, and costs time. Refuse now so the user retakes the photo.
  outer:
  for (const c of haveDisplay ? cands.filter((x) => x.led) : cands) {
    alive();
    save(`${c.name}-original`, await cropPipe(jpeg, c).png().toBuffer()); // the untouched crop, for troubleshooting
    for await (const v of variants(jpeg, c)) {
      alive();
      if (Date.now() > deadline) { dbg('time budget used up: no more tesseract attempts'); break outer; }
      if (tessCalls >= maxTess) { dbg(`tesseract call limit (${maxTess}) reached`); break outer; }
      save(`${c.name}-${v.name}`, v.buf);
      for (const psm of [7, 8]) {
        if (tessCalls >= maxTess) break;
        tessCalls += 1; tried += 1; alive();
        let r;
        try { r = await recognise(v.buf, psm); } catch (e) { if (/traineddata|network|fetch|ENOTFOUND|getaddrinfo/i.test(e.message)) throw e; continue; }
        const num = toNumber(r.text);
        const used = num !== null && r.confidence >= tessMin;
        dbg(`tesseract ${c.name}/${v.name} ${v.w}x${v.h}px psm${psm}: text=${JSON.stringify(r.text.trim())} confidence=${r.confidence.toFixed(1)} parsed=${num ?? '-'}${num !== null && !used ? ` IGNORED (confidence < ${tessMin})` : ''}`);
        if (r.text.trim()) sawText = r.text.trim();
        if (!used) continue;
        const e = votes.get(num) || { n: 0, conf: 0, texts: [], led: c.led, seg: 0 };
        e.n += 1; e.conf += r.confidence; e.texts.push(r.text.trim()); e.led = e.led || c.led; votes.set(num, e);
      }
      // an LED crop with an agreed number is the display: stop, do not wander over the rest of the photo
      const best = [...votes.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      if (c.led && best && best[1].n >= Math.max(minAgree, 3)) break;
    }
    const best = [...votes.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (c.led && best && best[1].n >= minAgree) break;
  }
  if (!votes.size) return refuse(sawText, tried ? 'No clear weight could be read from the display' : 'The weight display could not be found in the photo');
  const ranked = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || b[1].conf - a[1].conf);
  dbg(`votes: ${ranked.map(([v, e]) => `${v} x${e.n}${e.led ? ' (display)' : ' (band)'}`).join(', ')}`);
  const [value, top] = ranked[0];
  const second = ranked[1];
  // a number found only in the LCD fallback bands could be a label or sticker (e.g. 'Max 300kg'): it needs more proof than a lit display
  const needed = top.led ? minAgree : Math.max(3, minAgree);
  if (top.n < needed) return refuse(top.texts[0], 'The display reading is not certain (the photo reads differently each time). Retake a clearer photo');
  if (second && top.n < second[1].n * 2) return refuse(top.texts[0], `The display could be read as ${value} or ${second[0]}. Retake a clearer photo`);
  const agree = (top.n / Math.max(1, [...votes.values()].reduce((a, b) => a + b.n, 0))) * 100;
  const avgConf = top.seg ? 92 : top.conf / top.n;
  const confidence = Math.round(Math.min(99, 0.5 * avgConf + 0.5 * agree) * 10) / 10;
  return { value, unit: null, confidence, text: top.texts[0], engine: top.seg ? ENGINE_7SEG : ENGINE, reason: null };
}

async function readWeight(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Image buffer is missing');
  const limit = envNum('WEIGHING_OCR_TIMEOUT_MS', 25000);
  const ctx = { dead: false };
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => { ctx.dead = true; rej(new Error('OCR timed out')); }, limit); });
  // the job is also marked dead on timeout, so it stops at its next check instead of blocking every later photo in the queue
  try { return await Promise.race([serial(() => readOnce(buffer, ctx)), timeout]); }
  finally { clearTimeout(timer); }
}

async function terminate() {
  const p = workerP; workerP = null;
  if (p) { try { (await p).terminate(); } catch (e) { /* ignore */ } }
}

module.exports = { readWeight, terminate, toNumber, candidates, checkBox };