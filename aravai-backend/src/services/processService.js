// Material-wise card workflow for Filtering, Roasting and Grinding.
//   * every material of a batch has its own card (= its own process_sessions row per process)
//   * a machine runs one material at a time (checked here under row locks AND by the unique keys of process_sessions)
//   * the timer is worked out by the database from the saved start time, so it survives refresh / navigation
//   * the machine is released only when Stop / Complete is saved
//   * Sequential : Batching -> Filtering -> "Proceed to Roasting?" -> Roasting -> Grinding
//   * Simultaneous: Filtering and Roasting are independent -> both done -> Grinding
//   * Duration: configured (Material Master, never changed) / manual (optional override) / effective (timer) / actual
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const v = require('../utils/validate');
const { r2, r3, reqTime } = require('../utils/productionHelpers');
const { resolveDuration } = require('../utils/durationHelper');
const rp = require('../utils/roastPairs');   // saved roasting pairs + Sequential / Simultaneous eligibility // saved roasting pairs + Sequential / Simultaneous eligibility

const TYPES = {
  FILTERING: { label: 'Filtering', machine: 'FILTERING', stages: ['FILTERING', 'ROASTING'] },
  ROASTING: { label: 'Roasting', machine: 'ROASTING', stages: ['FILTERING', 'ROASTING'] },
  GRINDING: { label: 'Grinding', machine: 'GRINDING', stages: ['FILTERING', 'ROASTING', 'GRINDING'] },
};
const ALERT_SECONDS = 300; // 5 minutes before the expected completion
const START_TOLERANCE_MIN = Math.max(Number(process.env.START_TIME_TOLERANCE_MIN) || 10, 0);   // phone clock may be a few minutes ahead of the server
const fmtDT = (c) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s')`;

const SESSION_SELECT = `
  SELECT s.id, s.batch_id, s.material_id, s.process_type, s.machine_id, s.input_weight, s.output_weight, s.group_id, s.group_lead,
         ${fmtDT('s.start_time')} AS start_time, s.expected_minutes, ${fmtDT('s.expected_end')} AS expected_end,
         ${fmtDT('s.actual_end')} AS actual_end, s.actual_minutes, s.status, s.alert_sent,
         s.configured_seconds, s.manual_seconds,
         COALESCE(s.effective_seconds, TIMESTAMPDIFF(SECOND, s.start_time, s.expected_end)) AS effective_seconds,
         s.duration_change_reason,
         COALESCE(s.actual_seconds, ROUND(s.actual_minutes * 60)) AS actual_seconds,
         (s.proceeded_at IS NOT NULL) AS proceeded, ${fmtDT('s.proceeded_at')} AS proceeded_at, s.remarks,
         TIMESTAMPDIFF(SECOND, s.start_time, NOW()) AS elapsed_sec,
         TIMESTAMPDIFF(SECOND, NOW(), s.expected_end) AS remaining_sec,
         TIMESTAMPDIFF(SECOND, s.start_time, s.expected_end) AS planned_sec,
         m.machine_code, m.machine_name, su.full_name AS started_by_name, cu.full_name AS completed_by_name,
         b.batch_no, p.product_name, mt.material_code, mt.material_name
    FROM process_sessions s
    JOIN machine_master m ON m.id = s.machine_id
    JOIN batch_master b ON b.id = s.batch_id
    JOIN product_master p ON p.id = b.product_id
    JOIN materials mt ON mt.id = s.material_id
    JOIN users su ON su.id = s.started_by
    LEFT JOIN users cu ON cu.id = s.completed_by`;

const numOrNull = (x) => (x == null ? null : Number(x));
const shapeSession = (s) => (s ? {
  ...s, input_weight: Number(s.input_weight), output_weight: s.output_weight == null ? null : Number(s.output_weight),
  actual_minutes: s.actual_minutes == null ? null : Number(s.actual_minutes), alert_sent: !!s.alert_sent, proceeded: !!s.proceeded,
  elapsed_sec: Number(s.elapsed_sec), remaining_sec: Number(s.remaining_sec), planned_sec: Number(s.planned_sec),
  configured_seconds: numOrNull(s.configured_seconds),
  manual_seconds: numOrNull(s.manual_seconds),
  effective_seconds: numOrNull(s.effective_seconds),
  actual_seconds: numOrNull(s.actual_seconds),
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
    `SELECT bd.batch_id, bd.material_id, m.material_code, m.material_name, SUM(bd.weighed_qty) AS weighed, MAX(bd.needs_filtering) AS needs,
            MIN(bd.process_type) AS ptype,
            MAX(bd.roast_seconds) AS batch_roast_sec, MAX(m.roast_seconds) AS mat_roast_sec,
            MAX(m.filter_seconds) AS mat_filter_sec, MAX(m.grind_seconds) AS mat_grind_sec
       FROM batching_details bd JOIN materials m ON m.id = bd.material_id WHERE bd.batch_id IN (?)
      GROUP BY bd.batch_id, bd.material_id, m.material_code, m.material_name ORDER BY MIN(bd.id)`, [batchIds]);

  // Roasting option (Only Roasting / Roasting with Partner) of each material, from the recipe version the batch was made with.
  const roastOpt = new Map();
  try {
    const [ro] = await db.query(
      `SELECT b.id AS batch_id, d.material_id, d.roast_type FROM batch_master b JOIN recipe_details d ON d.recipe_id = b.recipe_id WHERE b.id IN (?)`, [batchIds]);
    ro.forEach((x) => roastOpt.set(`${x.batch_id}:${x.material_id}`, x.roast_type || null));
  } catch (e) { if (e.code !== 'ER_BAD_FIELD_ERROR') throw e; } // roast_type column not created yet

  const byKey = new Map();
  mats.forEach((x) => {
    const m = {
      material_id: x.material_id, material_code: x.material_code, material_name: x.material_name, weighed: Number(x.weighed), needs: Number(x.needs) === 1,
      roast: x.ptype !== 'FILTER_ONLY', roast_type: roastOpt.get(`${x.batch_id}:${x.material_id}`) || null, s: {},
      // configured durations (seconds). Roasting: the time used in this batch, else the one in Material Master
      roast_seconds: Number(x.batch_roast_sec) > 0 ? Number(x.batch_roast_sec) : (Number(x.mat_roast_sec) > 0 ? Number(x.mat_roast_sec) : null),
      filter_seconds: Number(x.mat_filter_sec) > 0 ? Number(x.mat_filter_sec) : null,
      grind_seconds: Number(x.mat_grind_sec) > 0 ? Number(x.mat_grind_sec) : null,
    };
    byKey.set(`${x.batch_id}:${x.material_id}`, m);
    if (out.has(x.batch_id)) out.get(x.batch_id).materials.push(m);
  });
 // Saved roasting partners (batching_details.roast_partner_of): NULL = old batch -> old rules, 0 = partner material left unpaired, >0 = partner
  try {
    const [pr] = await db.query('SELECT batch_id, material_id, roast_partner_of FROM batching_details WHERE batch_id IN (?) AND roast_partner_of IS NOT NULL', [batchIds]);
    pr.forEach((x) => { const m = byKey.get(`${x.batch_id}:${x.material_id}`); if (m) m.partner_ref = Number(x.roast_partner_of); });
    out.forEach((bb) => rp.linkPairs(bb.materials));
  } catch (e) { if (e.code !== 'ER_BAD_FIELD_ERROR') throw e; } // column not created yet
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
// configured duration (seconds) of this material for the process, or null when none is set
const plannedFor = (m, type) => (type === 'ROASTING' ? m.roast_seconds : type === 'FILTERING' ? m.filter_seconds : m.grind_seconds) || null;
// Roasting with Partner: other materials of the batch that this material could still be roasted together with.
const partnersLeft = (b, m) => b.materials.filter((x) => x.material_id !== m.material_id && x.roast && x.roast_type !== 'ROAST_ONLY'
  && !(x.s.ROASTING && ['RUNNING', 'COMPLETED'].includes(x.s.ROASTING.status)));
// true = this material must be roasted WITH a partner (it cannot start alone while a partner is still possible)
// (old batches only: when the partner was saved with the batch, the server decides and the worker chooses nothing)
const partnerRequired = (b, m) => m.roast_type === 'ROAST_PARTNER' && !rp.isManaged(m) && partnersLeft(b, m).length > 0;

// What a material's card for `type` looks like right now.
//   SEQUENTIAL   (Filtering first): Roasting of EVERY material (filtered or direct) starts only after Filtering is completed for the whole batch.
//   SIMULTANEOUS : Filtering (materials ticked "Filter") and Roasting (direct materials) run at the same time. A filtered material joins
//                  Roasting as soon as ITS OWN Filtering is completed, so one material is never filtered and roasted at the same moment.
//   BOTH         : Grinding of a batch starts only when every required Filtering AND every Roasting of the batch is completed.
function evalCard(b, m, type) {
  const seq = b.process_mode !== 'SIMULTANEOUS';
  const s = m.s[type];
  const fs = m.s.FILTERING; const rs = m.s.ROASTING;
  const filterPending = b.materials.some((x) => x.needs && !done(x, 'FILTERING'));
  const upstreamPending = b.materials.some((x) => (x.roast && !done(x, 'ROASTING')) || (x.needs && !done(x, 'FILTERING')));

  let input = m.weighed;
  if (type === 'ROASTING' && m.needs && done(m, 'FILTERING')) input = Number(fs.output_weight);           // roast what Filtering handed over
  if (type === 'GRINDING') input = done(m, 'ROASTING') ? Number(rs.output_weight) : (!m.roast && done(m, 'FILTERING') ? Number(fs.output_weight) : null);
  if (type === 'FILTERING' && !m.needs) return null;                                                      // only materials ticked "Filter" get a Filtering card
  if (type === 'ROASTING' && !m.roast) return null;                                                       // Filtering Only: no Roasting card

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
  if (type === 'ROASTING') {   // pair-aware: a saved pair is ready only when BOTH materials are ready (same result as above for a material without a pair)
    const g = rp.roastGroupReady(b, m);
    status = g.ok ? 'PENDING' : 'WAITING'; reason = g.ok ? '' : g.reason;
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
    roast_type: type === 'ROASTING' ? (m.roast_type || null) : null, partner_required: type === 'ROASTING' && partnerRequired(b, m),
    pair_managed: type === 'ROASTING' && rp.isManaged(m), pair_material_id: type === 'ROASTING' ? (m.pair_id || null) : null,
    delayed: ev.status === 'RUNNING' && s.remaining_sec < 0, batch_status: b.status,
    planned_seconds: plannedFor(m, type),   // CONFIGURED duration (null = not configured: the worker enters the manual duration)
    session: s ? {
      id: s.id, machine_id: s.machine_id, machine_code: s.machine_code, machine_name: s.machine_name, start_time: s.start_time, expected_minutes: s.expected_minutes,
      group_id: s.group_id || null, expected_end: s.expected_end, actual_end: s.actual_end, actual_minutes: s.actual_minutes,
      elapsed_sec: s.elapsed_sec, remaining_sec: s.remaining_sec, planned_sec: s.planned_sec,
      configured_seconds: s.configured_seconds, manual_seconds: s.manual_seconds, effective_seconds: s.effective_seconds,
      actual_seconds: s.actual_seconds, duration_change_reason: s.duration_change_reason,
      alert_sent: s.alert_sent, input_weight: s.input_weight, output_weight: s.output_weight,
      started_by_name: s.started_by_name, completed_by_name: s.completed_by_name,
    } : null,
  };
}

const ORDER = { RUNNING: 0, PENDING: 1, WAITING: 2, COMPLETED: 3 };

// Keeps batch_roast_groups in step with the sessions (RUNNING on Start, COMPLETED on Stop). Does nothing for old batches / when the table is missing.
async function roastGroupStatus(conn, batchId, materialIds, status, f = {}) {
  try {
    if (status === 'RUNNING') {
      await conn.query(
        `UPDATE batch_roast_groups g JOIN batch_roast_group_members m ON m.group_id = g.id
            SET g.status = 'RUNNING', g.machine_id = ?, g.session_group_id = ?, g.started_at = ? WHERE m.batch_id = ? AND m.material_id IN (?)`,
        [f.machineId, f.sessionGroupId || null, f.startedAt, batchId, materialIds]);
    } else {
      await conn.query(
        `UPDATE batch_roast_groups g JOIN batch_roast_group_members m ON m.group_id = g.id
            SET g.status = 'COMPLETED', g.completed_at = ? WHERE m.batch_id = ? AND m.material_id IN (?)`,
        [f.endAt, batchId, materialIds]);
    }
  } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
}

/* ---------- queue (all material cards of a process) ---------- */

async function queue(type, q) {
  const cfg = TYPES[type];
  const search = v.clean(q.search);
  const args = [cfg.stages, type];
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
  // materials roasted together on one machine: every card lists the others of its group
  const grp = new Map();
  items.forEach((i) => { const g = i.session && i.session.group_id; if (g) { if (!grp.has(g)) grp.set(g, []); grp.get(g).push(i.material_name); } });
  items.forEach((i) => { const g = i.session && i.session.group_id; if (g) i.group_names = grp.get(g).filter((n) => n !== i.material_name); });

  items.splice(0, items.length, ...rp.mergePairCards(items)); // a saved pair is ONE Roasting card
  items.sort((a, c) => (ORDER[a.status] - ORDER[c.status]) || (c.batch_id - a.batch_id));
  const counts = { ALL: items.length, PENDING: 0, WAITING: 0, RUNNING: 0, COMPLETED: 0, DELAYED: 0 };
  items.forEach((i) => { counts[i.status] += 1; if (i.delayed) counts.DELAYED += 1; });

  const [mach] = await pool.query(
    `SELECT m.id, m.machine_code, m.machine_name, r.batch_no, r.material_name
       FROM machine_master m
       LEFT JOIN (SELECT s.machine_id, b.batch_no, GROUP_CONCAT(mt.material_name ORDER BY s.id SEPARATOR ' + ') AS material_name FROM process_sessions s JOIN batch_master b ON b.id = s.batch_id
                    JOIN materials mt ON mt.id = s.material_id WHERE s.status = 'RUNNING' GROUP BY s.machine_id, b.batch_no) r ON r.machine_id = m.id
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
  // Start time = the database clock at the moment Start is pressed (a time sent by an older client is still accepted)
  const time = body.start_time ? reqTime(body.start_time, 'Start time') : null;

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
    if (type === 'ROASTING' && m.pair_id) { const mate = rp.mateOf(b, m); throw new AppError(`${m.material_name} is paired with ${mate ? mate.material_name : 'its partner'}. They are roasted together on one machine`, 409); }
    if (type === 'ROASTING' && partnerRequired(b, m)) throw new AppError(`${m.material_name} is set to Roasting with Partner. Use "Select Partner" to roast it together with its partner materials`, 409);

    // 3) duration: configured (Material Master) is never changed. manual = optional override, effective = what the timer uses.
    const dur = resolveDuration({ configuredSec: plannedFor(m, type), manualRaw: body.manual_minutes ?? body.expected_minutes,
      reasonRaw: body.duration_reason, label: cfg.label.toLowerCase() });
    const plannedSec = dur.effectiveSec;
    if (plannedSec > 86400) throw new AppError('Duration cannot be more than 24 hours');
    const minutes = Math.max(Math.ceil(plannedSec / 60), 1);

    // 4) start time = the DATABASE time now (the exact second), never the phone's clock
    const [[n]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS d, DATE_FORMAT(NOW(), '%H:%i') AS hm, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS full");
    const startStr = !time || time === n.hm ? n.full : `${n.d} ${time}:00`;
    if (time) {
      const [[fut]] = await conn.query('SELECT (? > NOW() + INTERVAL ? MINUTE) AS fut', [startStr, START_TOLERANCE_MIN]);
      if (Number(fut.fut)) throw new AppError('Start time cannot be later than the current time');
    }

    let id;
    try {
      const [r] = await conn.query(
        `INSERT INTO process_sessions (batch_id, material_id, process_type, machine_id, input_weight, start_time, expected_minutes, expected_end, status, started_by,
           configured_seconds, manual_seconds, effective_seconds, duration_change_reason)
         VALUES (?,?,?,?,?,?,?,DATE_ADD(?, INTERVAL ? SECOND),'RUNNING',?,?,?,?,?)`,
        [batchId, materialId, type, machineId, ev.input, startStr, minutes, startStr, plannedSec, user.id,
          dur.configuredSec, dur.manualSec, dur.effectiveSec, dur.reason]);
      id = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError('This machine or this material was just started by someone else. Reload and try again', 409);
      throw e;
    }
    await audit({ userId: user.id, action: 'CREATE', table: 'process_sessions', recordId: id,
      newValues: { process: type, batch_id: batchId, material_id: materialId, machine_id: machineId, start_time: startStr, expected_minutes: minutes,
        configured_seconds: dur.configuredSec, manual_seconds: dur.manualSec, effective_seconds: dur.effectiveSec, duration_change_reason: dur.reason, input_weight: ev.input }, ip }, conn);
    if (type === 'ROASTING') await roastGroupStatus(conn, batchId, [materialId], 'RUNNING', { machineId, sessionGroupId: null, startedAt: startStr });
    return getSession(conn, id);
  });
}

/* ---------- Stop / Complete ---------- */
async function stop(type, body, user, ip, conn0 = null, endAt = null) {   // endAt: a combined roast passes ONE end time for every material of the group
  if (!body.session_id) throw new AppError('Processing record is required');
  const sessionId = v.toId(body.session_id, 'processing record');
  const out = Number(body.output_weight);
  if (!(out > 0)) throw new AppError('Enter the O/P weight (kg)');
  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 255) : null;

  const run = async (conn) => {
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
      `UPDATE process_sessions SET actual_end = GREATEST(COALESCE(?, NOW()), start_time),
        actual_seconds = TIMESTAMPDIFF(SECOND, start_time, GREATEST(COALESCE(?, NOW()), start_time)),
         actual_minutes = ROUND(TIMESTAMPDIFF(SECOND, start_time, GREATEST(COALESCE(?, NOW()), start_time)) / 60, 2),
        output_weight = ?, status = 'COMPLETED', completed_by = ?, remarks = ? WHERE id = ?`, [endAt, endAt, endAt, output, user.id, remarks, sessionId]);
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

    if (type === 'ROASTING') await roastGroupStatus(conn, row.batch_id, [row.material_id], 'COMPLETED', { endAt: s.actual_end });
    const moved = await advanceBatch(conn, row.batch_id, user, ip);
    await audit({ userId: user.id, action: 'UPDATE', table: 'process_sessions', recordId: sessionId,
      oldValues: { status: 'RUNNING' }, newValues: { status: 'COMPLETED', process: type, output_weight: output, actual_end: s.actual_end, actual_seconds: s.actual_seconds, batch_moved: moved }, ip }, conn);
    return { ...s, batch_moved: moved };
  };
  return conn0 ? run(conn0) : withTransaction(run);
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
  if (['FILTERING', 'ROASTING'].includes(stage) && mats.every((m) => (!m.roast || done(m, 'ROASTING')) && (!m.needs || done(m, 'FILTERING')))) {
    const held = Number(b.current_output_kg);
    const outKg = r3(mats.reduce((a, m) => a + (m.roast ? Number(m.s.ROASTING.output_weight) : Number(m.s.FILTERING.output_weight)), 0));
    const loss = Math.max(r3(held - outKg), 0);
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

/* ---------- Combined Roasting: several READY materials of one batch roast together on ONE machine ----------
 * Every material keeps its own process_sessions row (own I/P and own O/P, so Grinding and the batch tracking stay material-wise).
 * The first row is the lead (group_lead = 1) and holds the machine; the others (group_lead = 0) share its group_id.
 * Configured duration of a combined roast = the longest configured Roasting time of the picked materials. */
async function startGroup(body, user, ip) {
  const type = 'ROASTING'; const cfg = TYPES[type];
  if (!body.batch_id) throw new AppError('Batch is required');
  const derive = !Array.isArray(body.material_ids);   // cards of a saved pair send only material_id: the server reads the saved partner itself
  if (derive && !body.material_id) throw new AppError('Select the materials to roast together');
  if (!body.machine_id) throw new AppError('Select a machine');
  const batchId = v.toId(body.batch_id, 'batch');
  const ids = derive ? [v.toId(body.material_id, 'material')] : [...new Set(body.material_ids.map((x) => v.toId(x, 'material')))];
  // ("at least two" is checked below, once it is known whether the batch has a saved pair)
  if (ids.length > 30) throw new AppError('Too many materials');
  const machineId = v.toId(body.machine_id, 'machine');
  const time = body.start_time ? reqTime(body.start_time, 'Start time') : null;   // no time sent = the database clock, as for a single material

  return withTransaction(async (conn) => {
    const [[mc]] = await conn.query('SELECT id, machine_name, machine_type, status FROM machine_master WHERE id = ? FOR UPDATE', [machineId]);
    if (!mc) throw new AppError('Selected machine does not exist', 404);
    if (mc.machine_type !== cfg.machine) throw new AppError(`${mc.machine_name} is not a ${cfg.label.toLowerCase()} machine`);
    if (!['ACTIVE', 'IDLE'].includes(mc.status)) throw new AppError(`${mc.machine_name} is ${mc.status.replace(/_/g, ' ').toLowerCase()} and cannot be used`);
    const [busy] = await conn.query(
      `SELECT b.batch_no, mt.material_name FROM process_sessions s JOIN batch_master b ON b.id = s.batch_id JOIN materials mt ON mt.id = s.material_id
        WHERE s.machine_id = ? AND s.status = 'RUNNING' LIMIT 1`, [machineId]);
    if (busy.length) throw new AppError(`${mc.machine_name} is busy: ${busy[0].material_name} (${busy[0].batch_no}) is running on it. Choose another machine`, 409);

    const [[bm]] = await conn.query('SELECT id, status, current_stage, batch_no FROM batch_master WHERE id = ? FOR UPDATE', [batchId]);
    if (!bm) throw new AppError('Batch not found', 404);
    if (bm.status !== 'IN_PROGRESS') throw new AppError(`Batch ${bm.batch_no} is ${String(bm.status).toLowerCase().replace('_', ' ')}`, 409);
    if (!cfg.stages.includes(bm.current_stage)) throw new AppError(`Batch ${bm.batch_no} is at the ${bm.current_stage} stage`, 409);
    const b = (await loadContext(conn, [batchId])).get(batchId);
    const grp = rp.resolveStartGroup(b, ids, derive);   // batch with saved pairs: exactly the saved pair, a different partner is rejected
    if (!grp.managed && ids.length < 2) throw new AppError('Select at least two materials to combine. To roast one material, choose Roast Individually');
    const picked = grp.mats.map((m) => {
      // (m comes from the resolved group)
      if (!m) throw new AppError('One of the materials is not part of this batch', 404);
      const ev = evalCard(b, m, type);
      if (!ev) throw new AppError(`${m.material_name} is Filtering Only and is not roasted`, 409);
      if (m.roast_type === 'ROAST_ONLY') throw new AppError(`${m.material_name} is set to Only Roasting and cannot be roasted together with other materials`, 409);
      if (ev.status !== 'PENDING') throw new AppError(`${m.material_name} is not ready for Roasting yet${ev.reason ? `: ${ev.reason}` : ''}`, 409);
      if (!(ev.input > 0)) throw new AppError(`There is no quantity to roast for ${m.material_name}`);
      return { m, input: ev.input };
    });

    // duration: longest configured Roasting time of the picked materials; manual override optional (reason mandatory when it differs)
    const cfgSec = Math.max(0, ...picked.map((x) => plannedFor(x.m, type) || 0)) || null;
    const dur = resolveDuration({ configuredSec: cfgSec, manualRaw: body.manual_minutes ?? body.expected_minutes,
      reasonRaw: body.duration_reason, label: 'roasting' });
    if (dur.effectiveSec > 86400) throw new AppError('Duration cannot be more than 24 hours');
    const minutes = Math.max(Math.ceil(dur.effectiveSec / 60), 1);

    const [[d]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS d, DATE_FORMAT(NOW(), '%H:%i') AS hm, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS full");
    const startStr = !time || time === d.hm ? d.full : `${d.d} ${time}:00`;
    const [[fut]] = await conn.query('SELECT (? > NOW() + INTERVAL ? MINUTE) AS fut', [startStr, START_TOLERANCE_MIN]);   // same tolerance as a single start
    if (Number(fut.fut)) throw new AppError('Start time cannot be later than the current time');

    const ins = `INSERT INTO process_sessions (batch_id, material_id, process_type, machine_id, input_weight, start_time, expected_minutes, expected_end, status, started_by, group_lead, alert_sent,
                   configured_seconds, manual_seconds, effective_seconds, duration_change_reason)
                 VALUES (?,?,?,?,?,?,?,DATE_ADD(?, INTERVAL ? SECOND),'RUNNING',?,?,?,?,?,?,?)`;
    let leadId = null; const created = [];
    try {
      for (const [n, x] of picked.entries()) {
        const [r] = await conn.query(ins, [batchId, x.m.material_id, type, machineId, x.input, startStr, minutes, startStr, dur.effectiveSec, user.id,
          n === 0 ? 1 : 0, n === 0 ? 0 : 1, dur.configuredSec, dur.manualSec, dur.effectiveSec, dur.reason]);
        if (n === 0) { leadId = r.insertId; await conn.query('UPDATE process_sessions SET group_id = ? WHERE id = ?', [leadId, leadId]); }
        else await conn.query('UPDATE process_sessions SET group_id = ? WHERE id = ?', [leadId, r.insertId]);
        created.push(r.insertId);
      }
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError('This machine or one of the materials was just started by someone else. Reload and try again', 409);
      throw e;
    }
    await audit({ userId: user.id, action: 'CREATE', table: 'process_sessions', recordId: leadId,
      newValues: { process: type, combined: true, group_id: leadId, batch_id: batchId, machine_id: machineId, start_time: startStr, expected_minutes: minutes,
        configured_seconds: dur.configuredSec, manual_seconds: dur.manualSec, duration_change_reason: dur.reason,
        materials: picked.map((x) => ({ material_id: x.m.material_id, input_weight: x.input })) }, ip }, conn);
    await roastGroupStatus(conn, batchId, picked.map((x) => x.m.material_id), 'RUNNING', { machineId, sessionGroupId: leadId, startedAt: startStr });
    return { group_id: leadId, sessions: created.length, materials: picked.map((x) => x.m.material_name) };
  });
}

// Stop / Complete a combined roast: every material of the group needs its own O/P weight. One transaction, all or nothing.
async function stopGroup(body, user, ip) {
  const gid = v.toId(body.group_id, 'group');
  if (!Array.isArray(body.outputs) || !body.outputs.length) throw new AppError('Enter the O/P weight of every material');
  const want = new Map(body.outputs.map((o) => [Number(o.session_id), o.output_weight]));
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT s.id, mt.material_name FROM process_sessions s JOIN materials mt ON mt.id = s.material_id
        WHERE s.group_id = ? AND s.process_type = 'ROASTING' AND s.status = 'RUNNING' ORDER BY s.id FOR UPDATE`, [gid]);
    if (!rows.length) throw new AppError('This combined roasting is already completed', 409);
    const [[{ endAt }]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS endAt");   // ONE end time for the whole pair
    const miss = rows.filter((r) => !(Number(want.get(r.id)) > 0));
    if (miss.length) throw new AppError(`Enter the O/P weight for: ${miss.map((r) => r.material_name).join(', ')}`);
    const note = `Combined roast: ${rows.map((r) => r.material_name).join(' + ')}`;
    const remarks = [note, body.remarks ? String(body.remarks).trim() : ''].filter(Boolean).join(' - ').slice(0, 255);
    let last = null;
    for (const r of rows) {
      last = await stop('ROASTING', { session_id: r.id, output_weight: want.get(r.id), remarks, temp_before: body.temp_before, std_temp: body.std_temp, temp_after: body.temp_after }, user, ip, conn, endAt);
    }
    return { group_id: gid, count: rows.length, batch_moved: last ? last.batch_moved : null };
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
  let names = s.material_name;
  if (s.group_id) {
    const [g] = await pool.query("SELECT mt.material_name FROM process_sessions x JOIN materials mt ON mt.id = x.material_id WHERE x.group_id = ? AND x.status = 'RUNNING' ORDER BY x.id", [s.group_id]);
    if (g.length) names = g.map((x) => x.material_name).join(' + ');
  }
  return { fired: true, session_id: id, message: `${TYPES[type].label} Alert: ${names} on ${s.machine_name} ${late ? 'has reached its expected completion time. Please stop it when it is done.' : 'is expected to complete in 5 minutes.'}` };
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
  const [rows] = await pool.query(`${SESSION_SELECT} ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows.map(shapeSession), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

/* ---------- one saved session, for the "View details" popup (durations come from the session snapshot, not the current Material Master) ---------- */
async function detail(type, idRaw) {
  const id = v.toId(idRaw, 'processing record');
  const [rows] = await pool.query(`${SESSION_SELECT} WHERE s.id = ? AND s.process_type = ?`, [id, type]);
  if (!rows.length) throw new AppError('Processing record not found', 404);
  const s = shapeSession(rows[0]);

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
  return { ...s, wastage_weight: wastage, loss_percent: loss, ...extra };
}

module.exports = { TYPES, queue, start, startGroup, stop, stopGroup, proceed, alertDue, history, detail };