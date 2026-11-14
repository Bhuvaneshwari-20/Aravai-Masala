const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const v = require('../utils/validate');
const { r2, r3, reqDate, reqTime, dateTimeStr, lockBatch, checkUsers } = require('../utils/productionHelpers');
const batchService = require('./batchService');

const STAGES_MAX = 5;

/* ---------- list ----------
 * tab=pending : batches ticked "Filtering required" in Batching, waiting at the FILTERING stage
 * tab=done    : filtering register (finished entries)
 */
async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const search = v.clean(q.search);
  const args = [];
  let like = '';
  if (search) { like = ' AND (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }

  if (String(q.tab || 'pending').toLowerCase() === 'done') {
    const base = `FROM filtering_details f
      JOIN batch_master b ON b.id = f.batch_id
      JOIN product_master p ON p.id = b.product_id
      LEFT JOIN recipe_master r ON r.id = b.recipe_id
      JOIN users du ON du.id = f.done_by
      JOIN users cu ON cu.id = f.checked_by WHERE 1=1${like}`;
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${base}`, args);
    const [rows] = await pool.query(
      `SELECT f.*, b.batch_no, b.current_stage, p.product_name, r.recipe_no, du.full_name AS done_by_name, cu.full_name AS checked_by_name
       ${base} ORDER BY f.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
    return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
  }

  const base = `FROM batch_master b
    JOIN product_master p ON p.id = b.product_id
    LEFT JOIN recipe_master r ON r.id = b.recipe_id
    WHERE b.current_stage = 'FILTERING' AND b.status IN ('IN_PROGRESS','ON_HOLD')${like}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${base}`, args);
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.production_date, b.status, b.hold_reason, b.current_output_kg AS input_kg,
            p.product_name, r.recipe_no, r.default_filter_stages AS recipe_stages,
            (SELECT GROUP_CONCAT(m.material_name ORDER BY bd.id SEPARATOR ', ')
               FROM batching_details bd JOIN materials m ON m.id = bd.material_id
              WHERE bd.batch_id = b.id AND bd.needs_filtering = 1) AS filter_materials
     ${base} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

// Done by / Checked by pickers (own endpoint so the Filtering role does not need the Batching permission)
const staff = () => batchService.staff();

/* ---------- save a filtering entry, then hand the batch to ROASTING ---------- */
async function create(body, user, ip) {
  const batchId = v.toId(body.batch_id, 'batch');
  const date = reqDate(body.filter_date, 'Date');
  const stages = v.intRange(body.stages, 'Filtering stages', 1, STAGES_MAX);
  if (stages === undefined) throw new AppError('Filtering stages is required');
  const output = v.positive(body.output_weight, 'O/P weight (kg)', { max: 1000000 });
  const start = reqTime(body.start_time, 'Start time');
  const end = reqTime(body.end_time, 'End time');
  if (end <= start) throw new AppError('End time must be after start time');
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : user.id;
  if (!body.checked_by) throw new AppError('Checked by is required');
  const checkedBy = v.toId(body.checked_by, 'checked by');
  if (doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);

  return withTransaction(async (conn) => {
    const b = await lockBatch(conn, batchId, 'FILTERING'); // must be waiting at the FILTERING stage
    if (b.status === 'ON_HOLD') throw new AppError(`Batch ${b.batch_no} is on hold${b.hold_reason ? ` (${b.hold_reason})` : ''}. Resume it first`);
    await checkUsers(conn, [doneBy, checkedBy]);

    const input = Number(b.current_output_kg);
    if (output > input) throw new AppError(`O/P weight cannot be more than I/P weight (${input} kg)`);
    const wastage = r3(input - output);
    const loss = r2((wastage / input) * 100);

    let id;
    try {
      const [r] = await conn.query(
        `INSERT INTO filtering_details (batch_id, filter_date, stages, input_weight, output_weight, wastage_weight, loss_percent,
           start_time, end_time, done_by, checked_by, remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [batchId, date, stages, input, output, wastage, loss, dateTimeStr(date, start), dateTimeStr(date, end), doneBy, checkedBy, remarks ?? null]);
      id = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError(`Filtering is already recorded for batch ${b.batch_no}`, 409);
      throw e;
    }

    // the filtered quantity goes on to roasting
    await conn.query(
      `UPDATE batch_master SET current_stage = 'ROASTING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?`,
      [output, wastage, batchId]);

    await audit({ userId: user.id, action: 'CREATE', table: 'filtering_details', recordId: id,
      newValues: { batch_no: b.batch_no, stages, input, output, wastage, loss, doneBy, checkedBy, next_stage: 'ROASTING' }, ip }, conn);
    return { id, batch_id: batchId, batch_no: b.batch_no, input_weight: input, output_weight: output,
      wastage_weight: wastage, loss_percent: loss, next_stage: 'ROASTING' };
  });
}

module.exports = { list, staff, create };