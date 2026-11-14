const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');

/* ---------- dropdown data for the form ---------- */
async function lookups() {
  const [batches] = await pool.query(
    `SELECT b.id, b.batch_no, b.product_id, p.product_name, b.current_output_kg,
            COALESCE((SELECT SUM(pd.total_packing_weight) FROM packing_details pd
                       WHERE pd.batch_id = b.id AND pd.status <> 'CANCELLED'), 0) AS packed_kg,
            COALESCE((SELECT SUM(bd.weighed_qty) FROM batching_details bd WHERE bd.batch_id = b.id), 0) AS batching_kg
       FROM batch_master b JOIN product_master p ON p.id = b.product_id
      WHERE b.current_stage = 'PACKING' AND b.status IN ('OPEN','IN_PROGRESS')
     HAVING b.current_output_kg - packed_kg > 0.001   -- nothing left to pack = not offered
      ORDER BY b.id DESC`);
        const [machines] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'PACKING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_name");
  const [rates] = await pool.query(
    'SELECT id, product_id, sku_code, packing_size_label, weight_grams, mrp FROM product_packing_rates WHERE is_active = 1 ORDER BY product_id, weight_grams');
  return { batches, machines, rates };
}

/* ---------- validation ---------- */
function cleanInput(body) {
  const d = {
    batch_id: v.toId(body.batch_id, 'batch'),
    packing_rate_id: v.toId(body.packing_rate_id, 'pack size'),
    machine_id: v.toId(body.machine_id, 'machine'),
    packing_date: h.reqDate(body.packing_date, 'Packing date'),
    overall_weight_kg: v.num(body.overall_weight_kg, 'Overall packet weight', { max: 100000, decimals: 3 }),
    total_bag_count: h.wholeNum(body.total_bag_count, 'Total bag count', { max: 100000000 }),
    rejected_bag_count: h.wholeNum(body.rejected_bag_count, 'Rejected bag count', { max: 100000000 }),
    auger_count: body.auger_count === '' || body.auger_count == null ? null : h.wholeNum(body.auger_count, 'Auger count', { max: 4000000000 }),
    puller_count: body.puller_count === '' || body.puller_count == null ? null : h.wholeNum(body.puller_count, 'Puller count', { max: 4000000000 }),
    production_count: body.production_count === '' || body.production_count == null ? null : h.wholeNum(body.production_count, 'Production count', { max: 4000000000 }),
    remarks: v.optStr(body.remarks, 'Remarks', 255),
    close_batch: body.close_batch === undefined ? false : v.toBool(body.close_batch, 'close_batch'),
  };
  if (d.overall_weight_kg <= 0) throw new AppError('Enter the overall weight of the packets (kg)');
  if (d.total_bag_count <= 0) throw new AppError('Total bag count must be more than 0');
  if (d.rejected_bag_count > d.total_bag_count) throw new AppError('Rejected bags cannot be more than total bags');
  return d;
}

/* ---------- submit ---------- */
async function create(body, userId, ip) {
  const d = cleanInput(body);
  return withTransaction(async (conn) => {
    const batch = await h.lockBatch(conn, d.batch_id, 'PACKING');
    await h.checkMachine(conn, d.machine_id, 'PACKING');

    const [rr] = await conn.query('SELECT * FROM product_packing_rates WHERE id = ? AND is_active = 1', [d.packing_rate_id]);
    if (!rr.length) throw new AppError('Selected pack size does not exist or is inactive');
    const rate = rr[0];
    if (rate.product_id !== batch.product_id) throw new AppError('Selected pack size belongs to a different product');
    const target = Number(rate.weight_grams); // target is always the pack size

    // Stock weights (kg) are bags x pack size. They drive "left in batch" and wastage.
    const accepted = d.total_bag_count - d.rejected_bag_count;
    const totalKg = h.r3((d.total_bag_count * target) / 1000);
    const rejectedKg = h.r3((d.rejected_bag_count * target) / 1000);
    const acceptedKg = h.r3(totalKg - rejectedKg);

    // The overall weight typed by the user is only recorded (saved as the per-bag average in actual_weight).
    // It never changes stock, "left in batch" or wastage.
    const avgGrams = h.r2((d.overall_weight_kg * 1000) / d.total_bag_count);
    if (avgGrams < target * 0.5 || avgGrams > target * 1.5) {
      throw new AppError(`Check the overall weight: ${d.overall_weight_kg} kg for ${d.total_bag_count} bags is ${avgGrams} g per bag, but the pack size is ${target} g`);
    }
    const bagCost = h.r2(d.total_bag_count * Number(rate.bag_material_cost)); // a rejected bag still used a pouch
    const productionCost = h.r2(accepted * Number(rate.production_rate));

    // cannot pack more than the blending output (skipped when the batch has no recorded output)
    const [[{ packed }]] = await conn.query(
      "SELECT COALESCE(SUM(total_packing_weight), 0) AS packed FROM packing_details WHERE batch_id = ? AND status <> 'CANCELLED'", [batch.id]);
        const outKg = Number(batch.current_output_kg);
    if (!(outKg > 0)) throw new AppError(`Batch ${batch.batch_no} has no blended output recorded, so nothing can be packed. Finish blending first`);
    const remaining = h.r3(outKg - Number(packed));
    if (remaining <= 0.001) throw new AppError(`Batch ${batch.batch_no} is fully packed. Nothing is left to pack`);
    if (totalKg > remaining + 0.001) {
      throw new AppError(`Only ${remaining} kg is left in batch ${batch.batch_no}, but this entry packs ${totalKg} kg`);
    }

    const [pk] = await conn.query(
      `INSERT INTO packing_details (packing_date, batch_id, product_id, packing_rate_id, machine_id, bag_size_grams, mrp_snapshot,
         bag_rate_snapshot, bag_material_cost_snapshot, production_rate_snapshot, target_weight, actual_weight, total_bag_count,
         rejected_bag_count, accepted_bag_count, total_packing_weight, rejected_weight, accepted_weight, total_bag_material_cost,
         production_cost, auger_count, puller_count, production_count, operator_id, status, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'COMPLETED',?)`,
      [d.packing_date, batch.id, batch.product_id, rate.id, d.machine_id, rate.weight_grams, rate.mrp, rate.bag_rate,
        rate.bag_material_cost, rate.production_rate, target, avgGrams, d.total_bag_count,
        d.rejected_bag_count, accepted, totalKg, rejectedKg, acceptedKg, bagCost,
        productionCost, d.auger_count, d.puller_count, d.production_count, userId, d.remarks]);

    // accepted bags go into finished goods stock (one row per batch + pack size)
    if (accepted > 0) {
      await conn.query(
        `INSERT INTO finished_goods_stock (product_id, packing_rate_id, batch_id, produced_qty, stock_inward, available_qty, closing_stock)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE produced_qty = produced_qty + VALUES(produced_qty), stock_inward = stock_inward + VALUES(stock_inward),
           available_qty = available_qty + VALUES(available_qty), closing_stock = closing_stock + VALUES(closing_stock)`,
        [batch.product_id, rate.id, batch.id, accepted, accepted, accepted, accepted]);
      const [[fg]] = await conn.query('SELECT id FROM finished_goods_stock WHERE batch_id = ? AND packing_rate_id = ?', [batch.id, rate.id]);
      await conn.query(
        `INSERT INTO finished_goods_transactions (fg_stock_id, txn_date, txn_type, quantity, reference_no, packing_id, entered_by, remarks)
         VALUES (?,?,'INWARD',?,?,?,?,'From packing')`, [fg.id, d.packing_date, accepted, batch.batch_no, pk.insertId, userId]);
    }

    // rejected bags count as batch wastage; when the last powder is packed (or "last run" is ticked), the batch completes
    const remainingAfter = h.r3(outKg - Number(packed) - totalKg);
    const closeNow = d.close_batch || remainingAfter <= 0.001;
    const leftoverKg = closeNow ? Math.max(remainingAfter, 0) : 0;
    if (closeNow) {
      await conn.query(
        `UPDATE batch_master SET total_wastage_kg = total_wastage_kg + ?, current_stage = 'COMPLETED', status = 'COMPLETED',
           completed_at = NOW() WHERE id = ?`, [h.r3(rejectedKg + leftoverKg), batch.id]);
    } else {
      await conn.query('UPDATE batch_master SET total_wastage_kg = total_wastage_kg + ?, status = ? WHERE id = ?',
        [rejectedKg, 'IN_PROGRESS', batch.id]);
    }

    const result = { id: pk.insertId, batch_no: batch.batch_no, sku_code: rate.sku_code, total_bag_count: d.total_bag_count,
      accepted_bag_count: accepted, total_packing_weight: totalKg, batch_closed: closeNow };
    await audit({ userId, action: 'CREATE', table: 'packing_details', recordId: pk.insertId, newValues: result, ip }, conn);
    return result;
  });
}



/* ---------- one entry, for the details view ---------- */
async function get(id) {
  const pid = v.toId(id, 'packing entry');
  const [rows] = await pool.query(
    `SELECT pd.*, b.batch_no, b.current_stage AS batch_stage, b.status AS batch_status, b.current_output_kg AS batch_output_kg,
            p.product_name, r.sku_code, r.packing_size_label, m.machine_code, m.machine_name, u.full_name AS operator_name,
            COALESCE((SELECT SUM(bd.weighed_qty) FROM batching_details bd WHERE bd.batch_id = b.id), 0) AS batching_kg,
            COALESCE((SELECT SUM(x.total_packing_weight) FROM packing_details x WHERE x.batch_id = b.id AND x.status <> 'CANCELLED'), 0) AS batch_packed_kg,
            (SELECT COUNT(*) FROM packing_details x WHERE x.batch_id = b.id AND x.status <> 'CANCELLED') AS batch_runs
       FROM packing_details pd
       JOIN batch_master b ON b.id = pd.batch_id
       JOIN product_master p ON p.id = pd.product_id
       JOIN product_packing_rates r ON r.id = pd.packing_rate_id
       JOIN machine_master m ON m.id = pd.machine_id
       JOIN users u ON u.id = pd.operator_id
      WHERE pd.id = ?`, [pid]);
  if (!rows.length) throw new AppError('Packing entry not found', 404);
  const d = rows[0];
  d.overall_weight_kg = h.r3((Number(d.actual_weight) * Number(d.total_bag_count)) / 1000);
  return d;
}
/* ---------- recent entries ---------- */
async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const args = [];
  let w = '';
  const search = v.clean(q.search);
  if (search) { w = 'WHERE (b.batch_no LIKE ? OR p.product_name LIKE ? OR r.sku_code LIKE ?)'; args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const from = `FROM packing_details pd JOIN batch_master b ON b.id = pd.batch_id JOIN product_master p ON p.id = pd.product_id
    JOIN product_packing_rates r ON r.id = pd.packing_rate_id JOIN machine_master m ON m.id = pd.machine_id
    JOIN users u ON u.id = pd.operator_id ${w}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [items] = await pool.query(
`SELECT pd.id, pd.packing_date, b.batch_no, p.product_name, r.sku_code, r.packing_size_label, m.machine_name, u.full_name AS operator_name,
        pd.total_bag_count, pd.rejected_bag_count, pd.accepted_bag_count, pd.total_packing_weight, pd.status,
b.current_output_kg AS batch_output_kg, b.status AS batch_status,
        COALESCE((SELECT SUM(x.total_packing_weight) FROM packing_details x WHERE x.batch_id = b.id AND x.status <> 'CANCELLED'), 0) AS batch_packed_kg ${from}
  ORDER BY pd.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}
module.exports = { lookups, create, list, get };