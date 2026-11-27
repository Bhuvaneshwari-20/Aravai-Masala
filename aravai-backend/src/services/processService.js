// Material-wise card workflow for Filtering, Roasting and Grinding.
//   * every material of a batch has its own card (= its own process_sessions row per process)
//   * a machine runs one material at a time (checked here under row locks AND by the unique keys of process_sessions)
//   * the timer is worked out by the database from the saved start time, so it survives refresh / navigation
//   * the machine is released only when Stop / Complete is saved
//   * Sequential : Batching -> Filtering -> "Proceed to Roasting?" -> Roasting -> Grinding
//   * Simultaneous: Filtering and Roasting are independent -> both done -> Grinding
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const v = require('../utils/validate');
const { r2, r3, reqTime } = require('../utils/productionHelpers');

const TYPES = {
  FILTERING: { label: 'Filtering', machine: 'FILTERING', stages: ['FILTERING', 'ROASTING'] },
  ROASTING: { label: 'Roasting', machine: 'ROASTING', stages: ['FILTERING', 'ROASTING'] },
  GRINDING: { label: 'Grinding', machine: 'GRINDING', stages: ['FILTERING', 'ROASTING', 'GRINDING'] },
};
const ALERT_SECONDS = 300; 
const START_TOLERANCE_MIN = Math.max(Number(process.env.START_TIME_TOLERANCE_MIN) || 10, 0);   // phone clock may be a few minutes ahead of the server// 5 minutes before the expected completion
const fmtDT = (c) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s')`;

const SESSION_SELECT = `
  SELECT s.id, s.batch_id, s.material_id, s.process_type, s.machine_id, s.input_weight, s.output_weight,
         ${fmtDT('s.start_time')} AS start_time, s.expected_minutes, ${fmtDT('s.expected_end')} AS expected_end,
         ${fmtDT('s.actual_end')} AS actual_end, s.actual_minutes, s.status, s.alert_sent,
         (s.proceeded_at IS NOT NULL) AS proceeded, ${fmtDT('s.proceeded_at')} AS proceeded_at, s.remarks,
         TIMESTAMPDIFF(SECOND, s.start_time, NOW()) AS elapsed_sec,
         TIMESTAMPDIFF(SECOND, NOW(), s.expected_end) AS remaining_sec,
         m.machine_code, m.machine_name, su.full_name AS started_by_name, cu.full_name AS completed_by_name,
         b.batch_no, p.product_name, mt.material_code, mt.material_name
    FROM process_sessions s
    JOIN machine_master m ON m.id = s.machine_id
    JOIN batch_master b ON b.id = s.batch_id
    JOIN product_master p ON p.id = b.product_id
    JOIN materials mt ON mt.id = s.material_id
    JOIN users su ON su.id = s.started_by
    LEFT JOIN users cu ON cu.id = s.completed_by`;

const shapeSession = (s) => (s ? {
  ...s, input_weight: Number(s.input_weight), output_weight: s.output_weight == null ? null : Number(s.output_weight),
  actual_minutes: s.actual_minutes == null ? null : Number(s.actual_minutes), alert_sent: !!s.alert_sent, proceeded: !!s.proceeded,
  elapsed_sec: Number(s.elapsed_sec), remaining_sec: Number(s.remaining_sec),
} : null);

async function getSession(db, id) {
  const [rows] = await db.query(`${SESSION_SELECT} WHERE s.id = ?`, [id]);
  if (!rows.length) throw new AppError('Processing record not found', 404);
  return shapeSession(rows[0]);
}

/* ---------- state of every material of the given batches ---------- */
async function loadContext(db, batchIds) {
  const out = new Map();
  if (!batchIds.length) return out;
  const [bs] = await db.query(
    `SELECT b.id, b.batch_no, b.status, b.hold_reason, b.current_stage, b.process_mode, b.current_output_kg, p.product_name, r.recipe_no
       FROM batch_master b JOIN product_master p ON p.id = b.product_id LEFT JOIN recipe_master r ON r.id = b.recipe_id WHERE b.id IN (?)`, [batchIds]);
  bs.forEach((b) => out.set(b.id, { ...b, materials: [] }));
  const [mats] = await db.query(
    `SELECT bd.batch_id, bd.material_id, m.material_code, m.material_name, SUM(bd.weighed_qty) AS weighed, MAX(bd.needs_filtering) AS needs
       FROM batching_details bd JOIN materials m ON m.id = bd.material_id WHERE bd.batch_id IN (?)
      GROUP BY bd.batch_id, bd.material_id, m.material_code, m.material_name ORDER BY MIN(bd.id)`, [batchIds]);
  const byKey = new Map();
  mats.forEach((x) => {
    const m = { material_id: x.material_id, material_code: x.material_code, material_name: x.material_name, weighed: Number(x.weighed), needs: Number(x.needs) === 1, s: {} };
    byKey.set(`${x.batch_id}:${x.material_id}`, m);
    if (out.has(x.batch_id)) out.get(x.batch_id).materials.push(m);
  });
  const [sess] = await db.query(`${SESSION_SELECT} WHERE s.batch_id IN (?) AND s.status <> 'CANCELLED' ORDER BY s.id`, [batchIds]);
  sess.forEach((s) => { const m = byKey.get(`${s.batch_id}:${s.material_id}`); if (m) m.s[s.process_type] = shapeSession(s); });

  // entries saved with the OLD Filtering / Roasting forms count as completed (so running batches are not stuck)
  try {
    const [lf] = await db.query(
      `SELECT f.batch_id, fm.material_id, fm.output_weight, fm.input_weight FROM filtering_materials fm JOIN filtering_details f ON f.id = fm.filtering_id WHERE f.batch_id IN (?)`, [batchIds]);
    lf.forEach((x) => { const m = byKey.get(`${x.batch_id}:${x.material_id}`); if (m && !m.s.FILTERING) m.s.FILTERING = { status: 'COMPLETED', legacy: true, proceeded: true, input_weight: Number(x.input_weight), output_weight: Number(x.output_weight) }; });
  } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  const [lr] = await db.query(
    `SELECT batch_id, material_id, SUM(input_weight) AS i, SUM(output_weight) AS o FROM roasting_details WHERE batch_id IN (?) AND status = 'COMPLETED' AND material_id IS NOT NULL GROUP BY batch_id, material_id`, [batchIds]);
  lr.forEach((x) => { const m = byKey.get(`${x.batch_id}:${x.material_id}`); if (m && !m.s.ROASTING) m.s.ROASTING = { status: 'COMPLETED', legacy: true, input_weight: Number(x.i), output_weight: Number(x.o) }; });
  return out;
}

const done = (m, t) => !!(m.s[t] && m.s[t].status === 'COMPLETED');

// What a material's card for `type` looks like right now.
//   SEQUENTIAL   (Filtering first): Roasting of EVERY material (filtered or direct) starts only after Filtering is completed for the whole batch.
//   SIMULTANEOUS : Filtering (materials ticked "Filter") and Roasting (direct materials) run at the same time. A filtered material joins
//                  Roasting as soon as ITS OWN Filtering is completed, so one material is never filtered and roasted at the same moment.
//   BOTH         : Grinding of a batch starts only when every required Filtering AND every Roasting of the batch is completed.
function evalCard(b, m, type) {
  const seq = b.process_mode !== 'SIMULTANEOUS';
  const s = m.s[type];
  const fs = m.s.FILTERING; const rs = m.s.ROASTING;
  const filterPending = b.materials.some((x) => x.needs && !done(x, 'FILTERING'));                          // a Filtering is still to be completed
  const upstreamPending = b.materials.some((x) => !done(x, 'ROASTING') || (x.needs && !done(x, 'FILTERING'))); // any Filtering or Roasting still pending
  let input = m.weighed;
  if (type === 'ROASTING' && m.needs && done(m, 'FILTERING')) input = Number(fs.output_weight);           // roast what Filtering handed over
  if (type === 'GRINDING') input = done(m, 'ROASTING') ? Number(rs.output_weight) : null;
  if (type === 'FILTERING' && !m.needs) return null;                                                      // only materials ticked "Filter" get a Filtering card

  if (s && s.status === 'RUNNING') return { status: 'RUNNING', input, session: s };
  if (s && s.status === 'COMPLETED') {
    const awaiting = type === 'FILTERING' && seq && !s.legacy && !s.proceeded && !(m.s.ROASTING);
    return { status: 'COMPLETED', input: s.input_weight, session: s.legacy ? null : s, awaiting_proceed: awaiting };
  }
  let status = 'PENDING'; let reason = '';
  if (type === 'ROASTING') {
    if (seq) {
      if (filterPending) { status = 'WAITING'; reason = 'Sequential batch: Roasting starts after Filtering of the whole batch is completed'; }
      else if (m.needs && !fs.proceeded) { status = 'WAITING'; reason = 'Filtering is done. Confirm "Proceed to Roasting" on the Filtering card'; }
    } else if (m.needs && !done(m, 'FILTERING')) {
      status = 'WAITING'; reason = m.s.FILTERING ? 'This material is still being filtered. It can be roasted after its Filtering' : 'This material must be filtered first. It can be roasted after its Filtering';
    }
  }
  if (type === 'GRINDING' && upstreamPending) {
    status = 'WAITING'; reason = 'Grinding starts only after all Filtering and Roasting of this batch are completed';
  }
  if (status === 'PENDING' && b.status === 'ON_HOLD') { status = 'WAITING'; reason = `Batch is on hold${b.hold_reason ? ` (${b.hold_reason})` : ''}`; }
  return { status, reason, input, session: null };
}

function toCard(b, m, type, ev) {
  const s = ev.session;
  return {
    key: `${b.id}:${m.material_id}:${type}`, process_type: type,
    batch_id: b.id, batch_no: b.batch_no, product_name: b.product_name, process_mode: b.process_mode === 'SIMULTANEOUS' ? 'SIMULTANEOUS' : 'SEQUENTIAL',
    material_id: m.material_id, material_code: m.material_code, material_name: m.material_name,
    quantity: ev.input == null ? null : r3(ev.input), status: ev.status, reason: ev.reason || '', awaiting_proceed: !!ev.awaiting_proceed,
    delayed: ev.status === 'RUNNING' && s.remaining_sec < 0, batch_status: b.status,
    session: s ? { id: s.id, machine_id: s.machine_id, machine_code: s.machine_code, machine_name: s.machine_name, start_time: s.start_time, expected_minutes: s.expected_minutes,
      expected_end: s.expected_end, actual_end: s.actual_end, actual_minutes: s.actual_minutes, elapsed_sec: s.elapsed_sec, remaining_sec: s.remaining_sec,
      alert_sent: s.alert_sent, output_weight: s.output_weight, started_by_name: s.started_by_name, completed_by_name: s.completed_by_name } : null,
  };
}

const ORDER = { RUNNING: 0, PENDING: 1, WAITING: 2, COMPLETED: 3 };

/* ---------- queue (all material cards of a process) ---------- */
async function queue(type, q) {
  const cfg = TYPES[type];
  const search = v.clean(q.search);
  const args = [cfg.stages,type];
  let like = '';
  if (search) {
    like = ` AND (b.batch_no LIKE ? OR p.product_name LIKE ? OR EXISTS (SELECT 1 FROM batching_details bd JOIN materials m ON m.id = bd.material_id WHERE bd.batch_id = b.id AND m.material_name LIKE ?))`;
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
    // Batches at this stage, PLUS batches that already moved on but still have COMPLETED cards of this process
  // (while the batch is in production, or for 2 days after it finished)
  const [batches] = await pool.query(
    `SELECT b.id FROM batch_master b JOIN product_master p ON p.id = b.product_id
      WHERE ((b.status IN ('IN_PROGRESS','ON_HOLD') AND b.current_stage IN (?))
          OR EXISTS (SELECT 1 FROM process_sessions ps WHERE ps.batch_id = b.id AND ps.process_type = ? AND ps.status = 'COMPLETED'
                      AND b.status <> 'CANCELLED' AND (b.status IN ('IN_PROGRESS','ON_HOLD') OR ps.actual_end >= NOW() - INTERVAL 2 DAY)))${like}
      ORDER BY b.id DESC`, args);
  const ctx = await loadContext(pool, batches.map((b) => b.id));
  const items = [];
  batches.forEach(({ id }) => {
    const b = ctx.get(id);
    if (!b) return;
    const here = cfg.stages.includes(b.current_stage); // batch already moved on -> only its COMPLETED cards are shown
    b.materials.forEach((m) => { const ev = evalCard(b, m, type); if (ev && (here || ev.status === 'COMPLETED')) items.push(toCard(b, m, type, ev)); });
  });
  items.sort((a, c) => (ORDER[a.status] - ORDER[c.status]) || (c.batch_id - a.batch_id));
  const counts = { ALL: items.length, PENDING: 0, WAITING: 0, RUNNING: 0, COMPLETED: 0, DELAYED: 0 };
  items.forEach((i) => { counts[i.status] += 1; if (i.delayed) counts.DELAYED += 1; });

  const [mach] = await pool.query(
    `SELECT m.id, m.machine_code, m.machine_name, r.batch_no, r.material_name
       FROM machine_master m
       LEFT JOIN (SELECT s.machine_id, b.batch_no, mt.material_name FROM process_sessions s JOIN batch_master b ON b.id = s.batch_id
                    JOIN materials mt ON mt.id = s.material_id WHERE s.status = 'RUNNING') r ON r.machine_id = m.id
      WHERE m.machine_type = ? AND m.status IN ('ACTIVE','IDLE') ORDER BY m.machine_code`, [cfg.machine]);
  return {
    process_type: type, label: cfg.label, items, counts,
    machines: mach.filter((m) => !m.batch_no).map((m) => ({ id: m.id, machine_code: m.machine_code, machine_name: m.machine_name })),
    busy_machines: mach.filter((m) => m.batch_no).map((m) => ({ id: m.id, machine_code: m.machine_code, machine_name: m.machine_name, batch_no: m.batch_no, material_name: m.material_name })),
  };
}

/* ---------- Start ---------- */
async function start(type, body, user, ip) {
  const cfg = TYPES[type];
  if (!body.batch_id || !body.material_id) throw new AppError('Batch and material are required');
  if (!body.machine_id) throw new AppError('Select a machine');
  const batchId = v.toId(body.batch_id, 'batch');
  const materialId = v.toId(body.material_id, 'material');
  const machineId = v.toId(body.machine_id, 'machine');
  const time = reqTime(body.start_time, 'Start time');
  const minutes = Number(body.expected_minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new AppError('Expected duration must be a whole number of minutes between 1 and 1440');

  return withTransaction(async (conn) => {
    // 1) the machine row is locked first, so two users cannot take the same machine at the same moment
    const [[mc]] = await conn.query('SELECT id, machine_code, machine_name, machine_type, status FROM machine_master WHERE id = ? FOR UPDATE', [machineId]);
    if (!mc) throw new AppError('Selected machine does not exist', 404);
    if (mc.machine_type !== cfg.machine) throw new AppError(`${mc.machine_name} is not a ${cfg.label.toLowerCase()} machine`);
    if (!['ACTIVE', 'IDLE'].includes(mc.status)) throw new AppError(`${mc.machine_name} is ${mc.status.replace(/_/g, ' ').toLowerCase()} and cannot be used`);
    const [busy] = await conn.query(
      `SELECT b.batch_no, mt.material_name FROM process_sessions s JOIN batch_master b ON b.id = s.batch_id JOIN materials mt ON mt.id = s.material_id
        WHERE s.machine_id = ? AND s.status = 'RUNNING' LIMIT 1`, [machineId]);
    if (busy.length) throw new AppError(`${mc.machine_name} is busy: ${busy[0].material_name} (${busy[0].batch_no}) is running on it. Choose another machine`, 409);

    // 2) batch + material must be ready for this process
    const [[bm]] = await conn.query('SELECT id, status, current_stage, batch_no FROM batch_master WHERE id = ? FOR UPDATE', [batchId]);
    if (!bm) throw new AppError('Batch not found', 404);
    if (bm.status !== 'IN_PROGRESS') throw new AppError(`Batch ${bm.batch_no} is ${String(bm.status).toLowerCase().replace('_', ' ')}`, 409);
    if (!cfg.stages.includes(bm.current_stage)) throw new AppError(`Batch ${bm.batch_no} is at the ${bm.current_stage} stage`, 409);
    // Grinding is a batch-level gate: not even one required Filtering / Roasting may be pending
    if (type === 'GRINDING' && bm.current_stage !== 'GRINDING') throw new AppError(`Batch ${bm.batch_no}: Grinding starts only after all Filtering and Roasting are completed`, 409);
    const b = (await loadContext(conn, [batchId])).get(batchId);
    const m = b.materials.find((x) => x.material_id === materialId);
    if (!m) throw new AppError('This material is not part of the batch', 404);
    const ev = evalCard(b, m, type);
    if (!ev) throw new AppError(`${m.material_name} is not marked for ${cfg.label.toLowerCase()}`, 409);
    if (ev.status === 'RUNNING') throw new AppError(`${m.material_name} is already running`, 409);
    if (ev.status === 'COMPLETED') throw new AppError(`${m.material_name} is already completed. Saved records cannot be started again`, 409);
    if (ev.status !== 'PENDING') throw new AppError(ev.reason || `${m.material_name} is not ready yet`, 409);
    if (!(ev.input > 0)) throw new AppError('There is no quantity to process for this material');

    // 3) start time chosen by the user (today). It cannot be in the future.
    const [[d]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS d");
    const startStr = `${d.d} ${time}:00`;
    const [[fut]] = await conn.query('SELECT (? > NOW() + INTERVAL ? MINUTE) AS fut', [startStr, START_TOLERANCE_MIN]);
    if (Number(fut.fut)) throw new AppError('Start time cannot be later than the current time');

    let id;
    try {
      const [r] = await conn.query(
        `INSERT INTO process_sessions (batch_id, material_id, process_type, machine_id, input_weight, start_time, expected_minutes, expected_end, status, started_by)
         VALUES (?,?,?,?,?,?,?,DATE_ADD(?, INTERVAL ? MINUTE),'RUNNING',?)`,
        [batchId, materialId, type, machineId, ev.input, startStr, minutes, startStr, minutes, user.id]);
      id = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError('This machine or this material was just started by someone else. Reload and try again', 409);
      throw e;
    }
    await audit({ userId: user.id, action: 'CREATE', table: 'process_sessions', recordId: id,
      newValues: { process: type, batch_id: batchId, material_id: materialId, machine_id: machineId, start_time: startStr, expected_minutes: minutes, input_weight: ev.input }, ip }, conn);
    return getSession(conn, id);
  });
}

/* ---------- Stop / Complete ---------- */
async function stop(type, body, user, ip) {
  const cfg = TYPES[type];
  if (!body.session_id) throw new AppError('Processing record is required');
  const sessionId = v.toId(body.session_id, 'processing record');
  const out = Number(body.output_weight);
  if (!(out > 0)) throw new AppError('Enter the O/P weight (kg)');
  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 255) : null;

  return withTransaction(async (conn) => {
    const [[row]] = await conn.query('SELECT * FROM process_sessions WHERE id = ? FOR UPDATE', [sessionId]);
    if (!row || row.process_type !== type) throw new AppError('Processing record not found', 404);
    if (row.status !== 'RUNNING') throw new AppError('This process is already completed', 409);
    const [[bm]] = await conn.query('SELECT id, batch_no, current_stage, current_output_kg, process_mode FROM batch_master WHERE id = ? FOR UPDATE', [row.batch_id]);
    const input = Number(row.input_weight);
    if (out > input + 0.0005) throw new AppError(`O/P weight cannot be more than I/P weight (${input} kg)`);
    const output = r3(out);

    // type specific input
    let mesh = null; let sieved = 'NO'; const temps = {};
    if (type === 'GRINDING') {
      if (!body.mesh_id) throw new AppError('Select the mesh size');
      const [[ms]] = await conn.query('SELECT id, mesh_size FROM mesh_master WHERE id = ?', [Number(body.mesh_id)]);
      if (!ms) throw new AppError('Select the mesh size from the list');
      mesh = ms;
      sieved = String(body.sieved || 'NO').toUpperCase() === 'YES' ? 'YES' : 'NO';
    }
    if (type === 'ROASTING') {
      ['temp_before', 'std_temp', 'temp_after'].forEach((k) => {
        const raw = body[k];
        if (raw === undefined || raw === null || raw === '') { temps[k] = null; return; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 600) throw new AppError('Temperature must be between 0 and 600 °C');
        temps[k] = Math.round(n * 10) / 10;
      });
    }

    // the end time is taken by the database at this moment (never typed by the user)
    await conn.query(
      `UPDATE process_sessions SET actual_end = GREATEST(NOW(), start_time), actual_minutes = ROUND(TIMESTAMPDIFF(SECOND, start_time, GREATEST(NOW(), start_time)) / 60, 2),
         output_weight = ?, status = 'COMPLETED', completed_by = ?, remarks = ? WHERE id = ?`, [output, user.id, remarks, sessionId]);
    const s = await getSession(conn, sessionId);
    const secs = Math.max(Math.round((new Date(s.actual_end.replace(' ', 'T')) - new Date(s.start_time.replace(' ', 'T'))) / 1000), 0);
    const waste = r3(input - output);
    const loss = r2((waste / input) * 100);
    const date = s.start_time.slice(0, 10);

    // the same facts are kept in the classic tables, so reports and the next stages keep working
    if (type === 'FILTERING') {
      const [f] = await conn.query(
        `INSERT INTO filtering_details (batch_id, filter_date, stages, input_weight, output_weight, wastage_weight, loss_percent, start_time, end_time, done_by, checked_by, remarks)
         VALUES (?,?,1,?,?,?,?,?,?,?,?,?)`, [row.batch_id, date, input, output, waste, loss, s.start_time, s.actual_end, user.id, user.id, remarks]);
      await conn.query(
        `INSERT INTO filtering_materials (filtering_id, material_id, input_weight, output_weight, wastage_weight, loss_percent, start_time, end_time) VALUES (?,?,?,?,?,?,?,?)`,
        [f.insertId, row.material_id, input, output, waste, loss, s.start_time, s.actual_end]);
      if (bm.process_mode !== 'SIMULTANEOUS') {   // sequential: Roasting works on what Filtering handed over
        await conn.query('UPDATE batch_master SET current_output_kg = GREATEST(current_output_kg - ?, 0), total_wastage_kg = total_wastage_kg + ? WHERE id = ?', [waste, waste, row.batch_id]);
      }
    } else if (type === 'ROASTING') {
      const [[rc]] = await conn.query('SELECT r.recipe_no FROM batch_master b LEFT JOIN recipe_master r ON r.id = b.recipe_id WHERE b.id = ?', [row.batch_id]);
      await conn.query(
        `INSERT INTO roasting_details (batch_id, material_id, roast_date, machine_id, code_no, input_weight, output_weight, temp_before, std_temp, temp_after,
           start_time, end_time, running_hours, wastage_weight, loss_percent, remarks, status, operator_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'COMPLETED',?)`,
        [row.batch_id, row.material_id, date, row.machine_id, rc && rc.recipe_no ? String(rc.recipe_no).toUpperCase() : null, input, output, temps.temp_before, temps.std_temp, temps.temp_after,
          s.start_time, s.actual_end, r2(secs / 3600), waste, loss, remarks, user.id]);
    } else {
      const [[hc]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'grinding_details' AND column_name = 'mesh_id'");
      const withMesh = Number(hc.n) > 0;
      await conn.query(
        `INSERT INTO grinding_details (batch_id, grind_date, machine_id, mesh_size, ${withMesh ? 'mesh_id, ' : ''}input_weight, output_weight, siever, input_time, output_time,
           wastage_weight, loss_percent, operator_id, remarks, status) VALUES (?,?,?,?,${withMesh ? '?,' : ''}?,?,?,?,?,?,?,?,?,'COMPLETED')`,
        [row.batch_id, date, row.machine_id, String(mesh.mesh_size), ...(withMesh ? [mesh.id] : []), input, output, sieved, s.start_time, s.actual_end, waste, loss, user.id,
          `${s.material_name}${remarks ? ` - ${remarks}` : ''}`.slice(0, 255)]);
    }

    const moved = await advanceBatch(conn, row.batch_id, user, ip);
    await audit({ userId: user.id, action: 'UPDATE', table: 'process_sessions', recordId: sessionId,
      oldValues: { status: 'RUNNING' }, newValues: { status: 'COMPLETED', process: type, output_weight: output, actual_end: s.actual_end, batch_moved: moved }, ip }, conn);
    return { ...s, batch_moved: moved };
  });
}

// The batch follows its materials: Filtering done -> Roasting, all roasted -> Grinding, all ground -> Blending.
async function advanceBatch(conn, batchId, user, ip) {
  const b = (await loadContext(conn, [batchId])).get(batchId);
  let stage = b.current_stage; let moved = null;
  const mats = b.materials;
  if (!mats.length) return null;
  if (stage === 'FILTERING' && !mats.some((m) => m.needs && !done(m, 'FILTERING'))) {
    await conn.query("UPDATE batch_master SET current_stage = 'ROASTING' WHERE id = ?", [batchId]);
    stage = 'ROASTING'; moved = { to: 'ROASTING' };
  }
  const sumOut = (t) => r3(mats.reduce((a, m) => a + (done(m, t) ? Number(m.s[t].output_weight) : 0), 0));
  if (['FILTERING', 'ROASTING'].includes(stage) && mats.every((m) => done(m, 'ROASTING') && (!m.needs || done(m, 'FILTERING')))) {
    const held = Number(b.current_output_kg); const outKg = sumOut('ROASTING'); const loss = Math.max(r3(held - outKg), 0);
    await conn.query("UPDATE batch_master SET current_stage = 'GRINDING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?", [outKg, loss, batchId]);
    await audit({ userId: user.id, action: 'UPDATE', table: 'batch_master', recordId: batchId, oldValues: { current_stage: stage, current_output_kg: held },
      newValues: { current_stage: 'GRINDING', current_output_kg: outKg }, ip }, conn);
    stage = 'GRINDING'; moved = { to: 'GRINDING', weight_kg: outKg };
  }
  if (stage === 'GRINDING' && mats.every((m) => done(m, 'GRINDING'))) {
    const [[cur]] = await conn.query('SELECT current_output_kg FROM batch_master WHERE id = ?', [batchId]);
    const held = Number(cur.current_output_kg); const outKg = sumOut('GRINDING'); const loss = Math.max(r3(held - outKg), 0);
    await conn.query("UPDATE batch_master SET current_stage = 'BLENDING', current_output_kg = ?, total_wastage_kg = total_wastage_kg + ? WHERE id = ?", [outKg, loss, batchId]);
    await audit({ userId: user.id, action: 'UPDATE', table: 'batch_master', recordId: batchId, oldValues: { current_stage: 'GRINDING', current_output_kg: held },
      newValues: { current_stage: 'BLENDING', current_output_kg: outKg }, ip }, conn);
    moved = { to: 'BLENDING', weight_kg: outKg };
  }
  return moved;
}

/* ---------- Sequential mode: "Proceed to Roasting?" -> Yes ---------- */
async function proceed(body, user, ip) {
  if (!body.batch_id || !body.material_id) throw new AppError('Batch and material are required');
  const batchId = v.toId(body.batch_id, 'batch');
  const materialId = v.toId(body.material_id, 'material');
  return withTransaction(async (conn) => {
    const [[bm]] = await conn.query('SELECT status, process_mode, batch_no FROM batch_master WHERE id = ? FOR UPDATE', [batchId]);
    if (!bm) throw new AppError('Batch not found', 404);
    if (bm.process_mode === 'SIMULTANEOUS') throw new AppError('This batch runs Filtering and Roasting simultaneously. No confirmation is needed');
    const [[s]] = await conn.query(
      `SELECT id, proceeded_at FROM process_sessions WHERE batch_id = ? AND material_id = ? AND process_type = 'FILTERING' AND status = 'COMPLETED' ORDER BY id DESC LIMIT 1 FOR UPDATE`, [batchId, materialId]);
    if (!s) throw new AppError('Filtering is not completed for this material yet', 409);
    if (!s.proceeded_at) {
      await conn.query('UPDATE process_sessions SET proceeded_at = NOW(), proceeded_by = ? WHERE id = ?', [user.id, s.id]);
      await audit({ userId: user.id, action: 'UPDATE', table: 'process_sessions', recordId: s.id, newValues: { proceed_to_roasting: true }, ip }, conn);
    }
    return { batch_id: batchId, material_id: materialId, proceeded: true };
  });
}

/* ---------- 5-minute alert: fires once per processing session ---------- */
async function alertDue(type, body) {
  const id = v.toId(body.session_id, 'processing record');
  const [r] = await pool.query(
    `UPDATE process_sessions SET alert_sent = 1, alert_sent_at = NOW()
      WHERE id = ? AND process_type = ? AND status = 'RUNNING' AND alert_sent = 0 AND TIMESTAMPDIFF(SECOND, NOW(), expected_end) <= ?`, [id, type, ALERT_SECONDS]);
  if (!r.affectedRows) return { fired: false };
  const s = await getSession(pool, id);
  const late = s.remaining_sec <= 0;
  return { fired: true, session_id: id, message: `${TYPES[type].label} Alert: ${s.material_name} on ${s.machine_name} ${late ? 'has reached its expected completion time. Please stop it when it is done.' : 'is expected to complete in 5 minutes.'}` };
}

/* ---------- history: every saved session, never overwritten ---------- */
async function history(type, q) {
  const { page, limit, offset } = v.paging(q);
  const where = ['s.process_type = ?', "s.status = 'COMPLETED'"]; const args = [type];
  const search = v.clean(q.search);
  if (search) { where.push('(b.batch_no LIKE ? OR mt.material_name LIKE ? OR m.machine_name LIKE ?)'); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const w = `WHERE ${where.join(' AND ')}`;
  const J = `FROM process_sessions s JOIN batch_master b ON b.id = s.batch_id JOIN materials mt ON mt.id = s.material_id JOIN machine_master m ON m.id = s.machine_id`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${J} ${w}`, args);
  const [rows] = await pool.query(`${SESSION_SELECT} ${w.replace(/\bs\.process_type/g, 's.process_type')} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows.map(shapeSession), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

module.exports = { TYPES, queue, start, stop, proceed, alertDue, history };