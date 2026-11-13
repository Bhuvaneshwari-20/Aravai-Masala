const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const v = require('../utils/validate');

// Loss % above this is flagged as an alert (set ROASTING_LOSS_ALERT_PERCENT in .env to change)
const LOSS_ALERT = Number(process.env.ROASTING_LOSS_ALERT_PERCENT) || 12;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['IN_PROGRESS', 'COMPLETED', 'REJECTED'];
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

const SELECT = `
  SELECT r.id, r.roast_date, r.machine_id, m.machine_code, m.machine_name, r.code_no,
         r.input_weight, r.output_weight, r.temp_before, r.std_temp, r.temp_after,
         r.start_time, r.end_time, r.running_hours, r.wastage_weight, r.loss_percent,
         r.status, r.remarks, r.operator_id, op.full_name AS operator_name,
         r.incharge_id, inc.full_name AS incharge_name
    FROM roasting_details r
    JOIN machine_master m ON m.id = r.machine_id
    JOIN users op ON op.id = r.operator_id
    LEFT JOIN users inc ON inc.id = r.incharge_id`;

const withAlert = (row) => ({ ...row, loss_alert: row.loss_percent !== null && row.loss_percent > LOSS_ALERT });

// Validates the form and works out Running Hours, Wastage and Loss % (the system calculates them, not the operator)
async function clean(body, oldCode = null) {
  const roast_date = v.reqStr(body.roast_date, 'Date', 10);
  if (!DATE_RE.test(roast_date) || Number.isNaN(Date.parse(roast_date))) throw new AppError('Date must be in YYYY-MM-DD format');

  const machine_id = v.toId(body.machine_id, 'machine');
  const [[m]] = await pool.query("SELECT id FROM machine_master WHERE id = ? AND machine_type = 'ROASTING'", [machine_id]);
  if (!m) throw new AppError('Select a valid roasting machine');

  const code_no = v.reqStr(body.code_no, 'Code no', 30).toUpperCase();
  // Code no = a recipe code (RCP001 ...). Old free-text entries can still be saved unchanged.
  if (code_no !== oldCode) {
    const [[rc]] = await pool.query('SELECT id FROM recipe_master WHERE recipe_no = ? AND is_active = 1', [code_no]);
    if (!rc) throw new AppError('Select a valid recipe code');
  }

  const input = v.num(body.input_weight, 'I/P weight');
  if (input <= 0) throw new AppError('I/P weight must be greater than 0');
  const hasOut = v.clean(body.output_weight) !== null;
  const output = hasOut ? v.num(body.output_weight, 'O/P weight') : null;
  if (hasOut && output <= 0) throw new AppError('O/P weight must be greater than 0');
  if (hasOut && output > input) throw new AppError('O/P weight cannot be more than I/P weight');

  const temp = (x, label) => (v.clean(x) === null ? null : v.num(x, label, { max: 600, decimals: 1 }));
  const temp_before = temp(body.temp_before, 'Before roasting temp');
  const std_temp = temp(body.std_temp, 'STD temp');
  const temp_after = temp(body.temp_after, 'After roasting temp');

  const start = v.clean(body.start_time);
  const end = v.clean(body.end_time);
  if (!start || !TIME_RE.test(start)) throw new AppError('Start time must be HH:MM (24 hour), e.g. 09:30');
  if (end && !TIME_RE.test(end)) throw new AppError('End time must be HH:MM (24 hour), e.g. 11:30');
  if (hasOut !== !!end) throw new AppError('Enter both O/P weight and End time to complete the entry, or leave both empty');

  let running_hours = null; let wastage_weight = null; let loss_percent = null;
  if (end) {
    const ms = new Date(`${roast_date}T${end}:00`) - new Date(`${roast_date}T${start}:00`);
    if (ms <= 0) throw new AppError('End time must be after start time');
    running_hours = r2(ms / 3600000);
    wastage_weight = r3(input - output);
    loss_percent = r2((wastage_weight / input) * 100);
  }

  let incharge_id = null;
  if (v.clean(body.incharge_id) !== null && Number(body.incharge_id) !== 0) {
    incharge_id = v.toId(body.incharge_id, 'incharge');
    const [[u]] = await pool.query('SELECT id FROM users WHERE id = ? AND is_active = 1', [incharge_id]);
    if (!u) throw new AppError('Select a valid incharge');
  }

  return {
    roast_date, machine_id, code_no, input_weight: input, output_weight: output,
    temp_before, std_temp, temp_after,
    start_time: `${roast_date} ${start}:00`, end_time: end ? `${roast_date} ${end}:00` : null,
    running_hours, wastage_weight, loss_percent, incharge_id,
    remarks: v.optStr(body.remarks, 'Remarks', 255),
    status: end ? 'COMPLETED' : 'IN_PROGRESS',
  };
}

const cols = (d) => [d.roast_date, d.machine_id, d.code_no, d.input_weight, d.output_weight, d.temp_before, d.std_temp, d.temp_after,
  d.start_time, d.end_time, d.running_hours, d.wastage_weight, d.loss_percent, d.incharge_id, d.remarks, d.status];

async function getOne(id) {
  const [[row]] = await pool.query(`${SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw new AppError('Roasting entry not found', 404);
  return withAlert(row);
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = []; const args = [];
  const search = v.clean(q.search);
  if (search) {
    where.push('(r.code_no LIKE ? OR m.machine_name LIKE ? OR m.machine_code LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (q.date_from) { if (!DATE_RE.test(q.date_from)) throw new AppError('Invalid from date'); where.push('r.roast_date >= ?'); args.push(q.date_from); }
  if (q.date_to) { if (!DATE_RE.test(q.date_to)) throw new AppError('Invalid to date'); where.push('r.roast_date <= ?'); args.push(q.date_to); }
  if (q.machine_id) { where.push('r.machine_id = ?'); args.push(v.toId(q.machine_id, 'machine')); }
  if (q.status) {
    const s = String(q.status).toUpperCase();
    if (!STATUSES.includes(s)) throw new AppError('Invalid status filter');
    where.push('r.status = ?'); args.push(s);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM roasting_details r JOIN machine_master m ON m.id = r.machine_id ${w}`, args);
  const [rows] = await pool.query(`${SELECT} ${w} ORDER BY r.roast_date DESC, r.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows.map(withAlert), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

// dropdown data for the form
async function options() {
  const [machines] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'ROASTING' AND status <> 'INACTIVE' ORDER BY machine_code");
  const [incharges] = await pool.query(
    `SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.is_active = 1 AND r.role_name IN ('Production Incharge', 'Admin') ORDER BY u.full_name`);
  const [recipes] = await pool.query(
    `SELECT r.id, r.recipe_no, p.product_name FROM recipe_master r JOIN product_master p ON p.id = r.product_id
      WHERE r.is_active = 1 ORDER BY r.recipe_no`);
  return { machines, incharges, recipes, loss_alert_percent: LOSS_ALERT };
}

async function create(body, user, ip) {
  const d = await clean(body);
  const [r] = await pool.query(
    `INSERT INTO roasting_details (batch_id, roast_date, machine_id, code_no, input_weight, output_weight, temp_before, std_temp, temp_after,
       start_time, end_time, running_hours, wastage_weight, loss_percent, incharge_id, remarks, status, operator_id)
     VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...cols(d), user.id]);
  await audit({ userId: user.id, action: 'CREATE', table: 'roasting_details', recordId: r.insertId,
    newValues: { code_no: d.code_no, input_weight: d.input_weight, output_weight: d.output_weight, loss_percent: d.loss_percent }, ip });
  return getOne(r.insertId);
}

async function update(id, body, user, ip) {
  const [[old]] = await pool.query('SELECT * FROM roasting_details WHERE id = ?', [id]);
  if (!old) throw new AppError('Roasting entry not found', 404);
  // Roasting Operators can finish an open entry, but cannot change a completed one
  if (old.status === 'COMPLETED' && user.role_name === 'Roasting Operator')
    throw new AppError('Completed entries are locked. Ask the Production Incharge to correct it.', 403);
  const d = await clean(body, old.code_no);
  await pool.query(
    `UPDATE roasting_details SET roast_date=?, machine_id=?, code_no=?, input_weight=?, output_weight=?, temp_before=?, std_temp=?, temp_after=?,
       start_time=?, end_time=?, running_hours=?, wastage_weight=?, loss_percent=?, incharge_id=?, remarks=?, status=? WHERE id = ?`, [...cols(d), id]);
  await audit({ userId: user.id, action: 'UPDATE', table: 'roasting_details', recordId: id,
    oldValues: { input_weight: old.input_weight, output_weight: old.output_weight, loss_percent: old.loss_percent, status: old.status },
    newValues: { input_weight: d.input_weight, output_weight: d.output_weight, loss_percent: d.loss_percent, status: d.status }, ip });
  return getOne(id);
}

module.exports = { list, options, create, update };