// Batching: photo of the weighing machine display -> OCR -> compared with the weighed quantity typed in the batching screen.
//   MATCH       weights are the same                                  -> weighing can be saved
//   MANUAL      OCR could not read it, a supervisor verified by eye   -> weighing can be saved
//   MISMATCH    weights differ                                       -> saving is blocked
//   UNREADABLE  image unclear / OCR found no weight                  -> manual verification (or a better photo)
// The photo is stored against the batch + material (batching_detail_id is filled when the weighing is saved).
// Uses the same OCR engine, image store and tolerance settings (.env WEIGHING_*) as the machine QR weighing module.
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { audit } = require('../utils/audit');
const ocr = require('../utils/ocr');
const images = require('../utils/imageStore');

const r3 = (n) => Math.round(n * 1000) / 1000;
const grams = (n) => Math.round(n * 1000);
const PASSING = ['MATCH', 'MANUAL'];

function config() {
  const num = (k, d) => { const n = Number(process.env[k] ?? d); return Number.isFinite(n) && n >= 0 ? n : d; };
  return { toleranceKg: num('WEIGHING_TOLERANCE_KG', 0.05), tolerancePct: num('WEIGHING_TOLERANCE_PERCENT', 0), minConfidence: num('WEIGHING_OCR_MIN_CONFIDENCE', 60) };
}

// Pure: OCR answer + entered KG -> verdict. The entered weight is only compared, never given to the OCR.
function compare(enteredKg, res, cfg) {
  const tol = r3(Math.max(cfg.toleranceKg, (enteredKg * cfg.tolerancePct) / 100));
  const lowConf = res.confidence !== null && res.confidence !== undefined && res.confidence < cfg.minConfidence;
  if (res.value === null || res.value === undefined || lowConf) {
    return { status: 'UNREADABLE', detected: null, difference: null, tolerance: tol, reason: lowConf ? `OCR confidence ${res.confidence} is below ${cfg.minConfidence}` : res.reason };
  }
  const detected = r3(String(res.unit || '').toLowerCase() === 'g' ? res.value / 1000 : res.value); // no unit on the display = kg (batching is in kg)
  const ok = Math.abs(grams(detected) - grams(enteredKg)) <= grams(tol);
  return { status: ok ? 'MATCH' : 'MISMATCH', detected, difference: r3(detected - enteredKg), tolerance: tol, reason: null };
}

const ROW_SQL = `SELECT w.*, uu.full_name AS uploaded_by_name, vu.full_name AS verified_by_name
  FROM batch_weight_images w JOIN users uu ON uu.id = w.uploaded_by LEFT JOIN users vu ON vu.id = w.verified_by`;

// What the app gets: never the server path or the file hash.
const shape = (w) => (w ? {
  id: w.id, batch_id: w.batch_id, material_id: w.material_id, status: w.status,
  entered_weight: Number(w.entered_weight), detected_weight: w.detected_weight === null ? null : Number(w.detected_weight),
  difference: w.difference === null ? null : Number(w.difference), tolerance: w.tolerance === null ? null : Number(w.tolerance),
  ocr_confidence: w.ocr_confidence, manual_reason: w.manual_reason, verified_by_name: w.verified_by_name || null,
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
  const entered = v.positive(body.entered_weight, 'Weighed quantity (kg)', { max: 1000000 });
  if (!file || !file.buffer || !file.buffer.length) throw new AppError('Attach the photo of the weighing machine display');

  if (draft) {
    const [m] = await pool.query('SELECT is_active, unit FROM materials WHERE id = ?', [materialId]);
    if (!m.length) throw new AppError('Material not found', 404);
    if (!m[0].is_active) throw new AppError('Material is inactive');
    if (m[0].unit !== 'KG') throw new AppError(`Only KG materials can be batched`);
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
  }

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
  let res;
  try { res = await ocr.readWeight(jpeg); }
  catch (e) { console.error('Batch weight OCR failed:', e.message); res = { value: null, unit: null, confidence: null, text: null, engine: 'error', reason: 'OCR engine error' }; } // never approve on an error
  const d = compare(entered, res, config());

  const rel = await images.save(jpeg);
  try {
    return await withTransaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO batch_weight_images (batch_id, material_id, uploaded_by, entered_weight, detected_weight, difference, tolerance, status,
           detected_text, ocr_confidence, ocr_engine, image_path, image_mime, image_size_bytes, image_sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'image/jpeg',?,?)`,
        [batchId, materialId, user.id, entered, d.detected, d.difference, d.tolerance, d.status,
          res.text ? String(res.text).slice(0, 255) : null, res.confidence ?? null, res.engine || null, rel, jpeg.length, hash]);
      await audit({ userId: user.id, action: 'CREATE', table: 'batch_weight_images', recordId: r.insertId,
        newValues: { batch_id: batchId, material_id: materialId, entered_weight: entered, detected_weight: d.detected, status: d.status, reason: d.reason }, ip }, conn);
      return shape(await loadRow(conn, r.insertId));
    });
  } catch (e) { await images.remove(rel); throw e; }
}

/* ---------- 2. supervisor verifies an UNREADABLE photo by eye (reason mandatory, audited) ---------- */
async function manualVerify(batchIdRaw, imageIdRaw, body, user, ip) {
  const batchId = batchIdRaw === null || batchIdRaw === undefined ? null : v.toId(batchIdRaw, 'batch id'); // null = New Batch draft photo
  const imageId = v.toId(imageIdRaw, 'photo id');
  const reason = v.reqStr(body.reason, 'Reason', 255);
  if (reason.length < 5) throw new AppError('Give a proper reason (at least 5 characters)');
  return withTransaction(async (conn) => {
    const w = await loadRowLocked(conn, imageId);
    if ((w.batch_id ?? null) !== batchId) throw new AppError('Weighing photo not found', 404);
    if (w.batching_detail_id) throw new AppError('This photo is already used for a saved weighing', 409);
    if (w.status !== 'UNREADABLE') throw new AppError(`Only an UNREADABLE photo can be verified manually (this one is ${w.status}). A MISMATCH must be fixed by weighing again`, 409);
    await conn.query("UPDATE batch_weight_images SET status = 'MANUAL', manual_reason = ?, verified_by = ?, verified_at = NOW() WHERE id = ?", [reason, user.id, imageId]);
    await audit({ userId: user.id, action: 'STATUS_CHANGE', table: 'batch_weight_images', recordId: imageId,
      oldValues: { status: 'UNREADABLE' }, newValues: { status: 'MANUAL', reason, entered_weight: Number(w.entered_weight) }, ip }, conn);
    return shape(await loadRow(conn, imageId));
  });
}

/* ---------- 3. used by batchService.addBatching, inside its transaction ---------- */
// Locks the photo row and proves it may be used for this weighing. Throws otherwise, so nothing is saved.
// allowDraft (New Batch): a photo taken before the batch existed (batch_id NULL) is accepted if the same user took it in the last 24 h.
async function claim(conn, { imageId, batchId, materialId, weighedQty, userId, allowDraft = false }) {
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
  if (!PASSING.includes(w.status)) {
    throw new AppError(w.status === 'MISMATCH'
      ? `The weight on the machine display (${Number(w.detected_weight).toFixed(3)} kg) does not match the weighed quantity (${Number(w.entered_weight).toFixed(3)} kg). Saving is blocked`
      : 'The weight in the photo could not be read. Retake the photo or ask a supervisor to verify it manually', 409);
  }
  if (grams(Number(w.entered_weight)) !== grams(weighedQty)) throw new AppError('The weighed quantity changed after the photo was verified. Verify the weight again', 409);
  return w;
}
async function link(conn, imageId, entryId, batchId = null) {
  await conn.query('UPDATE batch_weight_images SET batching_detail_id = ?, batch_id = COALESCE(batch_id, ?) WHERE id = ?', [entryId, batchId, imageId]);
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

module.exports = { upload, manualVerify, claim, link, forBatch, file, compare, shape };
