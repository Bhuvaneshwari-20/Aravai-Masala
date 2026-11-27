const { pool, withTransaction } = require('../config/db');
const h = require('../utils/productionHelpers');
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
  if (!Number.isInteger(operator_id) || operator_id <= 0) throw new AppError('Operator ID is required');

  const status = String(b.status || 'COMPLETED').toUpperCase();
  if (!['IN_PROGRESS', 'COMPLETED', 'REJECTED'].includes(status)) throw new AppError('Invalid status');

  if (output_weight <= 0) throw new AppError('O/P weight must be greater than 0');
  if (output_weight > input_weight) throw new AppError('O/P weight cannot be more than I/P weight');
  const grind_date = toSqlDate(b.date);
  return {
    finish_grinding: !(b.finish_grinding === false || b.finish_grinding === 'false'),
    grind_date,
    batch_id,
    machine_id,
    operator_id,
    status,
    mesh_size: b.mesh_size === undefined || b.mesh_size === null ? '' : String(b.mesh_size).trim().slice(0, 20),
    mesh_id: b.mesh_id ? Number(b.mesh_id) : null,
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

// mesh sizes come from Master (mesh_master); a typed value that is not in the master is rejected with a clear message
let meshIdColumn; // does grinding_details also have a mesh_id column? (checked once)
async function hasMeshIdColumn() {
  if (meshIdColumn === undefined) {
    const [[r]] = await pool.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grinding_details' AND column_name = 'mesh_id'");
    meshIdColumn = r.n > 0;
  }
  return meshIdColumn;
}

async function meshOptions() {
  const [rows] = await pool.query('SELECT id, mesh_size FROM mesh_master ORDER BY CAST(mesh_size AS DECIMAL(10,3)), mesh_size');
  return rows;
}

async function createMesh(body, userId, ip) {
  const size = v.reqStr(body.mesh_size, 'Mesh size', 20);
  if (!/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) throw new AppError('Mesh size must be a number greater than 0');
  const [[dup]] = await pool.query('SELECT id FROM mesh_master WHERE mesh_size = ?', [size]);
  if (dup) throw new AppError(`Mesh size ${size} already exists`, 409);
  const [r] = await pool.query('INSERT INTO mesh_master (mesh_size) VALUES (?)', [size]);
  await audit({ userId, action: 'CREATE', table: 'mesh_master', recordId: r.insertId, newValues: { mesh_size: size }, ip });
  return { id: r.insertId, mesh_size: size };
}

async function create(body, userId, ip) {
  const d = cleanInput(body, userId);
  const [[mesh]] = d.mesh_id
    ? await pool.query('SELECT id, mesh_size FROM mesh_master WHERE id = ?', [d.mesh_id])
    : await pool.query('SELECT id, mesh_size FROM mesh_master WHERE mesh_size = ?', [d.mesh_size]);
  if (!mesh) throw new AppError('Select the mesh size from the list');
  d.mesh_size = String(mesh.mesh_size);
  d.mesh_id = mesh.id;
  const withMeshId = await hasMeshIdColumn();
  const res = await withTransaction(async (conn) => {
    // only batches that finished Roasting (stage GRINDING) can be ground
    const batch = await h.lockBatch(conn, d.batch_id, 'GRINDING');
    d.machine_id = await h.stageMachine(conn, batch.id, d.machine_id, 'GRINDING');
    const [[g]] = await conn.query("SELECT COALESCE(SUM(input_weight), 0) AS used FROM grinding_details WHERE batch_id = ? AND status <> 'REJECTED'", [batch.id]);
    const available = h.r3(Number(batch.current_output_kg) - Number(g.used));
    if (d.input_weight > available + 0.001)
      throw new AppError(`I/P weight cannot be more than ${available} kg (the roasted weight still left to grind in ${batch.batch_no})`);

    const [r] = await conn.query(
      `INSERT INTO grinding_details(batch_id, grind_date, machine_id, mesh_size, ${withMeshId ? 'mesh_id, ' : ''}input_weight, output_weight, siever,
         input_time, output_time, wastage_weight, loss_percent, operator_id, remarks, status)
       VALUES (?,?,?,?,${withMeshId ? '?,' : ''}?,?,?,?,?,?,?,?,?,?)`,
      [d.batch_id, d.grind_date, d.machine_id, d.mesh_size, ...(withMeshId ? [d.mesh_id] : []), d.input_weight, d.output_weight, d.siever,
        d.input_time, d.output_time, d.wastage_weight, d.loss_percent, d.operator_id, d.remarks, d.status]);

    let moved = null;
    if (d.finish_grinding && d.status === 'COMPLETED') {
      // all the roasted weight must go through grinding before the batch moves on; otherwise it would silently become "loss"
      const [[u]] = await conn.query("SELECT COALESCE(SUM(input_weight), 0) AS used FROM grinding_details WHERE batch_id = ? AND status <> 'REJECTED'", [batch.id]);
      const notGround = h.r3(Number(batch.current_output_kg) - Number(u.used));
      if (notGround > 0.001)
        throw new AppError(`${notGround} kg of ${batch.batch_no} is still not ground. Grind it too (I/P up to ${h.r3(Number(batch.current_output_kg) - Number(u.used) + d.input_weight)} kg), or untick "Grinding finished for this batch" and add the next run later`);
      // powder handed to Blending = total ground output; anything not output is grinding loss
      const [[o]] = await conn.query("SELECT COALESCE(SUM(output_weight), 0) AS total_out FROM grinding_details WHERE batch_id = ? AND status = 'COMPLETED'", [batch.id]);
      const outKg = h.r3(Number(o.total_out));
      const lossKg = Math.max(h.r3(Number(batch.current_output_kg) - outKg), 0);
      await conn.query("UPDATE batch_master SET current_stage = 'BLENDING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?", [outKg, lossKg, batch.id]);
      moved = { to: 'BLENDING', weight_kg: outKg, grinding_loss_kg: lossKg };
      await audit({ userId, action: 'UPDATE', table: 'batch_master', recordId: batch.id,
        oldValues: { current_stage: 'GRINDING', current_output_kg: Number(batch.current_output_kg) },
        newValues: { current_stage: 'BLENDING', current_output_kg: outKg }, ip }, conn);
    }
    return { id: r.insertId, moved };
  });
  const [[row]] = await pool.query('SELECT * FROM grinding_details WHERE id = ?', [res.id]);
  await audit({ userId, action: 'CREATE', table: 'grinding_details', recordId: res.id, newValues: row, ip });
  return res.moved ? { ...row, batch_moved: res.moved } : row;
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  const search = v.clean(q.search);
  if (search) {
    where.push('(g.remarks LIKE ? OR b.batch_no LIKE ? OR p.product_name LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const J = `FROM grinding_details g JOIN batch_master b ON b.id = g.batch_id JOIN product_master p ON p.id = b.product_id
              LEFT JOIN users u ON u.id = g.operator_id LEFT JOIN machine_master m ON m.id = g.machine_id`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${J} ${w}`, args);
  const [rows] = await pool.query(
    `SELECT g.*, b.batch_no AS batch_code, p.product_name AS product, u.full_name AS sign_name, m.machine_name, m.machine_code, b.current_stage AS batch_stage ${J} ${w} ORDER BY g.grind_date DESC, g.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}


async function batchOptions() {
  const [rows] = await pool.query(
    `SELECT b.id, b.batch_no, b.product_id, p.product_name, b.current_output_kg,
            wm.id AS weighing_machine_id, wm.machine_code AS weighing_machine_code, wm.machine_name AS weighing_machine_name,
            (SELECT COALESCE(SUM(g.input_weight), 0) FROM grinding_details g WHERE g.batch_id = b.id AND g.status <> 'REJECTED') AS ground_kg
       FROM batch_master b
       JOIN product_master p ON p.id = b.product_id
       LEFT JOIN machine_master wm ON wm.id = b.weighing_machine_id
      WHERE b.status = 'IN_PROGRESS' AND b.current_stage = 'GRINDING'
      ORDER BY b.id DESC`);
  return rows.map((b) => ({ ...b, available_kg: h.r3(Number(b.current_output_kg) - Number(b.ground_kg)) })).filter((b) => b.available_kg > 0);
}
async function machineOptions() {
  const [rows] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'GRINDING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_code");
  return rows;
}
/* ---------- one saved session, for the "View details" popup ---------- */
async function detail(type, idRaw) {
  const id = v.toId(idRaw, 'processing record');
  const [rows] = await pool.query(`${SESSION_SELECT} WHERE s.id = ? AND s.process_type = ?`, [id, type]);
  if (!rows.length) throw new AppError('Processing record not found', 404);
  const s = shapeSession(rows[0]);

  const [[mat]] = await pool.query('SELECT roast_seconds, filter_seconds, grind_seconds FROM materials WHERE id = ?', [s.material_id]);
  const configured = mat ? (type === 'ROASTING' ? mat.roast_seconds : type === 'FILTERING' ? mat.filter_seconds : mat.grind_seconds) : null;

  const input = Number(s.input_weight);
  const output = s.output_weight == null ? null : Number(s.output_weight);
  const wastage = output == null ? null : r3(Math.max(input - output, 0));
  const loss = output == null || !(input > 0) ? null : r2((wastage / input) * 100);

  let extra = {};
  if (type === 'ROASTING') {
    const [r] = await pool.query(
      'SELECT code_no, temp_before, std_temp, temp_after FROM roasting_details WHERE batch_id = ? AND material_id = ? AND machine_id = ? ORDER BY id DESC LIMIT 1',
      [s.batch_id, s.material_id, s.machine_id]);
    if (r.length) extra = { code_no: r[0].code_no, temp_before: r[0].temp_before, std_temp: r[0].std_temp, temp_after: r[0].temp_after };
  } else if (type === 'GRINDING') {
    const [r] = await pool.query(
      'SELECT mesh_size, siever FROM grinding_details WHERE batch_id = ? AND machine_id = ? AND input_time = (SELECT start_time FROM process_sessions WHERE id = ?) ORDER BY id DESC LIMIT 1',
      [s.batch_id, s.machine_id, id]);
    if (r.length) extra = { mesh_size: r[0].mesh_size, sieved: r[0].siever };
  }
  return { ...s, configured_seconds: Number(configured) > 0 ? Number(configured) : null, wastage_weight: wastage, loss_percent: loss, ...extra };
}



module.exports = { create, list, batchOptions, machineOptions, meshOptions, createMesh,detail  };