const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { FULL_ACCESS } = require('../utils/roles');
const ocr = require('../utils/ocr');
const images = require('../utils/imageStore');

const STATUSES = ['PENDING', 'MACHINE_CONFIRMED', 'WEIGHT_ENTERED', 'IMAGE_UPLOADED', 'VERIFIED', 'MISMATCH', 'UNREADABLE', 'REJECTED'];
const USABLE_MACHINE_STATUS = ['ACTIVE', 'IDLE'];            // same rule batching uses for weighing machines
const RETRY_FROM = ['MISMATCH', 'UNREADABLE'];               // operator may retake the photo / re-run OCR from here
const STUCK_AFTER_MIN = 2;                                   // IMAGE_UPLOADED this long = the server died mid-OCR

const r3 = (n) => Math.round(n * 1000) / 1000;
const grams = (n) => Math.round(n * 1000);
const isAdmin = (u) => FULL_ACCESS.includes(u.role_name);

/* ---------- configuration (.env) ---------- */
function config() {
  const num = (k, d) => { const n = Number(process.env[k] ?? d); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    toleranceKg: num('WEIGHING_TOLERANCE_KG', 0.05),          // allowed |detected - entered|
    tolerancePct: num('WEIGHING_TOLERANCE_PERCENT', 0),       // OR this % of the entered weight; the larger one applies
    minConfidence: num('WEIGHING_OCR_MIN_CONFIDENCE', 60),    // below this the read is UNREADABLE
    maxOcrAttempts: num('WEIGHING_MAX_OCR_ATTEMPTS', 5),      // operators only; admins are not limited
    machineTypes: (process.env.WEIGHING_MACHINE_TYPES || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean), // empty = any type
  };
}

/* ---------- QR: one machine <-> one HMAC-signed value, nothing stored, nothing guessable ---------- */
const QR_RE = /^AMQR1\.(\d{1,10})\.([A-Za-z0-9_-]{22})$/;
function qrSecret() {
  const s = process.env.WEIGHING_QR_SECRET || process.env.JWT_SECRET;
  if (!s) throw new AppError('QR secret is not configured', 500);
  return s;
}
const qrSig = (m) => crypto.createHmac('sha256', qrSecret()).update(`aravai-machine:${m.id}:${m.machine_code}`).digest('base64url').slice(0, 22);
const qrValue = (m) => `AMQR1.${m.id}.${qrSig(m)}`;

const MACHINE_SQL = `SELECT m.id, m.machine_code, m.machine_name, m.machine_type, m.status, m.operator_id, u.full_name AS operator_name
  FROM machine_master m LEFT JOIN users u ON u.id = m.operator_id`;

async function machineByQr(qr, db = pool) {
  const bad = () => new AppError('Invalid code. Scan the barcode / QR printed for the machine');
  let text = String(qr || '').trim();
  // barcode / QR may hold the machine link  <APP_URL>/machine/<machine code or token>  -> use the last part
  const link = /\/(?:machine|m)\/([A-Za-z0-9_-]{3,64})\/?(?:[?#].*)?$/.exec(text);
  if (link) text = link[1];
  // machine code (e.g. MCH005)
  if (/^[A-Za-z0-9_-]{3,30}$/.test(text)) {
    const [byCode] = await db.query(`${MACHINE_SQL} WHERE m.machine_code = ?`, [text]);
    if (byCode.length) return byCode[0];
  }
  // permanent QR token (old printed QR stickers)
  if (/^[A-Za-z0-9_-]{8,64}$/.test(text)) {
    const [byToken] = await db.query(`${MACHINE_SQL} WHERE m.qr_token = ?`, [text]);
    if (byToken.length) return byToken[0];
  }
  const m = QR_RE.exec(text);
  if (!m) throw bad();
  const [rows] = await db.query(`${MACHINE_SQL} WHERE m.id = ?`, [Number(m[1])]);
  if (!rows.length) throw bad();
  const given = Buffer.from(m[2]);
  const want = Buffer.from(qrSig(rows[0]));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw bad();
  return rows[0];
}

// null = the operator may use this machine, otherwise the reason (shown to the user)
function blockReason(m, user) {
  const cfg = config();
  if (!USABLE_MACHINE_STATUS.includes(m.status)) return m.status === 'INACTIVE' ? 'This machine is INACTIVE and cannot be used' : `This machine is ${m.status.replace('_', ' ')} and cannot be used`;
  if (cfg.machineTypes.length && !cfg.machineTypes.includes(m.machine_type)) return `${m.machine_type} machines cannot be used for weighing`;
  if (!m.operator_id) return 'No operator is assigned to this machine';
  if (m.operator_id !== user.id) return `This machine is assigned to ${m.operator_name}, not to you`;
  return null;
}
const publicMachine = (m) => ({ id: m.id, machine_code: m.machine_code, machine_name: m.machine_name, machine_type: m.machine_type, status: m.status, operator_id: m.operator_id, operator_name: m.operator_name });

async function machineQr(idRaw) {
  const id = v.toId(idRaw, 'machine id');
  const [rows] = await pool.query(`${MACHINE_SQL} WHERE m.id = ?`, [id]);
  if (!rows.length) throw new AppError('Machine not found', 404);
  return { ...publicMachine(rows[0]), qr_value: qrValue(rows[0]) };
}

/* ---------- reading transactions ---------- */
const TXN_SQL = `
  SELECT t.*, m.machine_code, m.machine_name, m.machine_type, ou.full_name AS operator_name,
         p.product_code, p.product_name, mt.material_code, mt.material_name, b.batch_no, ru.full_name AS reviewed_by_name
  FROM weighing_transactions t
  JOIN machine_master m ON m.id = t.machine_id
  JOIN users ou ON ou.id = t.operator_id
  LEFT JOIN product_master p ON p.id = t.product_id
  LEFT JOIN materials mt ON mt.id = t.material_id
  LEFT JOIN batch_master b ON b.id = t.batch_id
  LEFT JOIN users ru ON ru.id = t.reviewed_by`;

function shape(t) {
  const { image_path, image_sha256, client_request_id, ...rest } = t; // never expose server paths / hashes
  // display values in the unit the operator typed (KG or G); the *_kg columns stay the source of truth
  const unit = t.entered_unit || 'KG';
  const show = (kg) => (kg === null || kg === undefined ? null : unit === 'G' ? r3(Number(kg) * 1000) : Number(kg));
  return {
    ...rest,
    txn_no: `WT-${String(t.id).padStart(6, '0')}`,
    unit,
    detected_weight: show(t.detected_weight_kg),
    difference: show(t.difference_kg),
    tolerance: show(t.tolerance_kg),
    result: t.status === 'VERIFIED' ? 'MATCH' : t.status === 'MISMATCH' ? 'MISMATCH' : t.status === 'UNREADABLE' ? 'UNREADABLE' : null,
    image_version: t.image_uploaded_at ? new Date(String(t.image_uploaded_at).replace(' ', 'T')).getTime() : 0, // busts the image cache after a retake
    abs_difference_kg: t.difference_kg === null ? null : Math.abs(t.difference_kg),
    item_type: t.product_id ? 'PRODUCT' : t.material_id ? 'MATERIAL' : null,
    item_name: t.product_id ? t.product_name : t.material_id ? t.material_name : null,
    has_image: !!image_path,
    image_url: image_path ? `/api/v1/weighing/transactions/${t.id}/image` : null, // client appends ?token= for <Image>
    is_final: ['VERIFIED', 'REJECTED'].includes(t.status),
    can_retry: RETRY_FROM.includes(t.status),
  };
}

async function loadTxn(db, id, forUpdate = false) {
  const [rows] = await db.query(`${TXN_SQL} WHERE t.id = ? ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw new AppError('Weighing transaction not found', 404);
  return rows[0];
}

async function canReview(user) {
  if (isAdmin(user)) return true;
  const [r] = await pool.query("SELECT can_view AS ok FROM role_permissions WHERE role_id = ? AND module = 'weighing_review'", [user.role_id]);
  return !!(r.length && r[0].ok);
}

async function assertCanSee(t, user) {
  if (t.operator_id === user.id) return;
  if (!(await canReview(user))) throw new AppError('You do not have permission to view this transaction', 403);
}

const parseJson = (x) => { if (x == null) return null; if (typeof x === 'object') return x; try { return JSON.parse(x); } catch { return null; } };

async function getById(idRaw, user) {
  const id = v.toId(idRaw, 'transaction id');
  const t = await loadTxn(pool, id);
  await assertCanSee(t, user);
  const [hist] = await pool.query(
    `SELECT a.id, a.action, a.from_status, a.to_status, a.user_id, u.full_name AS user_name, a.details, a.created_at
     FROM weighing_audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.transaction_id = ? ORDER BY a.id`, [id]);
  return { ...shape(t), history: hist.map((h) => {
    const details = parseJson(h.details);
    return { ...h, details, by_name: h.user_name, at: h.created_at, note: (details && (details.reason || details.detected_text)) || null };
  }) };
}

async function list(q, { onlyUserId = null } = {}) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  const idFilter = (key, col, label) => { if (v.clean(q[key])) { where.push(`${col} = ?`); args.push(v.toId(q[key], label)); } };
  if (onlyUserId) { where.push('t.operator_id = ?'); args.push(onlyUserId); } else idFilter('operator_id', 't.operator_id', 'operator');
  idFilter('machine_id', 't.machine_id', 'machine');
  idFilter('product_id', 't.product_id', 'product');
  idFilter('material_id', 't.material_id', 'material');
  idFilter('batch_id', 't.batch_id', 'batch');
  const batchNo = v.clean(q.batch_no);
  if (batchNo) { where.push('b.batch_no LIKE ?'); args.push(`%${batchNo}%`); }
  if (v.clean(q.date_from)) { where.push('t.created_at >= ?'); args.push(`${v.date(q.date_from, 'From date')} 00:00:00`); }
  if (v.clean(q.date_to)) { where.push('t.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); args.push(v.date(q.date_to, 'To date')); }
  if (v.clean(q.date_from) && v.clean(q.date_to) && q.date_from > q.date_to) throw new AppError('From date cannot be after To date');
  const base = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const wh = [...where];
  const wa = [...args];
  if (v.clean(q.status)) {
    const s = String(q.status).toUpperCase();
    if (!STATUSES.includes(s)) throw new AppError('Invalid status');
    wh.push('t.status = ?'); wa.push(s);
  }
  const w = wh.length ? `WHERE ${wh.join(' AND ')}` : '';
  const FROM = `FROM weighing_transactions t JOIN machine_master m ON m.id = t.machine_id LEFT JOIN batch_master b ON b.id = t.batch_id`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} ${w}`, wa);
  const [rows] = await pool.query(`${TXN_SQL} ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...wa, limit, offset]);
  // counts per status for the other filters (so the dashboard chips stay useful while a status filter is on)
  const [counts] = await pool.query(`SELECT t.status, COUNT(*) AS n ${FROM} ${base} GROUP BY t.status`, args);
  const summary = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  counts.forEach((c) => { summary[c.status] = Number(c.n); });
  return { items: rows.map(shape), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1), summary };
}

// dropdown data for the weighing screen / review filters (operators do not need Product / Material permissions)
async function options() {
  const [products] = await pool.query('SELECT id, product_code, product_name FROM product_master WHERE is_active = 1 ORDER BY product_name');
  const [materials] = await pool.query('SELECT id, material_code, material_name, unit FROM materials WHERE is_active = 1 ORDER BY material_name');
  const [batches] = await pool.query(
    `SELECT b.id, b.batch_no, b.production_date, p.product_name FROM batch_master b JOIN product_master p ON p.id = b.product_id
     WHERE b.status = 'IN_PROGRESS' ORDER BY b.id DESC LIMIT 200`);
  return { products, materials, batches, units: ['KG', 'G'], tolerance_kg: config().toleranceKg };
}

/* ---------- history ---------- */
async function history(conn, txnId, userId, action, from, to, details) {
  await conn.query(
    'INSERT INTO weighing_audit (transaction_id, action, from_status, to_status, user_id, details) VALUES (?,?,?,?,?,?)',
    [txnId, action, from, to, userId || null, details ? JSON.stringify(details) : null]);
}
const log = (userId, ip, id, action, oldValues, newValues, conn) =>
  audit({ userId, action, table: 'weighing_transactions', recordId: id, oldValues, newValues, ip }, conn);

/* ---------- 1. scan ---------- */
async function scan(body, user) {
  const m = await machineByQr(body.qr_value ?? body.qr ?? body.code);
  const reason = blockReason(m, user);
  return { machine: publicMachine(m), can_proceed: reason === null, block_reason: reason };
}

/* ---------- 2. "Is this your machine?" -> Yes ---------- */
async function confirmMachine(body, user, ip) {
  const crid = v.clean(body.client_request_id);
  if (!crid || !/^[A-Za-z0-9_-]{8,64}$/.test(crid)) throw new AppError('client_request_id is required (8-64 letters, digits, - or _)');
  if (body.confirmed !== undefined && !v.toBool(body.confirmed, 'confirmed')) throw new AppError('Confirm that this is your machine to continue');
  const m = await machineByQr(body.qr_value ?? body.qr);
  const reason = blockReason(m, user);
  if (reason) throw new AppError(reason, 403);

  const existing = async () => {
    const [r] = await pool.query('SELECT id FROM weighing_transactions WHERE operator_id = ? AND client_request_id = ?', [user.id, crid]);
    return r.length ? r[0].id : null;
  };
  const replay = async (id) => ({ ...shape(await loadTxn(pool, id)), duplicate_request: true });

  const prior = await existing();
  if (prior) return replay(prior);
  try {
    return await withTransaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO weighing_transactions (client_request_id, machine_id, operator_id, status, confirmed_at) VALUES (?,?,?,'MACHINE_CONFIRMED',NOW())`,
        [crid, m.id, user.id]);
      await history(conn, r.insertId, user.id, 'MACHINE_CONFIRMED', 'PENDING', 'MACHINE_CONFIRMED', { machine_id: m.id, machine_code: m.machine_code });
      await log(user.id, ip, r.insertId, 'CREATE', null, { machine_id: m.id, status: 'MACHINE_CONFIRMED' }, conn);
      return shape(await loadTxn(conn, r.insertId));
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') { const id = await existing(); if (id) return replay(id); } // double tap racing the first insert
    throw e;
  }
}

function ownTxn(t, user) {
  if (t.operator_id !== user.id) throw new AppError('This weighing transaction belongs to another operator', 403);
}
async function assertMachineStillUsable(db, t, user) {
  const [rows] = await db.query(`${MACHINE_SQL} WHERE m.id = ?`, [t.machine_id]);
  const reason = rows.length ? blockReason(rows[0], user) : 'Machine not found';
  if (reason) throw new AppError(reason, 403);
}

/* ---------- 3. product / material, batch, weight (saved once, then locked) ---------- */
async function enterWeight(idRaw, body, user, ip) {
  const id = v.toId(idRaw, 'transaction id');
  const unit = String(body.unit || 'KG').toUpperCase();
  if (!['KG', 'G'].includes(unit)) throw new AppError('Unit must be KG or G');
  const entered = v.positive(body.weight ?? body.entered_weight, 'Weight', { max: unit === 'KG' ? 100000 : 100000000, decimals: 3 });
  const kg = r3(unit === 'KG' ? entered : entered / 1000);
  if (kg < 0.001) throw new AppError('Weight is too small');
  const hasP = v.clean(body.product_id); const hasM = v.clean(body.material_id);
  if (!hasP && !hasM) throw new AppError('Select the product or material');
  if (hasP && hasM) throw new AppError('Select either a product or a material, not both');
  const productId = hasP ? v.toId(body.product_id, 'product') : null;
  const materialId = hasM ? v.toId(body.material_id, 'material') : null;
  const batchId = v.clean(body.batch_id) ? v.toId(body.batch_id, 'batch') : null;

  return withTransaction(async (conn) => {
    const t = await loadTxn(conn, id, true);
    ownTxn(t, user);
    if (t.status !== 'MACHINE_CONFIRMED') {
      throw new AppError(t.status === 'PENDING' ? 'Confirm the machine first' : t.status === 'REJECTED' ? 'This transaction was rejected' : 'The weight is already saved and cannot be changed', 409);
    }
    await assertMachineStillUsable(conn, t, user);
    if (productId) {
      const [p] = await conn.query('SELECT is_active FROM product_master WHERE id = ?', [productId]);
      if (!p.length) throw new AppError('Product not found', 404);
      if (!p[0].is_active) throw new AppError('Product is inactive');
    }
    if (materialId) {
      const [mt] = await conn.query('SELECT is_active FROM materials WHERE id = ?', [materialId]);
      if (!mt.length) throw new AppError('Material not found', 404);
      if (!mt[0].is_active) throw new AppError('Material is inactive');
    }
    if (batchId) {
      const [b] = await conn.query('SELECT status, batch_no FROM batch_master WHERE id = ?', [batchId]);
      if (!b.length) throw new AppError('Batch not found', 404);
      if (b[0].status !== 'IN_PROGRESS') throw new AppError(`Batch ${b[0].batch_no} is not in progress`);
    }
    await conn.query(
      `UPDATE weighing_transactions SET product_id = ?, material_id = ?, batch_id = ?, entered_weight = ?, entered_unit = ?, entered_weight_kg = ?,
         status = 'WEIGHT_ENTERED', weight_entered_at = NOW() WHERE id = ?`, [productId, materialId, batchId, entered, unit, kg, id]);
    const d = { product_id: productId, material_id: materialId, batch_id: batchId, entered_weight: entered, unit, entered_weight_kg: kg };
    await history(conn, id, user.id, 'WEIGHT_ENTERED', t.status, 'WEIGHT_ENTERED', d);
    await log(user.id, ip, id, 'UPDATE', { status: t.status }, { status: 'WEIGHT_ENTERED', ...d }, conn);
    return shape(await loadTxn(conn, id));
  });
}

/* ---------- 4/5. photo upload + OCR comparison ---------- */
function decide(t, ocrRes, cfg) {
  const enteredKg = Number(t.entered_weight_kg);
  const tol = r3(Math.max(cfg.toleranceKg, (enteredKg * cfg.tolerancePct) / 100));
  const base = { tolerance_kg: tol, ocr_engine: ocrRes.engine, ocr_confidence: ocrRes.confidence, detected_text: ocrRes.text };
  const lowConf = ocrRes.confidence !== null && ocrRes.confidence < cfg.minConfidence;
  if (ocrRes.value === null || ocrRes.value === undefined || lowConf) {
    return { ...base, status: 'UNREADABLE', detected_weight_kg: null, difference_kg: null, reason: lowConf ? `OCR confidence ${ocrRes.confidence} is below ${cfg.minConfidence}` : ocrRes.reason };
  }
  // a display without a unit is read in the unit the operator entered
  const unit = ocrRes.unit ? ocrRes.unit.toUpperCase() : t.entered_unit;
  const detectedKg = r3(unit === 'G' ? ocrRes.value / 1000 : ocrRes.value);
  const diff = r3(detectedKg - enteredKg);
  const ok = Math.abs(grams(detectedKg) - grams(enteredKg)) <= grams(tol);
  return { ...base, status: ok ? 'VERIFIED' : 'MISMATCH', detected_weight_kg: detectedKg, difference_kg: diff, reason: null };
}

// Runs OCR on `buffer` and records the outcome. Called only while the row is IMAGE_UPLOADED with `imagePath`,
// which is what makes concurrent uploads / re-runs on one transaction safe.
async function finishVerification(id, imagePath, buffer, user, ip, action) {
  const cfg = config();
  let res;
  try { res = await ocr.readWeight(buffer); }
  catch (e) {
    console.error('OCR failed:', e.message);
    res = { value: null, unit: null, confidence: null, text: null, engine: 'error', reason: 'OCR engine error' }; // never leave it hanging, never approve it
  }
  return withTransaction(async (conn) => {
    const t = await loadTxn(conn, id, true);
    if (t.status !== 'IMAGE_UPLOADED' || !(await sameImage(conn, id, imagePath))) throw new AppError('This transaction changed while the image was being checked. Refresh and try again', 409);
    const d = decide(t, res, cfg);
    await conn.query(
      `UPDATE weighing_transactions SET status = ?, detected_weight_kg = ?, difference_kg = ?, tolerance_kg = ?, detected_text = ?, ocr_confidence = ?, ocr_engine = ?,
         ocr_attempts = ocr_attempts + 1, verification_method = ?, verified_at = ? WHERE id = ?`,
      [d.status, d.detected_weight_kg, d.difference_kg, d.tolerance_kg, d.detected_text, d.ocr_confidence, d.ocr_engine,
        d.status === 'VERIFIED' ? 'OCR' : null, d.status === 'VERIFIED' ? new Date() : null, id]);
    const det = { entered_weight_kg: Number(t.entered_weight_kg), detected_weight_kg: d.detected_weight_kg, difference_kg: d.difference_kg,
      tolerance_kg: d.tolerance_kg, confidence: d.ocr_confidence, engine: d.ocr_engine, detected_text: d.detected_text, reason: d.reason, attempt: t.ocr_attempts + 1, trigger: action };
    await history(conn, id, user.id, 'OCR_RESULT', 'IMAGE_UPLOADED', d.status, det);
    await log(user.id, ip, id, 'STATUS_CHANGE', { status: 'IMAGE_UPLOADED' }, { status: d.status, ...det }, conn);
    return shape(await loadTxn(conn, id));
  });
}
async function sameImage(conn, id, imagePath) {
  const [r] = await conn.query('SELECT image_path FROM weighing_transactions WHERE id = ?', [id]);
  return r.length && r[0].image_path === imagePath;
}

function assertAttemptsLeft(t, user, cfg) {
  if (!isAdmin(user) && t.ocr_attempts >= cfg.maxOcrAttempts) throw new AppError(`Verification was attempted ${t.ocr_attempts} times. Ask an admin to review this weighing`, 409);
}

async function uploadImage(idRaw, file, user, ip) {
  const id = v.toId(idRaw, 'transaction id');
  if (!file || !file.buffer || !file.buffer.length) throw new AppError('Attach the photo of the weighing machine display');
  const cfg = config();
  const original = file.buffer;
  const hash = images.sha256(original);
  const jpeg = await images.normalise(original);
  const rel = await images.save(jpeg);
  try {
    await withTransaction(async (conn) => {
      const t = await loadTxn(conn, id, true);
      ownTxn(t, user);
      if (t.status === 'MACHINE_CONFIRMED' || t.status === 'PENDING') throw new AppError('Enter the weight before uploading the photo', 409);
      if (t.status === 'VERIFIED') throw new AppError('This weighing is already verified', 409);
      if (t.status === 'REJECTED') throw new AppError('This transaction was rejected', 409);
      if (t.status === 'IMAGE_UPLOADED') throw new AppError('The image is already being verified. Wait a moment and refresh', 409);
      assertAttemptsLeft(t, user, cfg);
      await assertMachineStillUsable(conn, t, user);
      const [dup] = await conn.query('SELECT id FROM weighing_transactions WHERE image_sha256 = ? AND id <> ? LIMIT 1', [hash, id]);
      if (dup.length) throw new AppError('This photo was already used for another weighing. Take a new photo of the display', 409);
      await conn.query(
        `UPDATE weighing_transactions SET status = 'IMAGE_UPLOADED', image_path = ?, image_mime = 'image/jpeg', image_size_bytes = ?, image_sha256 = ?,
           image_uploaded_at = NOW(), detected_weight_kg = NULL, difference_kg = NULL, detected_text = NULL, ocr_confidence = NULL WHERE id = ?`,
        [rel, jpeg.length, hash, id]);
      await history(conn, id, user.id, 'IMAGE_UPLOADED', t.status, 'IMAGE_UPLOADED', { size_bytes: jpeg.length, sha256: hash, retake: t.status !== 'WEIGHT_ENTERED', previous_image: t.image_path || null });
      await log(user.id, ip, id, 'UPDATE', { status: t.status }, { status: 'IMAGE_UPLOADED' }, conn);
    });
  } catch (e) { await images.remove(rel); throw e; } // the photo was never attached to the transaction
  return finishVerification(id, rel, jpeg, user, ip, 'UPLOAD');
}

// Re-run OCR on the image already stored (no new photo). The entered weight stays as it was.
async function rerunOcr(idRaw, user, ip) {
  const id = v.toId(idRaw, 'transaction id');
  const cfg = config();
  const imagePath = await withTransaction(async (conn) => {
    const t = await loadTxn(conn, id, true);
    if (t.operator_id !== user.id && !isAdmin(user)) throw new AppError('This weighing transaction belongs to another operator', 403);
    const stuck = t.status === 'IMAGE_UPLOADED' && (Date.now() - new Date(String(t.updated_at).replace(' ', 'T')).getTime()) > STUCK_AFTER_MIN * 60000;
    if (!RETRY_FROM.includes(t.status) && !stuck) throw new AppError(`OCR can only be re-run for MISMATCH or UNREADABLE (this one is ${t.status})`, 409);
    if (!t.image_path) throw new AppError('There is no image to verify', 409);
    assertAttemptsLeft(t, user, cfg);
    await conn.query("UPDATE weighing_transactions SET status = 'IMAGE_UPLOADED' WHERE id = ?", [id]);
    await history(conn, id, user.id, 'OCR_RERUN', t.status, 'IMAGE_UPLOADED', { requested_by_admin: isAdmin(user) && t.operator_id !== user.id });
    await log(user.id, ip, id, 'UPDATE', { status: t.status }, { status: 'IMAGE_UPLOADED', action: 'OCR_RERUN' }, conn);
    return t.image_path;
  });
  let buf;
  try { buf = await images.read(imagePath); }
  catch (e) { buf = Buffer.alloc(0); }
  if (!buf.length) { // file is gone: do not leave the transaction stuck, and do not approve it
    return withTransaction(async (conn) => {
      const t = await loadTxn(conn, id, true);
      await conn.query("UPDATE weighing_transactions SET status = 'UNREADABLE', detected_text = 'Image file missing', ocr_attempts = ocr_attempts + 1 WHERE id = ?", [id]);
      await history(conn, id, user.id, 'OCR_RESULT', t.status, 'UNREADABLE', { reason: 'Image file missing on server' });
      return shape(await loadTxn(conn, id));
    });
  }
  return finishVerification(id, imagePath, buf, user, ip, 'RERUN');
}

/* ---------- 6. admin: manual verify / reject (reason mandatory, always audited) ---------- */
async function manualVerify(idRaw, body, user, ip) {
  const id = v.toId(idRaw, 'transaction id');
  const reason = v.reqStr(body.reason, 'Reason', 255);
  if (reason.length < 5) throw new AppError('Give a proper reason (at least 5 characters)');
  return withTransaction(async (conn) => {
    const t = await loadTxn(conn, id, true);
    if (!RETRY_FROM.includes(t.status)) throw new AppError(`Only MISMATCH or UNREADABLE weighings can be verified manually (this one is ${t.status})`, 409);
    if (!t.image_path) throw new AppError('There is no uploaded image to verify against', 409);
    await conn.query(
      `UPDATE weighing_transactions SET status = 'VERIFIED', verification_method = 'MANUAL', verified_at = NOW(), reviewed_by = ?, reviewed_at = NOW(), review_reason = ? WHERE id = ?`,
      [user.id, reason, id]);
    const d = { reason, entered_weight_kg: Number(t.entered_weight_kg), detected_weight_kg: t.detected_weight_kg, difference_kg: t.difference_kg, previous_status: t.status };
    await history(conn, id, user.id, 'MANUAL_VERIFY', t.status, 'VERIFIED', d);
    await log(user.id, ip, id, 'STATUS_CHANGE', { status: t.status }, { status: 'VERIFIED', method: 'MANUAL', ...d }, conn);
    return shape(await loadTxn(conn, id));
  });
}

async function reject(idRaw, body, user, ip) {
  const id = v.toId(idRaw, 'transaction id');
  const reason = v.reqStr(body.reason, 'Reason', 255);
  if (reason.length < 5) throw new AppError('Give a proper reason (at least 5 characters)');
  return withTransaction(async (conn) => {
    const t = await loadTxn(conn, id, true);
    if (t.status === 'REJECTED') throw new AppError('Already rejected', 409);
    await conn.query("UPDATE weighing_transactions SET status = 'REJECTED', reviewed_by = ?, reviewed_at = NOW(), review_reason = ? WHERE id = ?", [user.id, reason, id]);
    await history(conn, id, user.id, 'REJECT', t.status, 'REJECTED', { reason, previous_status: t.status });
    await log(user.id, ip, id, 'STATUS_CHANGE', { status: t.status }, { status: 'REJECTED', reason }, conn);
    return shape(await loadTxn(conn, id));
  });
}

/* ---------- image download ---------- */
async function imageFile(idRaw, user) {
  const id = v.toId(idRaw, 'transaction id');
  const [rows] = await pool.query('SELECT operator_id, image_path, image_mime FROM weighing_transactions WHERE id = ?', [id]);
  if (!rows.length) throw new AppError('Weighing transaction not found', 404);
  const t = rows[0];
  await assertCanSee(t, user);
  if (!t.image_path) throw new AppError('No image uploaded for this transaction', 404);
  return { file: images.absolute(t.image_path), mime: t.image_mime || 'image/jpeg' };
}

module.exports = { STATUSES, machineQr, scan, confirmMachine, enterWeight, uploadImage, rerunOcr, manualVerify, reject, getById, list, options, imageFile, decide, qrValue, machineByQr };