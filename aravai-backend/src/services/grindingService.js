const { pool } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function toSqlDate(s) {
  const m = DATE_RE.exec(String(s || '').trim());
  if (!m) throw new AppError('Date must be DD/MM/YYYY');
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (isNaN(d) || d.getUTCDate() !== Number(dd)) throw new AppError('Invalid date');
  return `${yyyy}-${mm}-${dd}`;
}

function toSqlTime(s, label) {
  const t = String(s || '').trim();
  if (!TIME_RE.test(t)) throw new AppError(`${label} must be HH:MM (24h)`);
  return t.length === 4 ? `0${t}:00` : `${t}:00`;
}

function cleanInput(b, userId) {  
  const input_weight = v.num(b.ip_wt, 'I/P weight');
  const output_weight = v.num(b.op_wt, 'O/P weight');
  if (input_weight <= 0) throw new AppError('I/P weight must be greater than 0');
  const sieved = String(b.sieved || 'NO').toUpperCase();
  if (!['YES', 'NO'].includes(sieved)) throw new AppError('Sieved must be Yes or No');

  const batch_id = Number(b.batch_id);
  const machine_id = Number(b.machine_id);
  const operator_id = Number(userId);
  if (!Number.isInteger(batch_id) || batch_id <= 0) throw new AppError('Batch ID is required');
  if (!Number.isInteger(machine_id) || machine_id <= 0) throw new AppError('Machine ID is required');
  if (!Number.isInteger(operator_id) || operator_id <= 0) throw new AppError('Operator ID is required');

  const status = String(b.status || 'IN_PROGRESS').toUpperCase();
  if (!['IN_PROGRESS', 'COMPLETED', 'REJECTED'].includes(status)) throw new AppError('Invalid status');

  const grind_date = toSqlDate(b.date);
  return {
    grind_date,
    batch_id,
    machine_id,
    operator_id,
    status,
    mesh_size: v.reqStr(b.mesh_size, 'Mesh size', 20),
    input_weight,
    output_weight,
    siever: sieved,
    input_time: `${grind_date} ${toSqlTime(b.ip_time, 'I/P time')}`,
    output_time: `${grind_date} ${toSqlTime(b.op_time, 'O/P time')}`,
    wastage_weight: Math.round((input_weight - output_weight) * 1000) / 1000,
    loss_percent: Math.round(((input_weight - output_weight) / input_weight) * 10000) / 100,
    remarks: b.remarks ? String(b.remarks).trim().slice(0, 255) : null,
  };
}

async function create(body, userId, ip) {
 const d = cleanInput(body, userId);
  const [r] = await pool.query(
    `INSERT INTO grinding_details(batch_id, grind_date, machine_id, mesh_size, input_weight, output_weight, siever,
       input_time, output_time, wastage_weight, loss_percent, operator_id, remarks, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.batch_id, d.grind_date, d.machine_id, d.mesh_size, d.input_weight, d.output_weight, d.siever,
      d.input_time, d.output_time, d.wastage_weight, d.loss_percent, d.operator_id, d.remarks, d.status]);
  const [[row]] = await pool.query('SELECT * FROM grinding_details WHERE id = ?', [r.insertId]);
  await audit({ userId, action: 'CREATE', table: 'grinding_details', recordId: r.insertId, newValues: row, ip });
  return row;
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  const search = v.clean(q.search);
  if (search) {
    where.push('remarks LIKE ?');
    args.push(`%${search}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM grinding_details ${w}`, args);
  const [rows] = await pool.query(`SELECT * FROM grinding_details ${w} ORDER BY grind_date DESC, id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}


async function batchOptions() {
  const [rows] = await pool.query(
    `SELECT b.id, b.batch_no, b.product_id, p.product_name
     FROM batch_master b
     JOIN product_master p ON p.id = b.product_id
     WHERE b.status = 'IN_PROGRESS'
     ORDER BY b.id DESC`);
  return rows;
}
async function machineOptions() {
  const [rows] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'GRINDING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_code");
  return rows;
}

module.exports = { create, list, batchOptions, machineOptions };
