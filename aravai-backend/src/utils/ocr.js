// Weighing machine display reader - Python service (ocr_service/app.py, RapidOCR + OpenCV, fully local, no cloud).
//
// Public contract (used by batchWeightImageService and weighingService):
//   readWeight(jpegBuffer) -> { value, unit, confidence, text, engine, reason }
//     value  = number as shown on the display, or null when it cannot be read with certainty
//     unit   = always null (callers treat "no unit" as kg)
//     reason = clear message when value is null
//   The weight is only ever READ here. It is never given the weight typed in the form; the caller compares the two.
//   When the Python service is not running or fails, the result is value = null (UNREADABLE): a photo is never approved on an error.
//
// .env (optional)
//   OCR_SERVICE_URL          default http://127.0.0.1:8002
//   OCR_SERVICE_TIMEOUT_MS   default 60000
const URL_BASE = () => (process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8002').replace(/\/$/, '');
const TIMEOUT = () => { const n = Number(process.env.OCR_SERVICE_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 60000; };

const DOWN = 'The photo reader is not running. Start ocr_service (python -m uvicorn app:app --host 127.0.0.1 --port 8002) and try again';

// POST the photo to the Python service. Throws Error with .serviceDown = true when the service cannot be reached.
async function post(route, buffer) {
  let res;
  try {
    res = await fetch(`${URL_BASE()}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:image/jpeg;base64,${buffer.toString('base64')}` }),
      signal: AbortSignal.timeout(TIMEOUT()),
    });
  } catch (e) {
    const err = new Error(/timeout|abort/i.test(String(e && (e.name || e.message))) ? 'OCR timed out' : DOWN);
    err.serviceDown = !/timed out/i.test(err.message);
    throw err;
  }
  if (!res.ok) throw new Error(`The photo reader answered ${res.status}`);
  return res.json();
}

async function readWeight(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Image buffer is missing');
  try {
    const r = await post('/weight', buffer);
    const value = r.value === null || r.value === undefined ? null : Number(r.value);
    if (value === null || !Number.isFinite(value)) {
      return { value: null, unit: null, confidence: null, text: r.text || null, engine: r.engine || 'rapidocr', reason: r.reason || 'No weight could be read from the display' };
    }
    return { value, unit: null, confidence: r.confidence ?? null, text: r.text || null, engine: r.engine || 'rapidocr', reason: null };
  } catch (e) {
    console.error('Weight reader failed:', e.message);
    const reason = /timed out/i.test(e.message) ? 'Reading the photo took too long. Retake a clearer photo of the display' : e.message;
    return { value: null, unit: null, confidence: null, text: null, engine: 'error', reason };
  }
}

async function terminate() { /* nothing to close: the Python service keeps running on its own */ }

module.exports = { readWeight, terminate, post };
