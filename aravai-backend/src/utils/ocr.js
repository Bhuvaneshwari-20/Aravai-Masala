// Weighing machine display reader.
//
// The reading itself is done by the Python + OpenCV module in  <backend>/python/weight_reader  (reader.py):
//   find the digit display automatically -> crop only that display -> enhance -> read the large 7-segment weight digits
//   (RED / GREEN / white LED and LCD) -> decimal point -> repeat with several thresholds and require agreement.
// This file only talks to it through ONE long-running child process (python/weight_reader/worker.py, JSON lines over stdin/stdout),
// so OpenCV is imported once, not for every photo.  No network port is opened.
//
// Public contract is unchanged (used by batchWeightImageService and weighingService):
//   readWeight(jpegBuffer) -> { value, unit, confidence, text, engine, reason }
//     value = number (kg or g as shown) or null when the display cannot be identified / the reading is not certain
//     unit  = 'kg' | 'g' only when it was read for certain, otherwise null (callers treat no unit as kg)
//     reason = clear message when value is null
// The weight typed by the operator is never an input here, so it cannot influence the reading.
//
// .env (all optional)
//   WEIGHING_PYTHON              python executable            default: python3 (python on Windows)
//   WEIGHING_PY_DIR              folder with worker.py        default: <backend>/python/weight_reader
//   WEIGHING_OCR_TIMEOUT_MS      max time for one photo       default: 30000
//   WEIGHING_OCR_REQUIRE_DECIMAL true|false                   default: true   (a reading without a visible decimal point is refused)
//   WEIGHING_OCR_DECIMALS        e.g. 1                       default: unset  (decimal point must leave exactly that many decimals)
//   WEIGHING_OCR_MIN_AGREE       threshold variants that must agree      default: 2
//   WEIGHING_OCR_DEBUG_DIR       folder to save the enhanced display crop for troubleshooting
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = 'opencv-7seg';

const pyDir = () => process.env.WEIGHING_PY_DIR || path.resolve(__dirname, '..', '..', 'python', 'weight_reader');
const pyExe = () => process.env.WEIGHING_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const timeoutMs = () => {
    const n = Number(process.env.WEIGHING_OCR_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 30000;
};

let child = null;
let nextId = 1;
let stdoutBuf = '';
const pending = new Map(); // id -> { resolve, reject, timer }

// reject the requests that were sent to `proc` (all of them when proc is omitted)
function failAll(error, proc = null) {
    for (const [id, p] of pending) {
        if (proc && p.proc !== proc) continue;
        clearTimeout(p.timer);
        pending.delete(id);
        p.reject(error);
    }
}

function onLine(line) {
    if (!line.trim()) return;

    let msg;
    try {
        msg = JSON.parse(line);
    } catch (e) {
        console.error('OCR worker: unreadable output ignored:', line.slice(0, 200));
        return;
    }

    const p = pending.get(msg.id);
    if (!p) return;

    pending.delete(msg.id);
    clearTimeout(p.timer);

    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
}

function start() {
    if (child) return child;

    const proc = spawn(pyExe(), ['worker.py'], {
        cwd: pyDir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
    });

    child = proc;
    stdoutBuf = '';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
        stdoutBuf += chunk;
        let i;
        while ((i = stdoutBuf.indexOf('\n')) >= 0) {
            const line = stdoutBuf.slice(0, i);
            stdoutBuf = stdoutBuf.slice(i + 1);
            onLine(line);
        }
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', d => {
        const t = String(d).trim();
        if (t) console.error('OCR worker:', t.slice(0, 500));
    });

    // python / OpenCV not installed, or the process died: fail what is waiting, start fresh on the next photo
    proc.on('error', err => {
        if (child === proc) child = null;
        failAll(new Error(`Python OCR could not be started (${pyExe()}): ${err.message}`), proc);
    });
    proc.on('exit', code => {
        if (child === proc) child = null;
        failAll(new Error(`Python OCR stopped unexpectedly (exit code ${code})`), proc);
    });

    return proc;
}

async function terminate() {
    const proc = child;
    child = null;
    failAll(new Error('OCR stopped'));
    if (proc) {
        try { proc.stdin.end(); } catch (e) { /* ignore */ }
        proc.kill();
    }
}

function ask(buffer) {
    return new Promise((resolve, reject) => {
        const proc = start();
        const id = nextId++;

        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('OCR timed out'));
            // a stuck worker would block every later photo: replace it
            if (child === proc) child = null;
            proc.kill();
        }, timeoutMs());

        pending.set(id, { resolve, reject, timer, proc });

        proc.stdin.write(JSON.stringify({ id, image: buffer.toString('base64') }) + '\n', err => {
            if (err && pending.has(id)) {
                pending.delete(id);
                clearTimeout(timer);
                reject(err);
            }
        });
    });
}

/* EXPORTED FUNCTION */

async function readWeight(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('Image buffer is missing');
    }

    const r = await ask(buffer); // throws when Python / OpenCV is not available: callers record "OCR engine error" and never approve

    const value = typeof r.value === 'number' && Number.isFinite(r.value) && r.value > 0 ? r.value : null;
    const unit = value !== null && (r.unit === 'kg' || r.unit === 'g') ? r.unit : null;

    return {
        value,
        unit,
        confidence: value !== null && Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : null,
        text: r.text ? String(r.text).slice(0, 300) : null,
        engine: r.engine || ENGINE,
        reason: value !== null ? null : (r.reason || 'The weight could not be read from the photo. Retake a clearer photo of the display.')
    };
}

module.exports = {
    readWeight,
    terminate
};
