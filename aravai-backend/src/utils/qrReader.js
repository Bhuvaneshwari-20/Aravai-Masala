// Machine QR reader - decoded by the Python service (ocr_service/app.py, OpenCV), from the pixels of the photo.
//
//   readQr(jpegBuffer) -> { found, value }
//     found = true when a REAL QR code was decoded from the pixels (the printed text under the QR, e.g. "MAC-001", is never used)
//     value = the decoded QR payload exactly as stored in the QR (machine code, token, or APP_URL/machine/<token>)
//
// extractMachineRefs(value) -> candidate strings that may identify a machine (machine code, token, URL part, JSON field ...)
const { post } = require('./ocr');

async function readQr(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Image buffer is missing');
  const r = await post('/qr', buffer);
  const value = r && r.found && r.value ? String(r.value).trim() : '';
  return value ? { found: true, value, attempts: 1, how: 'python', location: null } : { found: false, value: null, attempts: 1, how: null, location: null };
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
