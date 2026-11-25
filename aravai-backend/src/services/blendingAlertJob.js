const { pool } = require('../config/db');
const notifications = require('./notificationService');

const EVERY_MS = 30 * 1000;
let busy = false;

// Every 30 s: a RUNNING blending whose planned time is over gets ONE alert for everybody who may open Blending.
// dedupeKey makes sure the same session never alerts twice, even though this runs all day.
async function checkOnce() {
  if (busy) return;
  busy = true;
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.expected_minutes, TIMESTAMPDIFF(SECOND, NOW(), s.expected_end) AS left_sec,
              b.id AS batch_id, b.batch_no, p.product_name, m.machine_code
         FROM blending_sessions s
         JOIN batch_master b ON b.id = s.batch_id
         JOIN product_master p ON p.id = b.product_id
         JOIN machine_master m ON m.id = s.machine_id
        WHERE s.status = 'RUNNING' AND s.expected_end <= NOW() + INTERVAL 1 MINUTE AND s.expected_end >= NOW() - INTERVAL 1 DAY`);   
    for (const r of rows) {
      const over = Number(r.left_sec) <= 0;
      await notifications.notify({
        type: over ? 'BLENDING_OVERDUE' : 'BLENDING_SOON',
        severity: over ? 'danger' : 'warning',
        title: over ? 'Blending overdue' : 'Blending alert',
        message: over
          ? `Blending Alert: ${r.product_name} on ${r.machine_code} (${r.batch_no}) has reached its expected completion time. Please stop it when it is done.`
          : `Blending Alert: ${r.product_name} on ${r.machine_code} (${r.batch_no}) is expected to complete in about 1 minute.`,
        screen: 'BlendingList',
        module: 'blending',
        batchId: r.batch_id,
        dedupeKey: `${over ? 'BLENDING_OVERDUE' : 'BLENDING_SOON'}:${r.id}`,
      });
    }
  } catch (e) {
    console.error('Blending alert job:', e.message);
  } finally {
    busy = false;
  }
}

function startBlendingAlerts() {
  checkOnce();
  return setInterval(checkOnce, EVERY_MS);
}

module.exports = { startBlendingAlerts, checkOnce };