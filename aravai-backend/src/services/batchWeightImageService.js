// Batching: photo of the weighing machine display -> OCR -> compared with the weighed quantity typed in the batching screen.
//   MATCH       |OCR weight - entered weight| is within the tolerance   -> the ONLY status that lets the weighing / batch be saved
//   MISMATCH    weights differ                                         -> saving is blocked
//   UNREADABLE  image unclear / OCR not confident / no weight found    -> saving is blocked, another photo is requested
// The photo is stored against the batch + material (batching_detail_id is filled when the weighing is saved).
// Uses the same OCR engine and image store as the machine QR weighing module.
// Tolerance / confidence (.env, all optional):  BATCH_WEIGHT_TOLERANCE_KG (0.05)  BATCH_WEIGHT_TOLERANCE_PERCENT (0)  BATCH_WEIGHT_MIN_CONFIDENCE (60)
//   each falls back to the older WEIGHING_TOLERANCE_KG / WEIGHING_TOLERANCE_PERCENT / WEIGHING_OCR_MIN_CONFIDENCE.
// QR scanning, QR token validation and machine identification are OFF (MACHINE_QR_ENABLED, utils/featureFlags.js): verification never
// uses machine_id / qr_value. The machine / QR code below is kept only so it can be switched on again.
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { audit } = require('../utils/audit');
const ocr = require('../utils/ocr');
const images = require('../utils/imageStore');
const machines = require('./machineService');
const { readQr, extractMachineRefs } = require('../utils/qrReader');
const { MACHINE_QR_ENABLED } = require('../utils/featureFlags');

const r3 = (n) => Math.round(n * 1000) / 1000;
const grams = (n) => Math.round(n * 1000);
const PASSING = ['MATCH']; // only a MATCH may be saved (MANUAL verification is no longer accepted)
const USABLE_MACHINE_STATUS = ['ACTIVE', 'IDLE'];
// Two INDEPENDENT checks on the SAME photo (run in parallel):
//   1. Machine : the QR code is decoded from the pixels (qrReader.js) -> machine in machine_master -> compared with the selected / batch-locked machine.
//                MATCH | MISMATCH | NOT_READ (no QR decoded) | NOT_CHECKED (no machine to compare with). Only MATCH may be saved.
//   2. Weight  : only the LED/LCD display is read (ocr.js) -> detected weight.
// The printed text next to the QR is never used to identify the machine.

function config() {
  const num = (k, d) => { const n = Number(process.env[k] ?? d); return Number.isFinite(n) && n >= 0 ? n : d; };
  const first = (a, b, d) => (process.env[a] !== undefined && process.env[a] !== '' ? num(a, d) : num(b, d));
  return {
    toleranceKg: first('BATCH_WEIGHT_TOLERANCE_KG', 'WEIGHING_TOLERANCE_KG', 0.05),
    tolerancePct: first('BATCH_WEIGHT_TOLERANCE_PERCENT', 'WEIGHING_TOLERANCE_PERCENT', 0),
    minConfidence: first('BATCH_WEIGHT_MIN_CONFIDENCE', 'WEIGHING_OCR_MIN_CONFIDENCE', 60),
  };
}

// Pure: OCR answer + entered KG -> verdict. The entered weight is only compared, never given to the OCR.
// tareKg (optional): the display shows the GROSS weight; net = gross - tare is what is compared with the entered (net) weight and what gets saved.
//   returns detected = gross (what the display shows), net, tare. Without a tare net = gross, so nothing changes for machines without a tare.
function compare(enteredKg, res, cfg, tareKg = 0) {
  const tol = r3(Math.max(cfg.toleranceKg, (enteredKg * cfg.tolerancePct) / 100));
  // not confident = unreadable: a value without a confidence figure, or below the minimum, is never trusted
  const noConf = res.confidence === null || res.confidence === undefined || !Number.isFinite(Number(res.confidence));
  const lowConf = !noConf && Number(res.confidence) < cfg.minConfidence;
  const tare = tareKg > 0 ? r3(tareKg) : null;
  if (res.value === null || res.value === undefined || noConf || lowConf) {
    return { status: 'UNREADABLE', detected: null, net: null, tare, difference: null, tolerance: tol,
      reason: lowConf ? `OCR confidence ${res.confidence} is below ${cfg.minConfidence}` : (res.value === null || res.value === undefined ? (res.reason || 'No weight could be read from the display') : 'The weight could not be read with enough confidence') };
  }
  const gross = r3(String(res.unit || '').toLowerCase() === 'g' ? res.value / 1000 : res.value); // no unit on the display = kg (batching is in kg)
  const net = r3(gross - (tare || 0));
  if (!(net > 0)) return { status: 'UNREADABLE', detected: gross, net: null, tare, difference: null, tolerance: tol, reason: `The weight on the display (${gross} kg) is not above the machine tare (${tare} kg)` };
  const ok = Math.abs(grams(net) - grams(enteredKg)) <= grams(tol);
  return { status: ok ? 'MATCH' : 'MISMATCH', detected: gross, net, tare, difference: r3(net - enteredKg), tolerance: tol, reason: null };
}

// QR scan -> machine of this weighing.  expected machine = the one the batch is locked to, else the one chosen in the form.
//   strict is retained only for the separate legacy QR verification endpoint. Batching photo OCR uses strict=false and does not require QR.
// Returns { id, machine_code, machine_name, tare_weight_kg } or null when the weighing has no machine at all (old behaviour).
async function resolveMachine({ qrValue, selectedId = null, lockedId = null, strict = false }) {
  const hasQr = qrValue !== undefined && qrValue !== null && String(qrValue).trim() !== '';
  if (lockedId && selectedId && Number(lockedId) !== Number(selectedId)) throw new AppError('This batch is locked to another weighing machine. Select the assigned machine to continue', 403);
  const expectedId = lockedId || selectedId || null;
  let m;
  if (hasQr) {
    m = await machines.getByToken(qrValue); // 404 for an unknown code; accepts the QR link, the token or the machine code
  } else {
    if (!strict && !expectedId) return null;
    if (strict) throw new AppError('Machine QR verification is not used by weight-only batching verification');
    if (!expectedId) return null;
    m = await machines.getById(expectedId); // use selected / batch-locked machine; QR is not required
  }
  if (m.machine_type !== 'WEIGHING') throw new AppError(`${m.machine_code} - ${m.machine_name} is not a weighing machine`);
  if (!USABLE_MACHINE_STATUS.includes(m.status)) throw new AppError(`Weighing machine ${m.machine_code} - ${m.machine_name} is ${String(m.status).toLowerCase().replace(/_/g, ' ')}. Use another machine`);
  if (expectedId && Number(m.id) !== Number(expectedId)) {
    throw new AppError(lockedId
      ? `Wrong machine (${m.machine_code}). This batch is locked to another weighing machine`
      : `Wrong machine (${m.machine_code} - ${m.machine_name}). The selected machine is different from the machine assigned to this batch`, 403);
  }
  const tare = Number(m.tare_weight_kg);
  return { id: m.id, machine_code: m.machine_code, machine_name: m.machine_name, tare_weight_kg: Number.isFinite(tare) && tare > 0 ? r3(tare) : null };
}

// Machine the batch is locked to (batch_master.weighing_machine_id, or the machine of its first weighing for older batches), or null.
async function lockedMachineOf(db, batchId) {
  const [b] = await db.query('SELECT weighing_machine_id FROM batch_master WHERE id = ?', [batchId]);
  if (!b.length) throw new AppError('Batch not found', 404);
  if (b[0].weighing_machine_id) return b[0].weighing_machine_id;
  const [r] = await db.query('SELECT weighing_machine_id FROM batching_details WHERE batch_id = ? AND weighing_machine_id IS NOT NULL ORDER BY id LIMIT 1', [batchId]);
  return r.length ? r[0].weighing_machine_id : null;
}

// POST /batches/verify-machine  { qr_value, machine_id?, batch_id? }  -> the machine behind the scanned QR (404 / 403 / 400 when it is not usable here)
async function verifyMachine(body) {
  if (!MACHINE_QR_ENABLED) throw new AppError('Machine QR verification is temporarily disabled. Batching weight verification does not need a machine QR code', 503);
  const selectedId = body.machine_id ? v.toId(body.machine_id, 'weighing machine') : null;
  const batchId = body.batch_id ? v.toId(body.batch_id, 'batch id') : null;
  const lockedId = batchId ? await lockedMachineOf(pool, batchId) : null;
  const m = await resolveMachine({ qrValue: body.qr_value, selectedId, lockedId, strict: true });
  return { verified: true, machine_id: m.id, machine_code: m.machine_code, machine_name: m.machine_name, tare_weight_kg: m.tare_weight_kg, locked_to_batch: !!lockedId };
}


// QR payload -> machine_master row (null when the QR is not a machine of this system). Tries every reading of the payload: code, token, link, JSON ...
async function machineFromQr(qrValue) {
  for (const ref of extractMachineRefs(qrValue)) {
    try { return await machines.getByToken(ref); } catch (e) { if (!(e instanceof AppError) || e.status === 400) throw e; /* 404: try the next reading */ }
  }
  return null;
}

// Pure-ish: QR decode result + the machine this weighing must use -> machine verdict. Also checked against the database record of the expected machine.
//   expected = { id, machine_code, machine_name } from machine_master (never from what the client sent), or null when no machine is selected
async function machineVerdict(qr, expected) {
  const base = { status: 'NOT_CHECKED', machine: null, qr_value: qr && qr.found ? String(qr.value).slice(0, 255) : null, reason: null };
  if (!qr || !qr.found) return { ...base, status: expected ? 'NOT_READ' : 'NOT_CHECKED', reason: 'QR code not detected on the photo' };
  const m = await machineFromQr(qr.value);
  if (!m) return { ...base, status: expected ? 'MISMATCH' : 'NOT_CHECKED', reason: 'The QR code on the photo is not a machine of this system' };
  const out = { ...base, machine: { id: m.id, machine_code: m.machine_code, machine_name: m.machine_name, machine_type: m.machine_type, status: m.status } };
  if (!expected) return out;                                    // nothing selected yet: machine shown, nothing to compare
  if (Number(m.id) !== Number(expected.id) || String(m.machine_code).toUpperCase() !== String(expected.machine_code).toUpperCase()) {
    return { ...out, status: 'MISMATCH', reason: `QR machine ${m.machine_code} is not the selected machine ${expected.machine_code}` };
  }
  if (m.machine_type && m.machine_type !== 'WEIGHING') return { ...out, status: 'MISMATCH', reason: `${m.machine_code} is not a weighing machine` };
  return { ...out, status: 'MATCH' };
}

const ROW_SQL = `SELECT w.*, uu.full_name AS uploaded_by_name, vu.full_name AS verified_by_name, mm.machine_code, mm.machine_name
  FROM batch_weight_images w JOIN users uu ON uu.id = w.uploaded_by LEFT JOIN users vu ON vu.id = w.verified_by
  LEFT JOIN machine_master mm ON mm.id = w.machine_id`;

// What the app gets: never the server path or the file hash.
const shape = (w) => (w ? {
  id: w.id, batch_id: w.batch_id, material_id: w.material_id, status: w.status,
  machine_id: w.machine_id ?? null, machine_code: w.machine_code || null, machine_name: w.machine_name || null,
  // machine read from the QR code on the photo (machine_id above IS the QR machine). machine_status = verdict made at upload time.
  detected_machine_id: w.machine_id ?? null, detected_machine_code: w.machine_code || null, detected_machine_name: w.machine_name || null,
  machine_status: w.machine_status || null, qr_value: w.qr_value || null,
  entered_weight: Number(w.entered_weight), detected_weight: w.detected_weight === null ? null : Number(w.detected_weight),
  gross_weight: w.detected_weight === null ? null : Number(w.detected_weight), // = detected_weight: what the display shows
  tare_weight: w.tare_weight === null || w.tare_weight === undefined ? null : Number(w.tare_weight),
  net_weight: w.net_weight === null || w.net_weight === undefined ? null : Number(w.net_weight), // gross - tare = the quantity to save
  difference: w.difference === null ? null : Number(w.difference), tolerance: w.tolerance === null ? null : Number(w.tolerance),
  ocr_confidence: w.ocr_confidence, manual_reason: w.manual_reason, verified_by_name: w.verified_by_name_snap || w.verified_by_name || null, verified_at: w.verified_at || null,
  // names the app uses on the screen: machine check (QR) and weight check are two separate verdicts
  qr_status: w.machine_status || null, weight_status: w.status,
  uploaded_by_name: w.uploaded_by_name, created_at: w.created_at,
} : null);

async function loadRow(db, id) {
  const [rows] = await db.query(`${ROW_SQL} WHERE w.id = ?`, [id]);
  if (!rows.length) throw new AppError('Weighing photo not found', 404);
  return rows[0];
}
// row lock (inside a transaction) so two saves can never use the same photo
async function loadRowLocked(conn, id) {
  await conn.query('SELECT id FROM batch_weight_images WHERE id = ? FOR UPDATE', [id]);
  return loadRow(conn, id);
}

/* ---------- 1. photo -> OCR -> compare ---------- */
// batchIdRaw = null  ->  "draft" photo for the New Batch form (the batch does not exist yet; it is attached when the batch is saved)
async function upload(batchIdRaw, file, body, user, ip) {
  const draft = batchIdRaw === null || batchIdRaw === undefined;
  const batchId = draft ? null : v.toId(batchIdRaw, 'batch id');
  const materialId = v.toId(body.material_id, 'material');
  // the manually entered weight is required: it is compared with the weight read from the photo (the photo never fills it in)
  if (body.entered_weight === undefined || body.entered_weight === null || String(body.entered_weight).trim() === '') throw new AppError('Enter the weight first. The photo is checked against the weight you entered');
  const typed = v.positive(body.entered_weight, 'Weighed quantity (kg)', { max: 1000000 });
  if (!file || !file.buffer || !file.buffer.length) throw new AppError('Attach the photo of the weighing machine display');

  let lockedId = null;
  if (draft) {
    const [m] = await pool.query('SELECT is_active, unit FROM materials WHERE id = ?', [materialId]);
    if (!m.length) throw new AppError('Material not found', 404);
    if (!m[0].is_active) throw new AppError('Material is inactive');
    if (!['KG', 'GRAM'].includes(String(m[0].unit).toUpperCase())) throw new AppError('Only KG or GRAM materials can be batched');
  } else {
    const [b] = await pool.query('SELECT batch_no, status, current_stage FROM batch_master WHERE id = ?', [batchId]);
    if (!b.length) throw new AppError('Batch not found', 404);
    if (b[0].status !== 'IN_PROGRESS' || b[0].current_stage !== 'BATCHING') throw new AppError(`Batch ${b[0].batch_no} is not open for batching`);
    const [ing] = await pool.query(
      `SELECT m.material_name FROM batch_master b JOIN recipe_details d ON d.recipe_id = b.recipe_id JOIN materials m ON m.id = d.material_id
       WHERE b.id = ? AND d.material_id = ?`, [batchId, materialId]);
    if (!ing.length) throw new AppError('This material is not part of the batch recipe');
    const [done] = await pool.query('SELECT id FROM batching_details WHERE batch_id = ? AND material_id = ?', [batchId, materialId]);
    if (done.length) throw new AppError(`${ing[0].material_name} is already weighed for this batch`, 409);
    lockedId = MACHINE_QR_ENABLED ? await lockedMachineOf(pool, batchId) : null; // machine lookup only when QR checks are on
  }

  // Machine identification (QR / machine_id / tare) is OFF: nothing about the machine is read from the request or compared.
  const machine = MACHINE_QR_ENABLED ? await resolveMachine({ qrValue: body.qr_value, selectedId: body.machine_id ? v.toId(body.machine_id, 'weighing machine') : null, lockedId }) : null;
  const tareKg = machine && machine.tare_weight_kg ? machine.tare_weight_kg : 0;

  const hash = images.sha256(file.buffer);
  // one photo = one weighing. Re-checking the same photo for the SAME batch + material (after correcting the weight) is fine.
  const [dup] = await pool.query('SELECT id FROM batch_weight_images WHERE image_sha256 = ? AND NOT (batch_id <=> ? AND material_id = ?) LIMIT 1', [hash, batchId, materialId]);
  let reused = dup.length > 0;
  if (!reused) {
    try { const [t] = await pool.query('SELECT id FROM weighing_transactions WHERE image_sha256 = ? LIMIT 1', [hash]); reused = t.length > 0; }
    catch (e) { /* machine QR weighing tables not installed: nothing to compare with */ }
  }
  if (reused) throw new AppError('This photo was already used for another weighing. Take a new photo of the display', 409);

  const jpeg = await images.normalise(file.buffer); // proves it is a real image, strips metadata, caps the size

  // Only the digital display is read (ocr.js finds the lit display, ignores labels / stickers / other numbers). The entered weight is never given to the OCR.
  let expectedRow = null; let mv = null; let qrRes = null;
  const readDisplay = () => ocr.readWeight(jpeg).catch((e) => { console.error('Batch weight OCR failed:', e.message); return { value: null, unit: null, confidence: null, text: null, engine: 'error', reason: /timed out/i.test(e.message) ? 'Reading the photo took too long. Retake a clearer photo of the display' : 'OCR engine error' }; }); // never approve on an error
  let res;
  if (MACHINE_QR_ENABLED) { // legacy: QR (machine) and display (weight) read independently from the same photo
    expectedRow = machine ? await machines.getById(machine.id) : null;
    [qrRes, res] = await Promise.all([
      readQr(file.buffer).catch(() => readQr(jpeg)).catch((e) => { console.error('Batch weight QR read failed:', e.message); return { found: false, value: null, error: true }; }),
      readDisplay(),
    ]);
    mv = await machineVerdict(qrRes, expectedRow);
  } else {
    res = await readDisplay();
  }
  const d = compare(typed, res, config(), tareKg);
  console.log(`Batch weight OCR: batch=${batchId ?? 'new'} material=${materialId} entered=${typed} -> ${d.status} detected=${d.detected ?? '-'} engine=${res.engine || '-'} confidence=${res.confidence ?? '-'} text=${JSON.stringify(res.text || '')}${d.reason ? ` reason=${d.reason}` : ''}`); // one line per photo: why it matched / not
  const entered = typed; // always the manually entered weight (never replaced by the detected one)
  // machine columns stay NULL while machine identification is off
  const photoMachineId = mv && mv.machine ? mv.machine.id : null;

  const rel = await images.save(jpeg);
  try {
    return await withTransaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO batch_weight_images (batch_id, material_id, uploaded_by, entered_weight, detected_weight, difference, tolerance, status,
           detected_text, ocr_confidence, ocr_engine, image_path, image_mime, image_size_bytes, image_sha256, machine_id, tare_weight, net_weight,
           machine_status, qr_value)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'image/jpeg',?,?,?,?,?,?,?)`,
        [batchId, materialId, user.id, entered, d.detected, d.difference, d.tolerance, d.status,
          res.text ? String(res.text).slice(0, 255) : null, res.confidence ?? null, res.engine || null, rel, jpeg.length, hash,
          photoMachineId, d.tare, d.net, mv ? mv.status : null, mv ? mv.qr_value : null]);
      await audit({ userId: user.id, action: 'CREATE', table: 'batch_weight_images', recordId: r.insertId,
        newValues: { batch_id: batchId, material_id: materialId, entered_weight: entered, detected_weight: d.detected, difference: d.difference, tolerance: d.tolerance,
          ocr_confidence: res.confidence ?? null, status: d.status, reason: d.reason, ...(mv ? { qr_machine_id: photoMachineId, machine_status: mv.status, machine_reason: mv.reason } : {}) }, ip }, conn);
      const row = shape(await loadRow(conn, r.insertId));
      const ok = d.status === 'MATCH';
      return { ...row, machine_reason: mv ? mv.reason : null, weight_reason: d.reason, verified: ok, can_submit: ok, retake_required: d.status === 'UNREADABLE',
        message: ok ? 'Weight verified: the photo matches the entered weight.'
          : d.status === 'MISMATCH' ? `Weight MISMATCH: the display shows ${d.detected} kg but the entered weight is ${typed} kg. Correct the entered weight or weigh again and take a new photo.`
          : `The weight could not be read confidently${d.reason ? ` (${d.reason})` : ''}. Please take another photo of the display.` };
    });
  } catch (e) { await images.remove(rel); throw e; }
}

/* ---------- 2. manual verification (disabled) ---------- */
// Disabled: only a MATCH between the entered weight and the photo weight may be saved. Kept so the existing routes answer with a clear message.
async function manualVerify() {
  throw new AppError('Manual verification is not available. Take another clear photo of the display; saving needs a MATCH', 403);
}

/* ---------- 3. used by batchService.addBatching, inside its transaction ---------- */
// Locks the photo row and proves it may be used for this weighing. Throws otherwise, so nothing is saved.
// allowDraft (New Batch): a photo taken before the batch existed (batch_id NULL) is accepted if the same user took it in the last 24 h.
async function claim(conn, { imageId, batchId, materialId, weighedQty = null, userId, machineId = null, allowDraft = false }) {
  const w = await loadRowLocked(conn, v.toId(imageId, 'weight photo'));
  const ownBatch = batchId !== null && batchId !== undefined && w.batch_id === batchId;
  const draftOk = allowDraft && w.batch_id === null;
  if (!(ownBatch || draftOk) || w.material_id !== materialId) throw new AppError('This photo belongs to a different batch or material. Verify the weight again with a new photo', 409);
  if (draftOk) {
    if (w.uploaded_by !== userId) throw new AppError('This photo was taken by another user. Take a new photo', 409);
    const [[a]] = await conn.query('SELECT TIMESTAMPDIFF(HOUR, created_at, NOW()) AS h FROM batch_weight_images WHERE id = ?', [w.id]);
    if (Number(a.h) >= 24) throw new AppError('This photo is older than 24 hours. Take a new photo', 409);
  }
  if (w.batching_detail_id) throw new AppError('This photo is already used for another weighing', 409);
  // machine: the photo must have been taken on the machine this weighing is saved against
  if (MACHINE_QR_ENABLED && machineId) {
    if (w.machine_id && Number(w.machine_id) !== Number(machineId)) throw new AppError('This photo was taken on a different weighing machine than the one used for this batch. Scan the batch machine and take a new photo', 409);
    // QR machine check is enforced here again (the app only gives an early message). Rows made before QR checking (machine_status NULL) keep the old rule above.
    if (w.machine_status && w.machine_status !== 'MATCH') {
      throw new AppError(w.machine_status === 'MISMATCH'
        ? 'Machine MISMATCH: the QR code on the photo is a different machine than the batch machine. Saving is blocked'
        : w.machine_status === 'NOT_CHECKED'
          ? 'The weighing machine was not selected when this photo was checked, so its QR could not be compared. Select the machine and retake the photo'
          : 'The machine QR code was not read from the photo. Retake the photo with the QR sticker in view', 409);
    }
  }
  if (!PASSING.includes(w.status)) {
    throw new AppError(w.status === 'MISMATCH'
      ? `The weight on the machine display (${Number(w.detected_weight).toFixed(3)} kg) does not match the weighed quantity (${Number(w.entered_weight).toFixed(3)} kg). Saving is blocked`
      : 'The weight in the photo could not be read. Take another photo of the weighing machine display', 409);
  }
  // Re-verify on the server from the stored OCR reading and the CURRENT tolerance / confidence (the stored status alone is not trusted)
  {
    const cfg = config();
    const qty = weighedQty !== null && weighedQty !== undefined ? Number(weighedQty) : Number(w.entered_weight);
    const net = w.net_weight !== null && w.net_weight !== undefined ? Number(w.net_weight) : (w.detected_weight === null ? NaN : Number(w.detected_weight));
    const tol = r3(Math.max(cfg.toleranceKg, (qty * cfg.tolerancePct) / 100));
    const lowConf = w.ocr_confidence !== null && w.ocr_confidence !== undefined && Number(w.ocr_confidence) < cfg.minConfidence;
    if (!Number.isFinite(net) || !(qty > 0) || Math.abs(grams(net) - grams(qty)) > grams(tol) || lowConf) {
      throw new AppError('The weight read from the photo does not match the weighed quantity. Verify the weight again with a new photo', 409);
    }
  }
  // weighedQty null = auto-save: the verified NET weight of the photo is the quantity (the caller reads it from w.entered_weight)
  if (weighedQty !== null && weighedQty !== undefined && grams(Number(w.entered_weight)) !== grams(weighedQty)) throw new AppError('The weighed quantity changed after the photo was verified. Verify the weight again', 409);
  return w;
}
async function link(conn, imageId, entryId, batchId = null) {
  await conn.query('UPDATE batch_weight_images SET batching_detail_id = ?, batch_id = COALESCE(batch_id, ?) WHERE id = ?', [entryId, batchId, imageId]);
  // What the MACHINE showed is stored on the batching row in its OWN columns, next to (never instead of) the typed / calculated weighed_qty:
  //   machine_weight_kg  = display reading (OCR)          weight_check_status = MATCH | MANUAL
  //   machine_qr_status  = MATCH (QR on the photo is the selected machine)
  //   manual_*           = who verified an unreadable display by eye, when, and why (only for MANUAL)
  await conn.query(
    `UPDATE batching_details bd JOIN batch_weight_images w ON w.id = ?
        SET bd.machine_weight_kg = w.detected_weight, bd.weight_check_status = w.status, bd.machine_qr_status = w.machine_status,
            bd.manual_reason = IF(w.status = 'MANUAL', w.manual_reason, NULL),
            bd.manual_verified_by = IF(w.status = 'MANUAL', w.verified_by, NULL),
            bd.manual_verified_by_name = IF(w.status = 'MANUAL', w.verified_by_name, NULL),
            bd.manual_verified_at = IF(w.status = 'MANUAL', w.verified_at, NULL)
      WHERE bd.id = ?`, [imageId, entryId]);
}

// material_id -> shaped photo of the saved weighing, for the batching plan (the "View" link on the batch screen)
async function forBatch(db, batchId) {
  try {
    const [rows] = await db.query(`${ROW_SQL} WHERE w.batch_id = ? AND w.batching_detail_id IS NOT NULL ORDER BY w.id`, [batchId]);
    return new Map(rows.map((w) => [w.material_id, shape(w)]));
  } catch (e) { console.warn('Batch weight photos could not be loaded:', e.message); return new Map(); } // never break the batch screen
}

/* ---------- 4. view the photo later ---------- */
async function file(batchIdRaw, imageIdRaw) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const imageId = v.toId(imageIdRaw, 'photo id');
  const [rows] = await pool.query('SELECT image_path, image_mime FROM batch_weight_images WHERE id = ? AND batch_id = ?', [imageId, batchId]);
  if (!rows.length) throw new AppError('Weighing photo not found', 404);
  return { file: images.absolute(rows[0].image_path), mime: rows[0].image_mime || 'image/jpeg' };
}

module.exports = { machineVerdict, machineFromQr, upload, manualVerify, claim, link, forBatch, file, compare, shape, resolveMachine, verifyMachine, lockedMachineOf, config };