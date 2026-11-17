// OCR for the digits shown on a weighing-machine display.
//
// Provider is chosen with WEIGHING_OCR_PROVIDER:
//   tesseract (default) - tesseract.js, runs inside this Node process, no external service
//   anthropic           - Claude vision reads the display (needs ANTHROPIC_API_KEY). Best for LED/7-segment digits
//   none                - OCR disabled: every image becomes UNREADABLE and goes to manual review
// To plug in another engine (Google Vision, AWS Textract ...) add a provider below that returns
// the same shape as readWeight(): { value, unit, confidence, text, engine, reason }.
//
// Safety rules (OCR is never assumed to be right):
//  * several different numbers on the display and no unit to tell them apart -> no value (UNREADABLE)
//  * the 3 image variants disagree -> no value (UNREADABLE)
//  * the entered weight is NEVER given to the OCR or used to pick between candidates.
const path = require('path');
const sharp = require('sharp');

const ENGINE = 'tesseract.js';
let workerPromise = null;
let queue = Promise.resolve(); // one recognition at a time per worker

function langPath() {
  if (process.env.WEIGHING_OCR_LANG_PATH) return process.env.WEIGHING_OCR_LANG_PATH;
  // traineddata ships inside the npm package @tesseract.js-data/eng, so no download at runtime
  return path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const w = await createWorker('eng', 1, { langPath: langPath(), gzip: true, cacheMethod: 'none' });
      await w.setParameters({
        tessedit_char_whitelist: '0123456789.,kgKG ',
        tessedit_pageseg_mode: '11', // sparse text: LCD digits are not a normal paragraph
        user_defined_dpi: '300',
      });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

async function terminate() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  if (w) await w.terminate();
}

/* ---------- text -> weight ---------- */
const NUM = /^(\d+(?:[.,]\d{1,3})?)(kg|g)?$/i;

// words = [{ text, confidence }] in reading order
function candidatesFrom(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const t = String(words[i].text || '').trim().replace(/\s+/g, '');
    const m = NUM.exec(t);
    if (!m) continue;
    const raw = m[1].replace(',', '.');
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 100000) continue;
    let unit = m[2] ? m[2].toLowerCase() : null;
    if (!unit && words[i + 1]) {
      const nx = String(words[i + 1].text || '').trim().toLowerCase();
      if (nx === 'kg' || nx === 'g') unit = nx;
    }
    out.push({ value, unit, hasDot: raw.includes('.'), confidence: Number(words[i].confidence) || 0, token: t });
  }
  return out;
}

// -> { value, unit, confidence } or { reason }
function pickWeight(words) {
  let c = candidatesFrom(words);
  if (!c.length) return { reason: 'No number found on the display' };
  const withUnit = c.filter((x) => x.unit);
  if (withUnit.length) c = withUnit;
  else if (c.some((x) => x.hasDot)) c = c.filter((x) => x.hasDot); // scales show 20.000, stray digits do not
  const key = (x) => `${x.value}|${x.unit || ''}`;
  const distinct = new Set(c.map(key));
  if (distinct.size > 1) return { reason: 'More than one number found on the display' };
  const best = c.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return { value: best.value, unit: best.unit, confidence: best.confidence };
}

/* ---------- image variants ---------- */
async function variants(buffer) {
  const base = sharp(buffer, { limitInputPixels: 60e6 }).rotate().resize({ width: 1600, withoutEnlargement: false }).grayscale().normalise();
  const a = await base.clone().sharpen().png().toBuffer();
  const b = await base.clone().negate().png().toBuffer();   // light digits on dark glass
  const c = await base.clone().threshold(128).png().toBuffer();
  return [a, b, c];
}

function flattenWords(data) {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}

async function recognise(buf) {
  const run = async () => {
    const w = await getWorker();
    const { data } = await w.recognize(buf, {}, { blocks: true });
    return { words: flattenWords(data), text: String(data.text || '').trim() };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function readTesseract(buffer) {
  const imgs = await variants(buffer);
  const reads = [];
  let lastText = '';
  for (const img of imgs) {
    const { words, text } = await recognise(img);
    if (text) lastText = text;
    const r = pickWeight(words);
    if (r.value !== undefined) reads.push({ ...r, text });
    // first variant already confident and clean: no need to spend time on the others
    if (reads.length === 1 && reads[0].confidence >= 90 && img === imgs[0]) break;
  }
  if (!reads.length) return { value: null, unit: null, confidence: null, text: lastText.slice(0, 250), engine: ENGINE, reason: 'No reliable number found in the image' };

  // majority of variants decides; a tie between different values is not trusted
  const groups = new Map();
  for (const r of reads) {
    const k = `${r.value}|${r.unit || ''}`;
    const g = groups.get(k) || { ...r, n: 0, conf: 0 };
    g.n += 1; g.conf += r.confidence;
    groups.set(k, g);
  }
  const ranked = [...groups.values()].sort((x, y) => y.n - x.n || y.conf - x.conf);
  if (ranked.length > 1 && ranked[0].n === ranked[1].n) {
    return { value: null, unit: null, confidence: null, text: lastText.slice(0, 250), engine: ENGINE, reason: 'Image reads disagree with each other' };
  }
  const top = ranked[0];
  return { value: top.value, unit: top.unit, confidence: Math.round((top.conf / top.n) * 100) / 100, text: top.text.slice(0, 250), engine: ENGINE, reason: null };
}


/* ---------- Claude vision provider (reads LED / 7-segment displays reliably) ---------- */
async function readAnthropic(buffer) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { value: null, unit: null, confidence: null, text: null, engine: 'anthropic', reason: 'ANTHROPIC_API_KEY is not set' };
  const model = process.env.WEIGHING_OCR_MODEL || 'claude-sonnet-5-5';
  // normalise orientation + size; phone photos can be huge
  const jpeg = await sharp(buffer, { limitInputPixels: 60e6 }).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const prompt =
    'This is a photo of an industrial weighing machine indicator. Read ONLY the main weight number shown on the digital display ' +
    '(the large LED / 7-segment digits). Ignore printed labels, stickers, "Max"/"Min" capacity text and QR codes. ' +
    'Include the decimal point exactly as shown. If the display is not visible, blank, or you are not sure about every digit, say so. ' +
    'Reply with JSON only, no other text: {"readable": true|false, "value": <number or null>, "unit": "kg"|"g"|null}';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
        { type: 'text', text: prompt },
      ] }],
    }),
  });
  if (!res.ok) return { value: null, unit: null, confidence: null, text: null, engine: 'anthropic', reason: `Vision API error ${res.status}` };
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  let j;
  try { j = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch (e) { j = null; }
  const value = j && j.readable && Number.isFinite(Number(j.value)) && Number(j.value) > 0 ? Number(j.value) : null;
  if (value === null) return { value: null, unit: null, confidence: null, text: text.slice(0, 250), engine: 'anthropic', reason: 'No reliable number found in the image' };
  const unit = j.unit === 'g' || j.unit === 'kg' ? j.unit : 'kg';
  return { value, unit, confidence: null, text: text.slice(0, 250), engine: 'anthropic:' + model, reason: null };
}

async function readWeight(buffer) {
  const provider = (process.env.WEIGHING_OCR_PROVIDER || 'tesseract').toLowerCase();
  if (provider === 'none') return { value: null, unit: null, confidence: null, text: null, engine: 'none', reason: 'OCR is disabled' };
  if (provider === 'anthropic') return readAnthropic(buffer);
  if (provider === 'tesseract') return readTesseract(buffer);
  throw new Error(`Unknown WEIGHING_OCR_PROVIDER "${provider}"`);
}

module.exports = { readWeight, pickWeight, candidatesFrom, terminate };