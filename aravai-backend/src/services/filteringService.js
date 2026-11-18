const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const v = require('../utils/validate');
const { r2, r3, reqDate, reqTime, dateTimeStr, lockBatch, checkUsers } = require('../utils/productionHelpers');
const batchService = require('./batchService');

const STAGES_MAX = 5;

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

// Materials that already have a saved (locked) filtering entry: Map(batch_id -> Set(material_id))
async function doneMaterialIds(db, batchIds) {
  const map = new Map();
  if (!batchIds.length) return map;
  try {
    const [rows] = await db.query(
      `SELECT f.batch_id, fm.material_id FROM filtering_materials fm
         JOIN filtering_details f ON f.id = fm.filtering_id WHERE f.batch_id IN (?)`, [batchIds]);
    rows.forEach((r) => {
      if (!map.has(r.batch_id)) map.set(r.batch_id, new Set());
      map.get(r.batch_id).add(r.material_id);
    });
  } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  return map;
}

/* ---------- list ----------
 * tab=pending : batches waiting at the FILTERING stage; "materials" = the ones NOT filtered yet
 * tab=done    : filtering register (saved entries, locked)
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

    let mats = [];
    if (rows.length) {
      try {
        [mats] = await pool.query(
          `SELECT fm.filtering_id, fm.material_id, m.material_code, m.material_name, fm.input_weight, fm.output_weight, fm.wastage_weight, fm.loss_percent,
                  fm.start_time, fm.end_time
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
    WHERE b.current_stage = 'FILTERING' AND b.status IN ('IN_PROGRESS','ON_HOLD')${like}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${base}`, args);
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.production_date, b.status, b.hold_reason, b.current_output_kg AS input_kg,
            p.product_name, r.recipe_no, r.default_filter_stages AS recipe_stages,
            wm.id AS weighing_machine_id, wm.machine_code AS weighing_machine_code, wm.machine_name AS weighing_machine_name,
            (SELECT GROUP_CONCAT(m.material_name ORDER BY bd.id SEPARATOR ', ')
               FROM batching_details bd JOIN materials m ON m.id = bd.material_id
              WHERE bd.batch_id = b.id AND bd.needs_filtering = 1) AS filter_materials
     ${base} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);

  const ids = rows.map((r) => r.batch_id);
  const flagged = await flaggedMaterials(pool, ids);
  const done = await doneMaterialIds(pool, ids);
  rows.forEach((r) => {
    const all = flagged.filter((x) => x.batch_id === r.batch_id);
    const d = done.get(r.batch_id) || new Set();
    r.materials = all.filter((x) => !d.has(x.material_id)); // only the materials still to filter
    r.total_materials = all.length;
    r.done_materials = all.length - r.materials.length;
    r.filter_kg = r3(r.materials.reduce((a, x) => a + x.input_weight, 0));
  });
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

// Done by / Checked by pickers (own endpoint so the Filtering role does not need the Batching permission)
const staff = () => batchService.staff();

/* ---------- save filtering entry ----------
 * body.materials = [{ material_id, output_weight, start_time, end_time }]
 *   - only the materials in this request are saved; every saved material is locked
 *   - the batch stays at FILTERING until EVERY ticked material is saved, then it goes to ROASTING
 * body.output_weight (no materials) = old behaviour for batches that have no ticked material list
 */
async function create(body, user, ip) {
  const batchId = v.toId(body.batch_id, 'batch');
  const date = reqDate(body.filter_date, 'Date');
  const stages = v.intRange(body.stages, 'Filtering stages', 1, STAGES_MAX);
  if (stages === undefined) throw new AppError('Filtering stages is required');
  const perMaterial = Array.isArray(body.materials) && body.materials.length > 0;
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : user.id;
  const checkedBy = body.checked_by ? v.toId(body.checked_by, 'checked by') : doneBy;
  if (body.checked_by && doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);

  let outputOld = null; let startOld = null; let endOld = null;
  const given = new Map();
  if (perMaterial) {
    if (body.materials.length > 50) throw new AppError('Too many materials in one entry');
    for (const x of body.materials) {
      const id = v.toId(x && x.material_id, 'material');
      if (given.has(id)) throw new AppError('The same material is added twice');
      given.set(id, x);
    }
  } else {
    outputOld = v.positive(body.output_weight, 'O/P weight (kg)', { max: 1000000 });
    startOld = reqTime(body.start_time, 'Start time');
    endOld = reqTime(body.end_time, 'End time');
    if (endOld <= startOld) throw new AppError('End time must be after start time');
  }

  return withTransaction(async (conn) => {
    const b = await lockBatch(conn, batchId, 'FILTERING'); // must be waiting at the FILTERING stage
    if (b.status === 'ON_HOLD') throw new AppError(`Batch ${b.batch_no} is on hold${b.hold_reason ? ` (${b.hold_reason})` : ''}. Resume it first`);
    await checkUsers(conn, [doneBy, checkedBy]);

    const input = Number(b.current_output_kg); // what the batch holds now (all weighed materials)
    const flagged = await flaggedMaterials(conn, [batchId]);

    // ---------- old single-O/P way (batch without a ticked material list) ----------
    if (!perMaterial) {
      if (flagged.length) throw new AppError('Enter the O/P weight of each material');
      if (outputOld > input) throw new AppError(`O/P weight cannot be more than I/P weight (${input} kg)`);
      const wastage = r3(input - outputOld);
      const loss = r2((wastage / input) * 100);
      const [r] = await conn.query(
        `INSERT INTO filtering_details (batch_id, filter_date, stages, input_weight, output_weight, wastage_weight, loss_percent,
           start_time, end_time, done_by, checked_by, remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [batchId, date, stages, input, outputOld, wastage, loss, dateTimeStr(date, startOld), dateTimeStr(date, endOld), doneBy, checkedBy, remarks ?? null]);
      await conn.query(
        `UPDATE batch_master SET current_stage = 'ROASTING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?`,
        [outputOld, wastage, batchId]);
      await audit({ userId: user.id, action: 'CREATE', table: 'filtering_details', recordId: r.insertId,
        newValues: { batch_no: b.batch_no, stages, input, output: outputOld, wastage, loss, next_stage: 'ROASTING' }, ip }, conn);
      return { id: r.insertId, batch_id: batchId, batch_no: b.batch_no, input_weight: input, output_weight: outputOld,
        wastage_weight: wastage, loss_percent: loss, batch_moved: true, next_stage: 'ROASTING', materials: [] };
    }

    // ---------- per-material way ----------
    if (!flagged.length) throw new AppError('No material of this batch is marked for filtering');
    const doneSet = (await doneMaterialIds(conn, [batchId])).get(batchId) || new Set();
    const byId = new Map(flagged.map((m) => [m.material_id, m]));

    const mats = [];
    for (const [id, x] of given) {
      const m = byId.get(id);
      if (!m) throw new AppError('A selected material is not marked for filtering in this batch');
      if (doneSet.has(id)) throw new AppError(`${m.material_name} is already filtered. Saved entries cannot be changed`);
      const raw = x.output_weight;
      if (raw === undefined || raw === null || raw === '') throw new AppError(`Enter O/P weight for ${m.material_name}`);
      const out = v.positive(raw, `O/P weight of ${m.material_name}`, { max: 1000000 });
      if (out > m.input_weight) throw new AppError(`O/P of ${m.material_name} cannot be more than its I/P (${m.input_weight} kg)`);
      const s = reqTime(x.start_time, `Start time of ${m.material_name}`);
      const e = reqTime(x.end_time, `End time of ${m.material_name}`);
      if (e <= s) throw new AppError(`${m.material_name}: End time must be after start time`);
      const w = r3(m.input_weight - out);
      mats.push({ material_id: id, material_name: m.material_name, input: m.input_weight, output: out, wastage: w,
        loss: r2((w / m.input_weight) * 100), start: s, end: e });
    }

    const sumIn = r3(mats.reduce((a, m) => a + m.input, 0));
    const sumOut = r3(mats.reduce((a, m) => a + m.output, 0));
    const sumWaste = r3(sumIn - sumOut);
    const loss = r2((sumWaste / sumIn) * 100);
    const starts = mats.map((m) => m.start).sort();
    const ends = mats.map((m) => m.end).sort();

    let id;
    try {
      const [r] = await conn.query(
        `INSERT INTO filtering_details (batch_id, filter_date, stages, input_weight, output_weight, wastage_weight, loss_percent,
           start_time, end_time, done_by, checked_by, remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [batchId, date, stages, sumIn, sumOut, sumWaste, loss, dateTimeStr(date, starts[0]), dateTimeStr(date, ends[ends.length - 1]), doneBy, checkedBy, remarks ?? null]);
      id = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError('The database still allows only one filtering entry per batch. Run the migration that drops the unique key on filtering_details.batch_id', 409);
      throw e;
    }
    for (const m of mats) {
      await conn.query(
        `INSERT INTO filtering_materials (filtering_id, material_id, input_weight, output_weight, wastage_weight, loss_percent, start_time, end_time)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, m.material_id, m.input, m.output, m.wastage, m.loss, dateTimeStr(date, m.start), dateTimeStr(date, m.end)]);
    }

    // is every ticked material filtered now?
    const pending = flagged.filter((m) => !doneSet.has(m.material_id) && !given.has(m.material_id));
    let moved = false; let batchOutput = null;
    if (!pending.length) {
      const [[tw]] = await conn.query(
        `SELECT COALESCE(SUM(fm.wastage_weight), 0) AS w FROM filtering_materials fm
           JOIN filtering_details f ON f.id = fm.filtering_id WHERE f.batch_id = ?`, [batchId]);
      const totalWaste = r3(Number(tw.w));
      batchOutput = r3(input - totalWaste); // unfiltered materials go on as they are
      await conn.query(
        `UPDATE batch_master SET current_stage = 'ROASTING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?`,
        [batchOutput, totalWaste, batchId]);
      moved = true;
    }

    await audit({ userId: user.id, action: 'CREATE', table: 'filtering_details', recordId: id,
      newValues: { batch_no: b.batch_no, stages, input: sumIn, output: sumOut, wastage: sumWaste, loss, doneBy, checkedBy, materials: mats,
        next_stage: moved ? 'ROASTING' : 'FILTERING', batch_output: batchOutput }, ip }, conn);
    return { id, batch_id: batchId, batch_no: b.batch_no, input_weight: sumIn, output_weight: sumOut, wastage_weight: sumWaste, loss_percent: loss,
      batch_moved: moved, next_stage: moved ? 'ROASTING' : 'FILTERING', materials: mats,
      pending_materials: pending.map((m) => m.material_name) };
  });
}

module.exports = { list, staff, create };
