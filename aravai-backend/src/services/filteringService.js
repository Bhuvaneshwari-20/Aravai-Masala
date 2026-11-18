const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const v = require('../utils/validate');
const { r2, r3, reqDate, reqTime, dateTimeStr, lockBatch, checkUsers } = require('../utils/productionHelpers');
const batchService = require('./batchService');

const STAGES_MAX = 5;

// Lock a running batch whatever stage it is at (used for PARALLEL batches, which wait at ROASTING while their ticked materials are filtered)
async function lockBatchAny(conn, batchId) {
  const [rows] = await conn.query('SELECT * FROM batch_master WHERE id = ? FOR UPDATE', [batchId]);
  if (!rows.length) throw new AppError('Batch not found', 404);
  if (['COMPLETED', 'CANCELLED'].includes(rows[0].status)) throw new AppError(`Batch ${rows[0].batch_no} is already ${rows[0].status.toLowerCase()}`, 409);
  return rows[0];
}

// Materials of a batch that were ticked "Filter" in Batching, with the weight weighed for each one (= its I/P in Filtering)
async function flaggedMaterials(db, batchIds) {
  if (!batchIds.length) return [];
  const [rows] = await db.query(
    `SELECT bd.batch_id, m.id AS material_id, m.material_code, m.material_name, SUM(bd.weighed_qty) AS input_weight
       FROM batching_details bd JOIN materials m ON m.id = bd.material_id
      WHERE bd.batch_id IN (?) AND bd.needs_filtering = 1
      GROUP BY bd.batch_id, m.id, m.material_code, m.material_name
      ORDER BY MIN(bd.id)`, [batchIds]);
  return rows.map((r) => ({ ...r, input_weight: Number(r.input_weight) }));
}

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

    // per-material I/P, O/P and loss of every entry (entries saved before this update simply have none)
    let mats = [];
    if (rows.length) {
      try {
        [mats] = await pool.query(
          `SELECT fm.filtering_id, fm.material_id, m.material_code, m.material_name, fm.input_weight, fm.output_weight, fm.wastage_weight, fm.loss_percent
             FROM filtering_materials fm JOIN materials m ON m.id = fm.material_id WHERE fm.filtering_id IN (?) ORDER BY fm.id`, [rows.map((r) => r.id)]);
      } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
    }
    rows.forEach((r) => { r.materials = mats.filter((x) => x.filtering_id === r.id); });
    return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
  }

  const base = `FROM batch_master b
    JOIN product_master p ON p.id = b.product_id
    LEFT JOIN recipe_master r ON r.id = b.recipe_id
    LEFT JOIN machine_master wm ON wm.id = b.weighing_machine_id
    WHERE b.status IN ('IN_PROGRESS','ON_HOLD')
      AND (b.current_stage = 'FILTERING'
           OR (b.current_stage = 'ROASTING' AND b.roasting_mode = 'PARALLEL'
               AND EXISTS (SELECT 1 FROM batching_details x WHERE x.batch_id = b.id AND x.needs_filtering = 1)
               AND NOT EXISTS (SELECT 1 FROM filtering_details fd WHERE fd.batch_id = b.id)))${like}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${base}`, args);
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.production_date, b.status, b.hold_reason, b.current_output_kg AS input_kg,
            p.product_name, r.recipe_no, r.default_filter_stages AS recipe_stages,
            b.current_stage, b.roasting_mode,
            wm.id AS weighing_machine_id, wm.machine_code AS weighing_machine_code, wm.machine_name AS weighing_machine_name,
            (SELECT GROUP_CONCAT(m.material_name ORDER BY bd.id SEPARATOR ', ')
               FROM batching_details bd JOIN materials m ON m.id = bd.material_id
              WHERE bd.batch_id = b.id AND bd.needs_filtering = 1) AS filter_materials
     ${base} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);

  // each material to filter, with its own I/P (taken from Batching) - the form lists them one by one
  const flagged = await flaggedMaterials(pool, rows.map((r) => r.batch_id));
  rows.forEach((r) => {
    r.materials = flagged.filter((x) => x.batch_id === r.batch_id);
    r.filter_kg = r3(r.materials.reduce((a, x) => a + x.input_weight, 0));
  });
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

// Done by / Checked by pickers (own endpoint so the Filtering role does not need the Batching permission)
const staff = () => batchService.staff();

/* ---------- save a filtering entry, then hand the batch to ROASTING ----------
 * Two ways to call it:
 *  - body.materials = [{ material_id, output_weight }]  -> every ticked material gets its own O/P (new form)
 *  - body.output_weight                                  -> one O/P for the whole batch (old behaviour, unchanged)
 */
async function create(body, user, ip) {
  const batchId = v.toId(body.batch_id, 'batch');
  const date = reqDate(body.filter_date, 'Date');
  const stages = v.intRange(body.stages, 'Filtering stages', 1, STAGES_MAX);
  if (stages === undefined) throw new AppError('Filtering stages is required');
  const perMaterial = Array.isArray(body.materials) && body.materials.length > 0;
  const outputOld = perMaterial ? null : v.positive(body.output_weight, 'O/P weight (kg)', { max: 1000000 });
  const start = reqTime(body.start_time, 'Start time');
  const end = reqTime(body.end_time, 'End time');
  if (end <= start) throw new AppError('End time must be after start time');
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : user.id;
  // Checked by is no longer asked in the form. When it is not sent, the logged-in user is stored for both (the columns stay filled).
  const checkedBy = body.checked_by ? v.toId(body.checked_by, 'checked by') : doneBy;
  if (body.checked_by && doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);

  return withTransaction(async (conn) => {
    // must be waiting at the FILTERING stage - or be a PARALLEL batch: Roasting already runs for the unfiltered materials and the ticked ones are still to be filtered
    const [[cur]] = await conn.query('SELECT current_stage, roasting_mode FROM batch_master WHERE id = ?', [batchId]);
    const parallel = !!cur && cur.current_stage === 'ROASTING' && cur.roasting_mode === 'PARALLEL';
    const b = parallel ? await lockBatchAny(conn, batchId) : await lockBatch(conn, batchId, 'FILTERING');
    if (b.status === 'ON_HOLD') throw new AppError(`Batch ${b.batch_no} is on hold${b.hold_reason ? ` (${b.hold_reason})` : ''}. Resume it first`);
    await checkUsers(conn, [doneBy, checkedBy]);

    if (parallel && !perMaterial) throw new AppError('Enter the O/P weight of every material that is being filtered');
    const input = Number(b.current_output_kg);
    let output; let wastage; let mats = [];
    if (perMaterial) {
      const flagged = await flaggedMaterials(conn, [batchId]);
      if (!flagged.length) throw new AppError('No material of this batch is marked for filtering');
      const given = new Map(body.materials.map((x) => [Number(x.material_id), x.output_weight]));
      let waste = 0;
      mats = flagged.map((m) => {
        const raw = given.get(m.material_id);
        if (raw === undefined || raw === null || raw === '') throw new AppError(`Enter O/P weight for ${m.material_name}`);
        const out = v.positive(raw, `O/P weight of ${m.material_name}`, { max: 1000000 });
        if (out > m.input_weight) throw new AppError(`O/P of ${m.material_name} cannot be more than its I/P (${m.input_weight} kg)`);
        const w = r3(m.input_weight - out);
        waste = r3(waste + w);
        return { material_id: m.material_id, material_name: m.material_name, input: m.input_weight, output: out, wastage: w, loss: r2((w / m.input_weight) * 100) };
      });
      wastage = waste;
      output = r3(input - wastage); // materials that were not filtered go to roasting as they are
    } else {
      output = outputOld;
      if (output > input) throw new AppError(`O/P weight cannot be more than I/P weight (${input} kg)`);
      wastage = r3(input - output);
    }
    const loss = r2((wastage / input) * 100);
    if (parallel) {
      // Roasting of the other materials is already running: the weight handed to Roasting may not drop below what is already roasted
      const [[used]] = await conn.query("SELECT COALESCE(SUM(input_weight), 0) AS qty FROM roasting_details WHERE batch_id = ? AND status <> 'REJECTED'", [batchId]);
      if (output < Number(used.qty) - 0.0005) throw new AppError(`Filtering loss is too high: only ${output} kg is left for Roasting but ${r3(Number(used.qty))} kg is already roasted`);
    }

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
    for (const m of mats) {
      await conn.query(
        `INSERT INTO filtering_materials (filtering_id, material_id, input_weight, output_weight, wastage_weight, loss_percent) VALUES (?,?,?,?,?,?)`,
        [id, m.material_id, m.input, m.output, m.wastage, m.loss]);
    }

    // the filtered quantity goes on to roasting
    await conn.query(
      `UPDATE batch_master SET current_stage = 'ROASTING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?`, // PARALLEL batches are already at ROASTING: only the weight changes
      [output, wastage, batchId]);

    await audit({ userId: user.id, action: 'CREATE', table: 'filtering_details', recordId: id,
      newValues: { batch_no: b.batch_no, stages, input, output, wastage, loss, doneBy, checkedBy, materials: mats, next_stage: 'ROASTING', roasting_mode: b.roasting_mode }, ip }, conn);
    return { id, batch_id: batchId, batch_no: b.batch_no, input_weight: input, output_weight: output,
      wastage_weight: wastage, loss_percent: loss, next_stage: 'ROASTING', materials: mats };
  });
}

module.exports = { list, staff, create };