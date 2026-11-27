const { pool } = require('../config/db');
const notifications = require('./notificationService');

const EVERY_MS = 30 * 1000;
let busy = false;


// Every batch that finished packing in the last day: one alert for the packing team, and (if there is wastage) one for Super Admin.
// dedupeKey = it is created only once per user, even though this runs all day.
async function checkPackingDone() {
  const [rows] = await pool.query(
    `SELECT b.id, b.batch_no, b.total_wastage_kg, p.product_name,
            COALESCE((SELECT SUM(pd.total_packing_weight) FROM packing_details pd WHERE pd.batch_id = b.id AND pd.status <> 'CANCELLED'), 0) AS packed_kg
       FROM batch_master b JOIN product_master p ON p.id = b.product_id
      WHERE b.status = 'COMPLETED' AND b.completed_at >= NOW() - INTERVAL 1 DAY`);
  for (const r of rows) {
    const w = Math.round(Number(r.total_wastage_kg || 0) * 1000) / 1000;
    const packed = Math.round(Number(r.packed_kg || 0) * 1000) / 1000;
    await notifications.notify({
      type: 'PACKING_DONE', severity: 'success',
      title: 'Packing completed',
      message: `${r.batch_no} (${r.product_name}) packing is completed. Packed ${packed} kg${w > 0 ? `, wastage ${w} kg` : ''}.`,
      screen: 'PackingList', module: 'packing', batchId: r.id, dedupeKey: `PACKING_DONE:${r.id}`,
    });
    if (w > 0) {
      await notifications.notify({
        type: 'BATCH_WASTAGE', severity: 'warning',
        title: 'Batch wastage',
        message: `${r.batch_no} (${r.product_name}) finished with ${w} kg wastage. Open Wastage & Fill Report to see overfill / underfill.`,
        screen: 'WastageList', roles: ['Super Admin'], batchId: r.id, dedupeKey: `BATCH_WASTAGE:${r.id}`,
      });
    }
  }
}
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
  }

  // packing completion runs on every pass, whether or not a blending is running
  try {
    await checkPackingDone();
  } catch (e) {
    console.error('Packing done alert job:', e.message);
  }
  busy = false;
}
function startBlendingAlerts() {
  checkOnce();
  return setInterval(checkOnce, EVERY_MS);
}

module.exports = { startBlendingAlerts, checkOnce };