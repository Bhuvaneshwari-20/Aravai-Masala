const { pool } = require('../config/db');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
// GRAM -> kg, KG as is, other units are not counted (same rule as the stock overview)
const KG = `CASE UPPER(m.unit) WHEN 'KG' THEN 1 WHEN 'GRAM' THEN 0.001 ELSE 0 END`;

async function today() {
  const [[b]] = await pool.query(
    `SELECT COUNT(*) AS started, COALESCE(SUM(planned_qty_kg), 0) AS planned_kg
       FROM batch_master WHERE DATE(production_date) = CURDATE()`);

  const [[m]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN t.txn_type = 'INWARD' THEN t.inward_qty * ${KG} ELSE 0 END), 0) AS received_kg,
       COALESCE(SUM(CASE WHEN t.txn_type = 'ISSUE' AND COALESCE(t.issue_type, '') <> 'RETURN_TO_VENDOR'
                         THEN t.despatch_qty * ${KG} ELSE 0 END), 0) AS used_kg
       FROM material_stock_transactions t
       JOIN materials m ON m.id = t.material_id
      WHERE t.txn_date >= CURDATE() AND t.txn_date < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`);

  const [[p]] = await pool.query(
    `SELECT COALESCE(SUM(total_packing_weight), 0) AS packed_kg, COUNT(*) AS packing_runs
       FROM packing_details WHERE DATE(packing_date) = CURDATE() AND status <> 'CANCELLED'`);

  return {
    started: Number(b.started), planned_kg: r2(b.planned_kg),
    received_kg: r2(m.received_kg), used_kg: r2(m.used_kg),
    packed_kg: r2(p.packed_kg), packing_runs: Number(p.packing_runs),
  };
}

module.exports = { today };