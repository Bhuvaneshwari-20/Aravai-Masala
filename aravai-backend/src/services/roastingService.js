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
         r.batch_id, b.batch_no, r.material_id, mt.material_code, mt.material_name,
         r.input_weight, r.output_weight, r.temp_before, r.std_temp, r.temp_after,
         r.start_time, r.end_time, r.running_hours, r.wastage_weight, r.loss_percent,
         r.status, r.remarks, r.operator_id, op.full_name AS operator_name,
         r.incharge_id, inc.full_name AS incharge_name
    FROM roasting_details r
    JOIN machine_master m ON m.id = r.machine_id
    JOIN users op ON op.id = r.operator_id
    LEFT JOIN batch_master b ON b.id = r.batch_id
    LEFT JOIN materials mt ON mt.id = r.material_id
    LEFT JOIN users inc ON inc.id = r.incharge_id`;

// Weighed quantity of one material in one batch (from Batching) and how much of it is already roasted
async function batchMaterialQty(batchId, materialId, excludeId = 0) {
  const [[w]] = await pool.query('SELECT SUM(weighed_qty) AS qty FROM batching_details WHERE batch_id = ? AND material_id = ?', [batchId, materialId]);
  const [[x]] = await pool.query(
    `SELECT COALESCE(SUM(input_weight), 0) AS qty FROM roasting_details
      WHERE batch_id = ? AND material_id = ? AND status <> 'REJECTED' AND id <> ?`, [batchId, materialId, excludeId]);
  const weighed = w.qty === null ? null : Number(w.qty);
  const roasted = Number(x.qty);
  return { weighed, roasted, remaining: weighed === null ? null : r3(weighed - roasted) };
}

const withAlert = (row) => ({ ...row, loss_alert: row.loss_percent !== null && row.loss_percent > LOSS_ALERT });

// Validates the form and works out Running Hours, Wastage and Loss % (the system calculates them, not the operator)
async function clean(body, old = null, selfId = 0) {
  const roast_date = v.reqStr(body.roast_date, 'Date', 10);
  if (!DATE_RE.test(roast_date) || Number.isNaN(Date.parse(roast_date))) throw new AppError('Date must be in YYYY-MM-DD format');

  const machine_id = v.toId(body.machine_id, 'machine');
  const [[m]] = await pool.query("SELECT id FROM machine_master WHERE id = ? AND machine_type = 'ROASTING'", [machine_id]);
  if (!m) throw new AppError('Select a valid roasting machine');

  const code_no = v.reqStr(body.code_no, 'Code no', 30).toUpperCase();
  // Code no = a recipe code (RCP001 ...). Old free-text entries can still be saved unchanged.
  let recipeId = null;
  if (!old || code_no !== old.code_no) {
    const [[rc]] = await pool.query('SELECT id FROM recipe_master WHERE recipe_no = ? AND is_active = 1', [code_no]);
    if (!rc) throw new AppError('Select a valid recipe code');
    recipeId = rc.id;
  } else {
    const [[rc]] = await pool.query('SELECT id FROM recipe_master WHERE recipe_no = ?', [code_no]);
    recipeId = rc ? rc.id : null;
  }

  // Batch no + material (taken from Batching). Old entries without a batch can still be saved unchanged.
  const batch_id = v.clean(body.batch_id) === null ? null : v.toId(body.batch_id, 'batch');
  const material_id = v.clean(body.material_id) === null ? null : v.toId(body.material_id, 'material');
  const unchanged = !!old && (old.batch_id ?? null) === batch_id && (old.material_id ?? null) === material_id;
  if (!unchanged) {
    if (!material_id) throw new AppError('Select the material');
    if (!batch_id) throw new AppError('Select the batch no');
  }
  let weighedInfo = null;
  if (batch_id && material_id) {
    const [[b]] = await pool.query('SELECT id, batch_no, recipe_id, status, current_stage FROM batch_master WHERE id = ?', [batch_id]);
    if (!b) throw new AppError('Batch not found');
    if (recipeId && b.recipe_id !== recipeId) throw new AppError(`Batch ${b.batch_no} was not made with recipe ${code_no}`);
    if (!unchanged) {
      if (b.status !== 'IN_PROGRESS') throw new AppError(`Batch ${b.batch_no} is ${b.status.toLowerCase().replace('_', ' ')}`);
      if (b.current_stage !== 'ROASTING') throw new AppError(`Batch ${b.batch_no} is not at the Roasting stage (it is at ${b.current_stage})`);
    }
    weighedInfo = { batch_no: b.batch_no, ...(await batchMaterialQty(batch_id, material_id, selfId)) };
    if (weighedInfo.weighed === null) throw new AppError(`This material was not weighed in batch ${b.batch_no}`);
  }

  const input = v.num(body.input_weight, 'I/P weight');
  if (input <= 0) throw new AppError('I/P weight must be greater than 0');
  const hasOut = v.clean(body.output_weight) !== null;
  const output = hasOut ? v.num(body.output_weight, 'O/P weight') : null;
  if (hasOut && output <= 0) throw new AppError('O/P weight must be greater than 0');
  if (hasOut && output > input) throw new AppError('O/P weight cannot be more than I/P weight');
  if (weighedInfo && input > weighedInfo.remaining + 0.0005)
    throw new AppError(`I/P weight cannot be more than ${weighedInfo.remaining} kg (weighed ${weighedInfo.weighed} kg in ${weighedInfo.batch_no}, already roasted ${weighedInfo.roasted} kg)`);

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
    batch_id, material_id, roast_date, machine_id, code_no, input_weight: input, output_weight: output,
    temp_before, std_temp, temp_after,
    start_time: `${roast_date} ${start}:00`, end_time: end ? `${roast_date} ${end}:00` : null,
    running_hours, wastage_weight, loss_percent, incharge_id,
    remarks: v.optStr(body.remarks, 'Remarks', 255),
    status: end ? 'COMPLETED' : 'IN_PROGRESS',
  };
}

const cols = (d) => [d.batch_id, d.material_id, d.roast_date, d.machine_id, d.code_no, d.input_weight, d.output_weight, d.temp_before, d.std_temp, d.temp_after,
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
    where.push('(r.code_no LIKE ? OR m.machine_name LIKE ? OR m.machine_code LIKE ? OR b.batch_no LIKE ? OR mt.material_name LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
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
    `SELECT COUNT(*) AS total FROM roasting_details r JOIN machine_master m ON m.id = r.machine_id
       LEFT JOIN batch_master b ON b.id = r.batch_id LEFT JOIN materials mt ON mt.id = r.material_id ${w}`, args);
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

// Dropdown 2: materials of the selected recipe
async function recipeMaterials(q) {
  const recipeNo = v.reqStr(q.recipe_no, 'Recipe code', 30).toUpperCase();
  const [rows] = await pool.query(
    `SELECT m.id AS material_id, m.material_code, m.material_name
       FROM recipe_master r JOIN recipe_details d ON d.recipe_id = r.id JOIN materials m ON m.id = d.material_id
      WHERE r.recipe_no = ? ORDER BY d.id`, [recipeNo]);
  return { items: rows };
}

// Dropdown 3: batch nos (from Batching) that use this recipe, contain this material and are waiting at the Roasting stage.
// current_batch_id / exclude_id are sent when an existing entry is being edited.
async function batchesFor(q) {
  const recipeNo = v.reqStr(q.recipe_no, 'Recipe code', 30).toUpperCase();
  const materialId = v.toId(q.material_id, 'material');
  const currentBatch = v.clean(q.current_batch_id) === null ? 0 : v.toId(q.current_batch_id, 'batch');
  const excludeId = v.clean(q.exclude_id) === null ? 0 : v.toId(q.exclude_id, 'entry');
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.production_date, SUM(bd.weighed_qty) AS weighed_qty,
            (SELECT COALESCE(SUM(x.input_weight), 0) FROM roasting_details x
              WHERE x.batch_id = b.id AND x.material_id = ? AND x.status <> 'REJECTED' AND x.id <> ?) AS roasted_qty
       FROM batch_master b
       JOIN recipe_master r ON r.id = b.recipe_id
       JOIN batching_details bd ON bd.batch_id = b.id AND bd.material_id = ?
      WHERE r.recipe_no = ? AND ((b.current_stage = 'ROASTING' AND b.status = 'IN_PROGRESS') OR b.id = ?)
      GROUP BY b.id, b.batch_no, b.production_date
      ORDER BY b.id DESC`, [materialId, excludeId, materialId, recipeNo, currentBatch]);
  const items = rows.map((b) => ({ ...b, remaining_qty: r3(Number(b.weighed_qty) - Number(b.roasted_qty)) }))
    .filter((b) => b.remaining_qty > 0 || b.batch_id === currentBatch);
  return { items };
}

async function create(body, user, ip) {
  const d = await clean(body);
  const [r] = await pool.query(
    `INSERT INTO roasting_details (batch_id, material_id, roast_date, machine_id, code_no, input_weight, output_weight, temp_before, std_temp, temp_after,
       start_time, end_time, running_hours, wastage_weight, loss_percent, incharge_id, remarks, status, operator_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...cols(d), user.id]);
  await audit({ userId: user.id, action: 'CREATE', table: 'roasting_details', recordId: r.insertId,
    newValues: { code_no: d.code_no, batch_id: d.batch_id, material_id: d.material_id, input_weight: d.input_weight, output_weight: d.output_weight, loss_percent: d.loss_percent }, ip });
  return getOne(r.insertId);
}

async function update(id, body, user, ip) {
  const [[old]] = await pool.query('SELECT * FROM roasting_details WHERE id = ?', [id]);
  if (!old) throw new AppError('Roasting entry not found', 404);
  // Roasting Operators can finish an open entry, but cannot change a completed one
  if (old.status === 'COMPLETED' && user.role_name === 'Roasting Operator')
    throw new AppError('Completed entries are locked. Ask the Production Incharge to correct it.', 403);
  const d = await clean(body, old, Number(id));
  await pool.query(
    `UPDATE roasting_details SET batch_id=?, material_id=?, roast_date=?, machine_id=?, code_no=?, input_weight=?, output_weight=?, temp_before=?, std_temp=?, temp_after=?,
       start_time=?, end_time=?, running_hours=?, wastage_weight=?, loss_percent=?, incharge_id=?, remarks=?, status=? WHERE id = ?`, [...cols(d), id]);
  await audit({ userId: user.id, action: 'UPDATE', table: 'roasting_details', recordId: id,
    oldValues: { input_weight: old.input_weight, output_weight: old.output_weight, loss_percent: old.loss_percent, status: old.status },
    newValues: { input_weight: d.input_weight, output_weight: d.output_weight, loss_percent: d.loss_percent, status: d.status }, ip });
  return getOne(id);
}

module.exports = { list, options, recipeMaterials, batchesFor, create, update };