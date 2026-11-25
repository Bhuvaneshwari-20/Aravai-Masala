// Filtering / Roasting / Grinding alerts, created by the SERVER every 30 seconds, so it does not matter whether anybody has the page open.
// It only READS process_sessions - nothing in the existing process workflow (start / stop / alert_sent / the page banner) is changed.
//   reminder : when the time left is at or below a configured stage (default 5 minutes)      -> NOTIFY_REMINDER_MINUTES=5,2
//   overdue  : when the expected end time has passed and the process is still RUNNING        -> NOTIFY_OVERDUE=0 turns it off
//   complete : a process that was stopped / completed in the last 15 minutes                 -> NOTIFY_COMPLETION=0 turns it off
// Who gets it: the worker who started it (and who stopped it) + Super Admin / Admin. NOTIFY_MODULE_USERS=1 also adds everybody who can open that module.
// No duplicates : UNIQUE (user_id, dedupe_key) in the database. No double job : a MySQL lock, so only ONE server instance runs a check at a time.
const { pool } = require('../config/db');
const { FULL_ACCESS } = require('../utils/roles');
const { notify, cleanup } = require('../services/notificationService');

const STAGES = (process.env.NOTIFY_REMINDER_MINUTES || '5').split(',').map((x) => Number(x.trim())).filter((n) => n > 0).sort((a, b) => b - a);
const OVERDUE = process.env.NOTIFY_OVERDUE !== '0';
const COMPLETION = process.env.NOTIFY_COMPLETION !== '0';
const EVERY_MS = (Number(process.env.NOTIFY_CHECK_SECONDS) || 30) * 1000;
const LOCK = 'aravai_process_alerts';
const LABEL = { FILTERING: 'Filtering', ROASTING: 'Roasting', GRINDING: 'Grinding' };
const SCREEN = { FILTERING: 'FilteringList', ROASTING: 'RoastingList', GRINDING: 'GrindingList' };
const MODULE_USERS = process.env.NOTIFY_MODULE_USERS === '1';

// Which reminder is due for a process with `remaining` seconds left. Returns null when none.
// Only the TIGHTEST stage is sent, so a short process (e.g. 3 minutes with stages 5 and 2) never gets two reminders at once.
// The key of the 5-minute stage stays "m5:<id>" and the overdue key "due:<id>" - the same as before, so old alerts are not repeated.
function stageFor(remaining) {
  if (remaining <= 0) return OVERDUE ? { code: 'due', minutes: 0 } : null;
  const hit = STAGES.filter((m) => remaining <= m * 60);
  if (!hit.length) return null;
  const m = Math.min(...hit);
  return { code: `m${m}`, minutes: m };
}

async function reminders() {
  const window = STAGES.length ? STAGES[0] * 60 : 0;
  const [rows] = await pool.query(
    `SELECT s.id, s.batch_id, s.process_type, s.started_by, TIMESTAMPDIFF(SECOND, NOW(), s.expected_end) AS remaining_sec,UNIX_TIMESTAMP(s.start_time) AS start_ts,
            mt.material_name, mc.machine_name, b.batch_no
       FROM process_sessions s
       JOIN materials mt ON mt.id = s.material_id
       JOIN machine_master mc ON mc.id = s.machine_id
       JOIN batch_master b ON b.id = s.batch_id
      WHERE s.status = 'RUNNING' AND b.status <> 'CANCELLED'
        AND TIMESTAMPDIFF(SECOND, NOW(), s.expected_end) <= ?`, [window]);
  for (const r of rows) {
    const label = LABEL[r.process_type];
    const st = label ? stageFor(Number(r.remaining_sec)) : null;
    if (!st) continue;
    const late = st.code === 'due';
    const mins = Math.max(Math.ceil(Number(r.remaining_sec) / 60), 1);
    await notify({
      type: late ? 'PROCESS_DUE' : (st.code === 'm5' ? 'PROCESS_5MIN' : 'PROCESS_REMINDER'),
      severity: late ? 'danger' : 'warning',
      title: late ? `${label} overdue` : `${label} alert`,
      message: `${label} Alert: ${r.material_name} on ${r.machine_name} (${r.batch_no}) ${late
        ? 'has reached its expected completion time. Please stop it when it is done.'
        : `is expected to complete in about ${mins} minute${mins > 1 ? 's' : ''}.`}`,
      screen: SCREEN[r.process_type],
      params: { process_id: r.id, batch_id: r.batch_id, process_type: r.process_type },
      processType: r.process_type, processId: r.id, batchId: r.batch_id, stage: st.code,
           dedupeKey: `${st.code}:${r.id}:${r.start_ts}`,
      userIds: [r.started_by], roles: FULL_ACCESS,
      module: MODULE_USERS ? r.process_type.toLowerCase() : undefined,
    });
  }
}

async function completions() {
  const [rows] = await pool.query(
    `SELECT s.id, s.batch_id, s.process_type, s.started_by, s.completed_by, s.output_weight, s.actual_minutes,UNIX_TIMESTAMP(s.start_time) AS start_ts,
            mt.material_name, mc.machine_name, b.batch_no
       FROM process_sessions s
       JOIN materials mt ON mt.id = s.material_id
       JOIN machine_master mc ON mc.id = s.machine_id
       JOIN batch_master b ON b.id = s.batch_id
      WHERE s.status = 'COMPLETED' AND s.actual_end >= NOW() - INTERVAL 15 MINUTE`);
  for (const r of rows) {
    const label = LABEL[r.process_type];
    if (!label) continue;
    await notify({
      type: 'PROCESS_DONE', severity: 'success',
      title: `${label} completed`,
      message: `${label} completed: ${r.material_name} on ${r.machine_name} (${r.batch_no})${r.output_weight != null ? `, output ${Number(r.output_weight)} kg` : ''}.`,
      screen: SCREEN[r.process_type],
      params: { process_id: r.id, batch_id: r.batch_id, process_type: r.process_type },
      processType: r.process_type, processId: r.id, batchId: r.batch_id, stage: 'done',
      dedupeKey: `done:${r.id}:${r.start_ts}`,
      userIds: [r.started_by, r.completed_by].filter(Boolean), roles: FULL_ACCESS,
      module: MODULE_USERS ? r.process_type.toLowerCase() : undefined,
    });
  }
}

let running = false;
async function runOnce() {
  if (running) return;
  running = true;
  let conn = null;
  try {
    conn = await pool.getConnection();
    const [[l]] = await conn.query('SELECT GET_LOCK(?, 0) AS ok', [LOCK]);
    if (!Number(l.ok)) return;            // another server instance is running this check right now
    try {
      await reminders();
      if (COMPLETION) await completions();
    } finally { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {}); }
  } catch (e) {
    console.error('Process alert job:', e.message);
  } finally { if (conn) conn.release(); running = false; }
}

let started = false;
function start() {
  if (started) return;                    // never two timers in one process
  started = true;
  setTimeout(runOnce, 5000).unref();
  setInterval(runOnce, EVERY_MS).unref();
  setInterval(() => cleanup().catch(() => {}), 6 * 60 * 60 * 1000).unref(); // old notifications (60 days) / dead tokens (90 days) are removed
}

module.exports = { start, runOnce, stageFor };