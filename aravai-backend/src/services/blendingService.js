const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');

// true  = ingredients picked from Material Master are issued from raw stock (ledger row + stock reduced).
// false = blending only records the weights and never touches stock.
const DEDUCT_STOCK = false;
const MAX_LINES = 50;
const START_TOLERANCE_MIN = Math.max(Number(process.env.START_TIME_TOLERANCE_MIN) || 10, 0);   // phone clock may be a few minutes ahead of the server
// The spices of a batch with their weights. Per-spice weights exist only at batching (or in the recipe), so they are
// scaled to the powder grinding actually handed over (batch_master.current_output_kg). Mixing % = spice weight / total.
async function loadIngredients(db, batchId = null) {
  const only = batchId ? 'AND b.id = ?' : '';
  const args = batchId ? [batchId, batchId] : [];
  const [rows] = await db.query(
    `SELECT b.id AS batch_id, b.current_output_kg AS ground_kg, m.id AS material_id, m.material_code, m.material_name, ROUND(SUM(d.weighed_qty), 3) AS qty
       FROM batch_master b JOIN batching_details d ON d.batch_id = b.id JOIN materials m ON m.id = d.material_id
      WHERE b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS') ${only}
      GROUP BY b.id, b.current_output_kg, m.id, m.material_code, m.material_name
     UNION ALL
     SELECT b.id, b.current_output_kg, m.id, m.material_code, m.material_name, ROUND(rd.quantity_kg * b.planned_qty_kg / r.base_quantity_kg, 3)
       FROM batch_master b JOIN recipe_master r ON r.id = b.recipe_id JOIN recipe_details rd ON rd.recipe_id = r.id
       JOIN materials m ON m.id = rd.material_id
      WHERE b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS') ${only}
        AND NOT EXISTS (SELECT 1 FROM batching_details x WHERE x.batch_id = b.id)`, args);
  const total = {};
  rows.forEach((r) => { total[r.batch_id] = (total[r.batch_id] || 0) + Number(r.qty); });
  const base = rows.map((r) => {
    const share = total[r.batch_id] > 0 ? Number(r.qty) / total[r.batch_id] : 0;
    const ground = Number(r.ground_kg);
    return { batch_id: r.batch_id, material_id: r.material_id, material_code: r.material_code, material_name: r.material_name,
      qty: h.r3(ground > 0 ? ground * share : Number(r.qty)), percent: h.r3(share * 100) };
  });

  // Use what Grinding really produced for each material (its O/P weight), not a share of the total.
  // Old batches ground with the previous form have no per-material output, so they keep the scaled figures above.
  const ids = [...new Set(base.map((r) => r.batch_id))];
  if (ids.length) {
    try {
      const [gs] = await db.query(
        "SELECT batch_id, material_id, SUM(output_weight) AS out_kg FROM process_sessions WHERE process_type = 'GRINDING' AND status = 'COMPLETED' AND batch_id IN (?) GROUP BY batch_id, material_id", [ids]);
      const actual = {};
      gs.forEach((x) => { actual[`${x.batch_id}:${x.material_id}`] = Number(x.out_kg); });
      ids.forEach((bid) => {
        const mine = base.filter((r) => r.batch_id === bid);
        if (!mine.length || !mine.every((r) => actual[`${bid}:${r.material_id}`] > 0)) return;
        const sum = mine.reduce((s, r) => s + actual[`${bid}:${r.material_id}`], 0);
        mine.forEach((r) => { const kg = actual[`${bid}:${r.material_id}`]; r.qty = h.r3(kg); r.percent = h.r3(sum > 0 ? (kg / sum) * 100 : 0); });
      });
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  }
  return base.sort((a, b) => a.batch_id - b.batch_id || a.material_name.localeCompare(b.material_name));
}
// Blending time of a batch = the longest Blending time configured in Material Master for its ingredients (null = none configured)
async function configuredSeconds(db, materialIds) {
  if (!materialIds.length) return null;
  const [[r]] = await db.query('SELECT MAX(blending_seconds) AS s FROM materials WHERE id IN (?)', [materialIds]);
  return Number(r.s) > 0 ? Number(r.s) : null;
}
/* ---------- dropdown data for the form ---------- */
async function lookups() {
  const [batches] = await pool.query(
    `SELECT b.id, b.batch_no, b.product_id, p.product_name, b.recipe_id, b.planned_qty_kg, b.current_output_kg,
            wm.id AS weighing_machine_id, wm.machine_code AS weighing_machine_code, wm.machine_name AS weighing_machine_name
       FROM batch_master b JOIN product_master p ON p.id = b.product_id
       LEFT JOIN machine_master wm ON wm.id = b.weighing_machine_id
      WHERE b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS') ORDER BY b.id DESC`);
  const [machines] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'BLENDING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_name");
  const [recipes] = await pool.query(
    'SELECT id, recipe_no, product_id, version_no FROM recipe_master WHERE is_active = 1 ORDER BY recipe_no');
  const [materials] = await pool.query(
    "SELECT id, material_code, material_name, unit, current_stock FROM materials WHERE is_active = 1 AND unit IN ('KG','GRAM') ORDER BY material_name");
  const [users] = await pool.query('SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name');
  let batchMaterials = [];
  try { batchMaterials = await loadIngredients(pool); } catch (e) { console.error('batch_materials lookup failed:', e.message); } // never let this break the whole form
  return { batches, machines, recipes, materials, users, batch_materials: batchMaterials };
}
/* ---------- validation ---------- */
function cleanInput(body, userId) {
  const d = {
    batch_id: v.toId(body.batch_id, 'batch'),
    recipe_id: body.recipe_id ? v.toId(body.recipe_id, 'recipe') : null,
    machine_id: body.machine_id ? v.toId(body.machine_id, 'machine') : null,
    entry_date: h.reqDate(body.entry_date, 'Date'),
    start_clock: h.reqTime(body.start_time, 'Start time'),
    mixing_duration_min: body.mixing_duration_min === '' || body.mixing_duration_min == null ? null : h.wholeNum(body.mixing_duration_min, 'Mixing duration', { max: 1440 }),
    done_by: body.done_by ? v.toId(body.done_by, 'done by user') : userId,
    checked_by: body.checked_by ? v.toId(body.checked_by, 'checked by user') : null,
    remarks: v.optStr(body.remarks, 'Remarks', 255),
  };

  d.output_weight = v.num(body.output_weight, 'Blended output weight', { max: 999999 });
  if (d.output_weight <= 0) throw new AppError('Enter the blended output weight');
  return d;
}

/* ---------- submit ---------- */
async function create(body, userId, ip) {
  const d = cleanInput(body, userId);
  return withTransaction((conn) => saveBlending(conn, d, userId, ip));
}

// The one save used by the old single-step form (create) and by Stop in the new Start / Stop flow.
async function saveBlending(conn, d, userId, ip) {
  const batch = await h.lockBatch(conn, d.batch_id, 'BLENDING');
  if (!d.keep_machine) d.machine_id = await h.stageMachine(conn, batch.id, d.machine_id, 'BLENDING');   // Start / Stop flow keeps the machine the operator chose
  await h.checkUsers(conn, [userId, d.done_by, d.checked_by]);

  const recipeId = d.recipe_id || batch.recipe_id;
  if (!recipeId) throw new AppError('This batch has no recipe. Please select one');
  const [rec] = await conn.query('SELECT id, product_id FROM recipe_master WHERE id = ? AND is_active = 1', [recipeId]);
  if (!rec.length) throw new AppError('Selected recipe does not exist or is inactive');
  if (rec[0].product_id !== batch.product_id) throw new AppError('Selected recipe belongs to a different product');

  // ingredients and their weights come from the batch itself, never from the form
  d.ingredients = (await loadIngredients(conn, batch.id)).map((m) => ({
    material_id: m.material_id, ingredient_weight: m.qty, no_of_bags: 0, weight_per_bag: null }));
  if (!d.ingredients.length) throw new AppError('No ingredient weights found for this batch. It needs batching weights or a recipe');
  const totalInput = h.r3(d.ingredients.reduce((s, l) => s + l.ingredient_weight, 0));
  if (d.output_weight > totalInput + 0.01) throw new AppError(`Blended weight (${d.output_weight} kg) cannot be more than the total ingredients (${totalInput} kg)`);
  const wastage = h.r3(Math.max(totalInput - d.output_weight, 0));

  const start = h.dateTimeStr(d.entry_date, d.start_clock);
  const end = d.mixing_duration_min == null ? null : h.dateTimeStr(d.entry_date, d.start_clock, d.mixing_duration_min);
  const [hd] = await conn.query(
    `INSERT INTO blending_details (batch_id, recipe_id, machine_id, operator_id, total_input_weight, mixing_duration_min,
       start_time, end_time, output_weight, wastage_weight, status, remarks) VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETED',?)`,
    [batch.id, recipeId, d.machine_id, userId, totalInput, d.mixing_duration_min, start, end, d.output_weight, wastage, d.remarks]);

  for (const l of d.ingredients) {
    let name = l.ingredient_name;
    let txnId = null;
    if (l.material_id) {
      const [[m]] = await conn.query('SELECT material_name FROM materials WHERE id = ?', [l.material_id]);
      if (!m) throw new AppError('Selected material does not exist');
      name = m.material_name;
      if (DEDUCT_STOCK) {
        txnId = await h.issueRawMaterial(conn, { materialId: l.material_id, weightKg: l.ingredient_weight, date: d.entry_date,
          batch, userId, purpose: `Blending - ${batch.batch_no}` });
      }
    } else {
      name = name || `Ground batch ${batch.batch_no}`;
    }
    await conn.query(
      `INSERT INTO blending_ingredients (blending_id, entry_date, material_id, ingredient_name, no_of_bags, weight_per_bag,
         ingredient_weight, done_by, checked_by, stock_txn_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [hd.insertId, d.entry_date, l.material_id, name, l.no_of_bags, l.weight_per_bag, l.ingredient_weight, d.done_by, d.checked_by, txnId]);
  }

  // hand the blended weight to Packing
  await conn.query(
    `UPDATE batch_master SET current_stage = 'PACKING', status = 'IN_PROGRESS', current_output_kg = ?,
       total_wastage_kg = total_wastage_kg + ? WHERE id = ?`, [d.output_weight, wastage, batch.id]);

  const result = { id: hd.insertId, batch_no: batch.batch_no, total_input_weight: totalInput, output_weight: d.output_weight, wastage_weight: wastage };
  await audit({ userId, action: 'CREATE', table: 'blending_details', recordId: hd.insertId, newValues: { ...result, lines: d.ingredients.length }, ip }, conn);
  return result;
}


/* ---------- one entry, for the details view ---------- */
async function get(id) {
  const bid = v.toId(id, 'blending entry');
  const [rows] = await pool.query(
    `SELECT bd.*, b.batch_no, b.current_stage AS batch_stage, b.status AS batch_status, b.current_output_kg AS batch_output_kg,
            p.product_name, rc.recipe_no, rc.version_no, m.machine_code, m.machine_name, u.full_name AS operator_name,
            COALESCE((SELECT SUM(x.weighed_qty) FROM batching_details x WHERE x.batch_id = b.id), 0) AS batching_kg,
COALESCE((SELECT SUM(x.total_packing_weight) FROM packing_details x WHERE x.batch_id = b.id AND x.status <> 'CANCELLED'), 0) AS batch_packed_kg
       FROM blending_details bd
       JOIN batch_master b ON b.id = bd.batch_id
       JOIN product_master p ON p.id = b.product_id
       JOIN recipe_master rc ON rc.id = bd.recipe_id
       JOIN machine_master m ON m.id = bd.machine_id
       JOIN users u ON u.id = bd.operator_id
      WHERE bd.id = ?`, [bid]);
  if (!rows.length) throw new AppError('Blending entry not found', 404);
  const d = rows[0];
  const [ing] = await pool.query(
    `SELECT i.id, i.entry_date, i.ingredient_name, i.ingredient_weight, i.no_of_bags, i.weight_per_bag, mt.material_code,
            du.full_name AS done_by_name, cu.full_name AS checked_by_name
       FROM blending_ingredients i
       LEFT JOIN materials mt ON mt.id = i.material_id
       LEFT JOIN users du ON du.id = i.done_by
       LEFT JOIN users cu ON cu.id = i.checked_by
      WHERE i.blending_id = ? ORDER BY i.id`, [bid]);
  const total = Number(d.total_input_weight);
  d.ingredients = ing.map((r) => ({ ...r, percent: total > 0 ? h.r2((Number(r.ingredient_weight) / total) * 100) : 0 }));
  d.loss_percent = total > 0 ? h.r2((Number(d.wastage_weight || 0) / total) * 100) : 0;
  return d;
}

/* ---------- recent entries ---------- */
async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const args = [];
  let w = '';
  const search = v.clean(q.search);
  if (search) { w = 'WHERE (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const from = `FROM blending_details bd JOIN batch_master b ON b.id = bd.batch_id JOIN product_master p ON p.id = b.product_id
    JOIN machine_master m ON m.id = bd.machine_id JOIN users u ON u.id = bd.operator_id ${w}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [items] = await pool.query(
    `SELECT bd.id, b.batch_no, p.product_name, m.machine_name, u.full_name AS operator_name, bd.start_time, bd.mixing_duration_min,
            bd.total_input_weight, bd.output_weight, bd.wastage_weight, bd.status ${from} ORDER BY bd.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset]);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}


/* ======================= Start / Stop flow (batch cards like Grinding) ======================= */
const ALERT_SECONDS = 300;
const fmtDT = (c) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s')`;

// PENDING = ready, WAITING = batch on hold, RUNNING = started (timer), COMPLETED = saved
async function queue(q) {
  const search = v.clean(q.search);
  const args = [];
  let like = '';
  if (search) { like = ' AND (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.status AS batch_status, b.hold_reason, b.current_output_kg, p.product_name,
            bd.id AS blending_id, bd.total_input_weight, bd.output_weight, bd.wastage_weight, bd.mixing_duration_min,
            ${fmtDT('bd.start_time')} AS start_time, ${fmtDT('bd.end_time')} AS end_time, mc.machine_code, mc.machine_name,
            bs.id AS session_id, bs.machine_id AS s_machine_id, sm.machine_code AS s_machine_code, sm.machine_name AS s_machine_name,
            ${fmtDT('bs.start_time')} AS s_start, bs.expected_minutes AS s_minutes, ${fmtDT('bs.expected_end')} AS s_end, bs.input_weight AS s_input,
            TIMESTAMPDIFF(SECOND, bs.start_time, NOW()) AS s_elapsed, TIMESTAMPDIFF(SECOND, NOW(), bs.expected_end) AS s_remaining,
            su.full_name AS s_started_by
       FROM batch_master b
       JOIN product_master p ON p.id = b.product_id
       LEFT JOIN blending_details bd ON bd.batch_id = b.id AND bd.status = 'COMPLETED'
       LEFT JOIN machine_master mc ON mc.id = bd.machine_id
       LEFT JOIN blending_sessions bs ON bs.batch_id = b.id AND bs.status = 'RUNNING'
       LEFT JOIN machine_master sm ON sm.id = bs.machine_id
       LEFT JOIN users su ON su.id = bs.started_by
      WHERE b.status <> 'CANCELLED'
        AND ((bd.id IS NULL AND b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS','ON_HOLD'))
          OR (bd.id IS NOT NULL AND (b.status IN ('IN_PROGRESS','ON_HOLD') OR bd.start_time >= NOW() - INTERVAL 2 DAY)))${like}
      ORDER BY b.id DESC`, args);
  const ing = {}; const matIds = {};
  (await loadIngredients(pool)).forEach((m) => {
    (ing[m.batch_id] = ing[m.batch_id] || []).push({ material_name: m.material_name, qty: m.qty, percent: m.percent });
    (matIds[m.batch_id] = matIds[m.batch_id] || []).push(m.material_id);
  });
  const planned = {};
  const allIds = [...new Set(Object.values(matIds).flat())];
  if (allIds.length) {
    const [ms] = await pool.query('SELECT id, blending_seconds FROM materials WHERE id IN (?)', [allIds]);
    const bySec = {}; ms.forEach((x) => { bySec[x.id] = Number(x.blending_seconds) || 0; });
    Object.keys(matIds).forEach((bid) => { const mx = Math.max(...matIds[bid].map((id) => bySec[id] || 0)); planned[bid] = mx > 0 ? mx : null; });
  }
  const ORDER = { RUNNING: 0, PENDING: 1, WAITING: 2, COMPLETED: 3 };
  const items = rows.map((r) => {
    const done = !!r.blending_id;
    const running = !done && !!r.session_id;
    const hold = !done && !running && r.batch_status === 'ON_HOLD';
    const list = ing[r.batch_id] || [];
    const sumIn = h.r3(list.reduce((s, x) => s + x.qty, 0));
    return {
      batch_id: r.batch_id, batch_no: r.batch_no, product_name: r.product_name, batch_status: r.batch_status,
      status: done ? 'COMPLETED' : running ? 'RUNNING' : hold ? 'WAITING' : 'PENDING',
      reason: hold ? `Batch is on hold${r.hold_reason ? ` (${r.hold_reason})` : ''}` : '',
      ingredients: list, ingredient_count: list.length,
      planned_seconds: planned[r.batch_id] || null,
      quantity: done ? Number(r.total_input_weight) : running ? Number(r.s_input) : (sumIn || h.r3(Number(r.current_output_kg || 0))),
      blending_id: r.blending_id || null,
      output_weight: done ? Number(r.output_weight) : null, wastage_weight: done ? Number(r.wastage_weight) : null,
      mixing_duration_min: r.mixing_duration_min, start_time: r.start_time, end_time: r.end_time,
      machine_code: r.machine_code, machine_name: r.machine_name,
      session: running ? {
        id: r.session_id, machine_id: r.s_machine_id, machine_code: r.s_machine_code, machine_name: r.s_machine_name,
        start_time: r.s_start, expected_minutes: Number(r.s_minutes), expected_end: r.s_end, input_weight: Number(r.s_input),
        elapsed_sec: Number(r.s_elapsed), remaining_sec: Number(r.s_remaining), started_by_name: r.s_started_by,
      } : null,
    };
  }).sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.batch_id - a.batch_id));

  const counts = { ALL: items.length, PENDING: 0, WAITING: 0, RUNNING: 0, COMPLETED: 0, DELAYED: 0 };
  items.forEach((i) => { counts[i.status] += 1; if (i.status === 'RUNNING' && i.session.remaining_sec < 0) counts.DELAYED += 1; });

  const [mach] = await pool.query(
    `SELECT m.id, m.machine_code, m.machine_name, r.batch_no
       FROM machine_master m
       LEFT JOIN (SELECT s.machine_id, b.batch_no FROM blending_sessions s JOIN batch_master b ON b.id = s.batch_id WHERE s.status = 'RUNNING') r ON r.machine_id = m.id
      WHERE m.machine_type = 'BLENDING' AND m.status IN ('ACTIVE','IDLE') ORDER BY m.machine_code`);
  return {
    items, counts,
    machines: mach.filter((m) => !m.batch_no).map((m) => ({ id: m.id, machine_code: m.machine_code, machine_name: m.machine_name })),
    busy_machines: mach.filter((m) => m.batch_no).map((m) => ({ id: m.id, machine_code: m.machine_code, machine_name: m.machine_name, batch_no: m.batch_no })),
  };
}

/* ---------- Start: machine + start time + duration. The timer is worked out by the database. ---------- */
async function start(body, userId, ip) {
  if (!body.batch_id) throw new AppError('Batch is required');
  if (!body.machine_id) throw new AppError('Select a machine');
  const batchId = v.toId(body.batch_id, 'batch');
  const machineId = v.toId(body.machine_id, 'machine');
  const time = h.reqTime(body.start_time, 'Start time');
   const manualMinutes = body.expected_minutes === undefined || body.expected_minutes === null || body.expected_minutes === '' ? null : Number(body.expected_minutes);
  if (manualMinutes !== null && (!Number.isInteger(manualMinutes) || manualMinutes < 1 || manualMinutes > 1440)) throw new AppError('Expected duration must be a whole number of minutes between 1 and 1440');
  const reason = v.optStr(body.duration_reason, 'Reason', 255);

  return withTransaction(async (conn) => {
    // the machine row is locked first, so two users cannot take the same machine at the same moment
    const [[mc]] = await conn.query('SELECT id, machine_name, machine_type, status FROM machine_master WHERE id = ? FOR UPDATE', [machineId]);
    if (!mc) throw new AppError('Selected machine does not exist', 404);
    if (mc.machine_type !== 'BLENDING') throw new AppError(`${mc.machine_name} is not a blending machine`);
    if (!['ACTIVE', 'IDLE'].includes(mc.status)) throw new AppError(`${mc.machine_name} is ${mc.status.replace(/_/g, ' ').toLowerCase()} and cannot be used`);
    const [busy] = await conn.query(
      "SELECT b.batch_no FROM blending_sessions s JOIN batch_master b ON b.id = s.batch_id WHERE s.machine_id = ? AND s.status = 'RUNNING' LIMIT 1", [machineId]);
    if (busy.length) throw new AppError(`${mc.machine_name} is busy: ${busy[0].batch_no} is being blended on it. Choose another machine`, 409);

    const batch = await h.lockBatch(conn, batchId, 'BLENDING');
    if (batch.status === 'ON_HOLD') throw new AppError(`Batch ${batch.batch_no} is on hold${batch.hold_reason ? ` (${batch.hold_reason})` : ''}. Resume it first`, 409);
    const [run] = await conn.query("SELECT id FROM blending_sessions WHERE batch_id = ? AND status = 'RUNNING' LIMIT 1", [batchId]);
    if (run.length) throw new AppError(`Blending of ${batch.batch_no} is already running`, 409);

    const input = h.r3((await loadIngredients(conn, batchId)).reduce((s, l) => s + l.qty, 0));
    if (!(input > 0)) throw new AppError('No ingredient weights found for this batch. It needs batching weights or a recipe');
          // duration: configured (Material Master, longest of the ingredients) -> selected by the worker. Both are saved separately.
    const matIds = (await loadIngredients(conn, batchId)).map((l) => l.material_id);
    const cfgSec = await configuredSeconds(conn, matIds);
    const cfgMin = cfgSec ? Math.max(Math.ceil(cfgSec / 60), 1) : null;
    if (!cfgSec && !manualMinutes) throw new AppError('No blending time is configured for this batch. Enter the duration in minutes');
    const minutes = manualMinutes || cfgMin;
    const changed = !!cfgMin && minutes !== cfgMin;
    if (changed && !reason) throw new AppError('Enter the reason for changing the duration');
    const selectedSec = changed || !cfgSec ? minutes * 60 : cfgSec;
      const [[n]] = await conn.query(
      "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS d, DATE_FORMAT(NOW(), '%H:%i') AS hm, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS full");
    // the start time field only has hours:minutes. When it is the current minute (the default),
    // use the exact current second, otherwise the timer would already show up to 59 seconds
    const startStr = time === n.hm ? n.full : `${n.d} ${time}:00`;
       const [[fut]] = await conn.query('SELECT (? > NOW() + INTERVAL ? MINUTE) AS fut', [startStr, START_TOLERANCE_MIN]);
    if (Number(fut.fut)) throw new AppError('Start time cannot be later than the current time');

    const [r] = await conn.query(
      `INSERT INTO blending_sessions (batch_id, machine_id, input_weight, start_time, expected_minutes, expected_end, status, started_by, configured_seconds, selected_seconds, duration_reason)
       VALUES (?,?,?,?,?,DATE_ADD(?, INTERVAL ? SECOND),'RUNNING',?,?,?,?)`,
      [batchId, machineId, input, startStr, minutes, startStr, selectedSec, userId, cfgSec, selectedSec, changed ? reason : null]);
    await audit({ userId, action: 'CREATE', table: 'blending_sessions', recordId: r.insertId,
      newValues: { batch_id: batchId, machine_id: machineId, start_time: startStr, expected_minutes: minutes, input_weight: input ,configured_seconds: cfgSec, selected_seconds: selectedSec, duration_reason: reason}, ip }, conn);
    return { id: r.insertId, batch_no: batch.batch_no, input_weight: input, start_time: startStr, expected_minutes: minutes };
  });
}

/* ---------- Stop / Complete: total blended weight + remarks. Saves the blending and moves the batch to Packing. ---------- */
async function stop(body, userId, ip) {
  if (!body.session_id) throw new AppError('Blending record is required');
  const sessionId = v.toId(body.session_id, 'blending record');
  const out = v.num(body.output_weight, 'Blended output weight', { max: 999999 });
  if (!(out > 0)) throw new AppError('Enter the total blended weight (kg)');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);

  return withTransaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM blending_sessions WHERE id = ? FOR UPDATE', [sessionId]);
    if (!row) throw new AppError('Blending record not found', 404);
    if (row.status !== 'RUNNING') throw new AppError('This blending is already completed', 409);
    // the end time is taken by the database at this moment (never typed by the user)
    const [[t]] = await conn.query(
      `SELECT DATE_FORMAT(start_time, '%Y-%m-%d') AS entry_date, DATE_FORMAT(start_time, '%H:%i') AS clock,
              ROUND(TIMESTAMPDIFF(SECOND, start_time, GREATEST(NOW(), start_time)) / 60, 2) AS mins
         FROM blending_sessions WHERE id = ?`, [sessionId]);

    const result = await saveBlending(conn, {
      batch_id: row.batch_id, recipe_id: null, machine_id: row.machine_id, keep_machine: true,
      entry_date: t.entry_date, start_clock: t.clock, mixing_duration_min: Math.max(Math.round(Number(t.mins)), 0),
      done_by: userId, checked_by: null, remarks, output_weight: out,
    }, userId, ip);

    await conn.query(
      `UPDATE blending_sessions SET actual_end = GREATEST(NOW(), start_time), actual_minutes = ?, output_weight = ?, status = 'COMPLETED',
              completed_by = ?, remarks = ?, blending_id = ? WHERE id = ?`, [Number(t.mins), out, userId, remarks, result.id, sessionId]);
    await audit({ userId, action: 'UPDATE', table: 'blending_sessions', recordId: sessionId,
      oldValues: { status: 'RUNNING' }, newValues: { status: 'COMPLETED', output_weight: out, blending_id: result.id }, ip }, conn);
    return { ...result, session_id: sessionId, batch_moved: { to: 'PACKING', weight_kg: out } };
  });
}

module.exports = { lookups, create, list, get, queue, start, stop };