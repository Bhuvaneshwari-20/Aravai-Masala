// Shared by blendingService and packingService.
const AppError = require('./AppError');
const v = require('./validate');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, '0');

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

// 'YYYY-MM-DD' that really exists (rejects 2026-02-31)
function reqDate(val, label) {
  const s = v.clean(val);
  if (!s || !DATE_RE.test(s)) throw new AppError(`${label} must be a valid date (YYYY-MM-DD)`);
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) throw new AppError(`${label} is not a real date`);
  return s;
}

function reqTime(val, label) {
  const s = v.clean(val);
  if (!s || !TIME_RE.test(s)) throw new AppError(`${label} must be a valid time (HH:mm, 24 hour)`);
  return s;
}

// whole number >= 0 (empty -> 0)
function wholeNum(val, label, { max = 1000000 } = {}) {
  const n = v.num(val, label, { max, decimals: 0 });
  if (!Number.isInteger(n)) throw new AppError(`${label} must be a whole number`);
  return n;
}

// 'YYYY-MM-DD' + 'HH:mm' (+ minutes) -> 'YYYY-MM-DD HH:mm:00' for a DATETIME column
function dateTimeStr(date, time, addMinutes = 0) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm + addMinutes, 0);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
}

// Lock the batch row and make sure it is at the expected stage.
async function lockBatch(conn, batchId, stage) {
  const [rows] = await conn.query('SELECT * FROM batch_master WHERE id = ? FOR UPDATE', [batchId]);
  if (!rows.length) throw new AppError('Batch not found', 404);
  const b = rows[0];
  if (['COMPLETED', 'CANCELLED'].includes(b.status)) throw new AppError(`Batch ${b.batch_no} is already ${b.status.toLowerCase()}`, 409);
  if (b.current_stage !== stage) {
    throw new AppError(`Batch ${b.batch_no} is at the ${b.current_stage} stage. ${stage} can only be entered for batches at the ${stage} stage`, 409);
  }
  return b;
}

async function checkMachine(conn, machineId, type) {
  const [rows] = await conn.query('SELECT id, machine_name, machine_type, status FROM machine_master WHERE id = ?', [machineId]);
  if (!rows.length) throw new AppError('Selected machine does not exist');
  const m = rows[0];
  if (m.machine_type !== type) throw new AppError(`${m.machine_name} is not a ${type.toLowerCase()} machine`);
  if (!['ACTIVE', 'IDLE'].includes(m.status)) throw new AppError(`${m.machine_name} is ${m.status.replace('_', ' ').toLowerCase()} and cannot be used`);
  return m;
}

async function checkUsers(conn, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const [rows] = await conn.query('SELECT id FROM users WHERE id IN (?) AND is_active = 1', [uniq]);
  if (rows.length !== uniq.length) throw new AppError('Done by / Checked by must be active users');
}

// Reduce raw-material stock and write the ledger row (Material Stock Card). Returns the ledger row id.
// Weights on the forms are in kg, so only KG / GRAM stocked materials can be issued here.
async function issueRawMaterial(conn, { materialId, weightKg, date, batch, userId, purpose }) {
  const [rows] = await conn.query(
    'SELECT id, material_name, unit, current_stock, is_active FROM materials WHERE id = ? FOR UPDATE', [materialId]);
  if (!rows.length) throw new AppError('Material not found', 404);
  const m = rows[0];
  if (!m.is_active) throw new AppError(`${m.material_name} is inactive`);
  const factor = m.unit === 'KG' ? 1 : m.unit === 'GRAM' ? 1000 : null;
  if (!factor) throw new AppError(`${m.material_name} is stocked in ${m.unit}, so it cannot be issued by weight (kg)`);
  const qty = r3(weightKg * factor);
  const opening = Number(m.current_stock);
  if (qty > opening) throw new AppError(`Not enough stock for ${m.material_name}: available ${opening} ${m.unit}, needed ${qty} ${m.unit}`);
  const closing = r3(opening - qty);
  const [t] = await conn.query(
    `INSERT INTO material_stock_transactions (material_id, txn_date, txn_type, opening_stock, inward_qty, total_qty,
       despatch_qty, closing_stock, purpose, reference_type, reference_no, batch_id, entered_by)
     VALUES (?,?,'ISSUE',?,0,?,?,?,?,'BATCH',?,?,?)`,
    [m.id, date, opening, opening, qty, closing, purpose, batch.batch_no, batch.id, userId]);
  await conn.query('UPDATE materials SET current_stock = ? WHERE id = ?', [closing, m.id]);
  return t.insertId;
}

module.exports = { r2, r3, reqDate, reqTime, wholeNum, dateTimeStr, lockBatch, checkMachine, checkUsers, issueRawMaterial };