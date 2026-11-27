const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');

/* ---------- dropdown data for the form ---------- */
async function lookups() {
  const [batches] = await pool.query(
    `SELECT b.id, b.batch_no, b.product_id, p.product_name, b.current_output_kg,
            wm.id AS weighing_machine_id, wm.machine_code AS weighing_machine_code, wm.machine_name AS weighing_machine_name,
            COALESCE((SELECT SUM(pd.total_packing_weight) FROM packing_details pd
                       WHERE pd.batch_id = b.id AND pd.status <> 'CANCELLED'), 0) AS packed_kg,
            COALESCE((SELECT SUM(bd.weighed_qty) FROM batching_details bd WHERE bd.batch_id = b.id), 0) AS batching_kg,
            (SELECT DATE_FORMAT(MAX(g.grind_date), '%Y-%m-%d') FROM grinding_details g
              WHERE g.batch_id = b.id AND g.status <> 'REJECTED') AS grinding_date
       FROM batch_master b JOIN product_master p ON p.id = b.product_id
       LEFT JOIN machine_master wm ON wm.id = b.weighing_machine_id
      WHERE b.current_stage = 'PACKING' AND b.status IN ('OPEN','IN_PROGRESS')
     HAVING b.current_output_kg - packed_kg > 0.001   -- nothing left to pack = not offered
      ORDER BY b.id DESC`);
  const [machines] = await pool.query(
    "SELECT id, machine_code, machine_name, print_code, print_codes FROM machine_master WHERE machine_type = 'PACKING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_name");  const [rates] = await pool.query(
    'SELECT id, product_id, sku_code, packing_size_label, weight_grams, mrp FROM product_packing_rates WHERE is_active = 1 ORDER BY product_id, weight_grams');
  return { batches, machines, rates };
}

/* ---------- validation ---------- */
function cleanInput(body) {
  const d = {
    batch_id: v.toId(body.batch_id, 'batch'),
    packing_rate_id: v.toId(body.packing_rate_id, 'pack size'),
    machine_id: body.machine_id ? v.toId(body.machine_id, 'machine') : null,
    packing_date: h.reqDate(body.packing_date, 'Packing date'),
    use_by_date: h.reqDate(body.use_by_date, 'Use by date'),
    packing_code: v.optStr(body.packing_code, 'Packing code', 50),
    overall_weight_kg: v.num(body.overall_weight_kg, 'Overall packet weight', { max: 100000, decimals: 3 }),
        sack_weight_kg: v.num(body.sack_weight_kg, 'Sack weight', { max: 100000, decimals: 3 }),
    total_bag_count: h.wholeNum(body.total_bag_count, 'Total bag count', { max: 100000000 }),
    rejected_bag_count: h.wholeNum(body.rejected_bag_count, 'Rejected bag count', { max: 100000000 }),
    auger_count: body.auger_count === '' || body.auger_count == null ? null : h.wholeNum(body.auger_count, 'Auger count', { max: 4000000000 }),
    puller_count: body.puller_count === '' || body.puller_count == null ? null : h.wholeNum(body.puller_count, 'Puller count', { max: 4000000000 }),
    production_count: body.production_count === '' || body.production_count == null ? null : h.wholeNum(body.production_count, 'Production count', { max: 4000000000 }),
    remarks: v.optStr(body.remarks, 'Remarks', 255),
    close_batch: body.close_batch === undefined ? false : v.toBool(body.close_batch, 'close_batch'),
  };
  if (d.overall_weight_kg <= 0) throw new AppError('Enter the overall weight of the packets (kg)');
    if (d.sack_weight_kg <= 0) throw new AppError('Enter the sack weight');  
  if (d.use_by_date <= d.packing_date) throw new AppError('Use by date must be after the packing date');
  if (d.total_bag_count <= 0) throw new AppError('Total bag count must be more than 0');
  if (d.rejected_bag_count > d.total_bag_count) throw new AppError('Rejected bags cannot be more than total bags');
  return d;
}

/* ---------- submit ---------- */
async function create(body, userId, ip) {
  const d = cleanInput(body);
  return withTransaction(async (conn) => {
    const batch = await h.lockBatch(conn, d.batch_id, 'PACKING');
    d.machine_id = await h.stageMachine(conn, batch.id, d.machine_id, 'PACKING');

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
    const netKg = Math.max(h.r3(d.overall_weight_kg - d.sack_weight_kg), 0);   // packets alone = overall (with sack) minus sack
        const avgGrams = h.r2((netKg * 1000) / d.total_bag_count);    // saved for record only, overfill / underfill never blocks saving
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
      `INSERT INTO packing_details (packing_date, use_by_date, packing_code, batch_id, product_id, packing_rate_id, machine_id, bag_size_grams, mrp_snapshot,
         bag_rate_snapshot, bag_material_cost_snapshot, production_rate_snapshot, target_weight, actual_weight, total_bag_count,
         rejected_bag_count, accepted_bag_count, total_packing_weight, rejected_weight, accepted_weight, total_bag_material_cost,
         production_cost, auger_count, puller_count, production_count, operator_id, status, remarks,sack_weight_kg)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?)`,
      [d.packing_date, d.use_by_date, d.packing_code, batch.id, batch.product_id, rate.id, d.machine_id, rate.weight_grams, rate.mrp, rate.bag_rate,
        rate.bag_material_cost, rate.production_rate, target, avgGrams, d.total_bag_count,
        d.rejected_bag_count, accepted, totalKg, rejectedKg, acceptedKg, bagCost,
        productionCost, d.auger_count, d.puller_count, d.production_count, userId, d.remarks, d.sack_weight_kg]);

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
  d.overall_weight_kg = h.r3((Number(d.actual_weight) * Number(d.total_bag_count)) / 1000 + Number(d.sack_weight_kg || 0));
    return d;
}
/* ---------- recent entries ---------- */
async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const args = [];
  const conds = [];
  const search = v.clean(q.search);
  if (search) { conds.push('(b.batch_no LIKE ? OR p.product_name LIKE ? OR r.sku_code LIKE ?)'); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (q.batch_id) { conds.push('pd.batch_id = ?'); args.push(v.toId(q.batch_id, 'batch')); }
  const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const from = `FROM packing_details pd JOIN batch_master b ON b.id = pd.batch_id JOIN product_master p ON p.id = pd.product_id
    JOIN product_packing_rates r ON r.id = pd.packing_rate_id JOIN machine_master m ON m.id = pd.machine_id
    JOIN users u ON u.id = pd.operator_id ${w}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [items] = await pool.query(
`SELECT pd.id, pd.packing_date, b.batch_no, p.product_name, r.sku_code, r.packing_size_label, m.machine_name, u.full_name AS operator_name,
pd.total_bag_count, pd.rejected_bag_count, pd.accepted_bag_count, pd.total_packing_weight, pd.status, pd.packing_code, pd.use_by_date,
        b.current_output_kg AS batch_output_kg, b.status AS batch_status,
        COALESCE((SELECT SUM(x.total_packing_weight) FROM packing_details x WHERE x.batch_id = b.id AND x.status <> 'CANCELLED'), 0) AS batch_packed_kg ${from}
  ORDER BY pd.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}
async function queue(q) {
  const search = v.clean(q.search);
  const args = [];
  let like = '';
  if (search) { like = ' AND (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.status AS batch_status, b.current_stage, b.hold_reason, b.current_output_kg, p.product_name,
            COALESCE(pk.packed_kg, 0) AS packed_kg, COALESCE(pk.runs, 0) AS runs, COALESCE(pk.total_bags, 0) AS total_bags,
            COALESCE(pk.accepted_bags, 0) AS accepted_bags, COALESCE(pk.rejected_bags, 0) AS rejected_bags,pk.last_date, pk.sizes,
            (SELECT MIN(r.weight_grams) FROM product_packing_rates r WHERE r.product_id = b.product_id AND r.is_active = 1) AS min_pack_g
       FROM batch_master b
       JOIN product_master p ON p.id = b.product_id
       LEFT JOIN (SELECT x.batch_id, SUM(x.total_packing_weight) AS packed_kg, COUNT(*) AS runs, SUM(x.total_bag_count) AS total_bags,
                         SUM(x.accepted_bag_count) AS accepted_bags, SUM(x.rejected_bag_count) AS rejected_bags,
                         DATE_FORMAT(MAX(x.packing_date), '%Y-%m-%d') AS last_date,
                         GROUP_CONCAT(DISTINCT r.packing_size_label ORDER BY r.weight_grams SEPARATOR ', ') AS sizes
                    FROM packing_details x JOIN product_packing_rates r ON r.id = x.packing_rate_id
                   WHERE x.status <> 'CANCELLED' GROUP BY x.batch_id) pk ON pk.batch_id = b.id
      WHERE b.status <> 'CANCELLED'
        AND ((b.current_stage = 'PACKING' AND b.status IN ('OPEN','IN_PROGRESS','ON_HOLD'))
          OR (b.current_stage = 'COMPLETED' AND pk.batch_id IS NOT NULL AND b.completed_at >= NOW() - INTERVAL 2 DAY))${like}
      ORDER BY b.id DESC`, args);
  const ORDER = { IN_PROGRESS: 0, PENDING: 1, WAITING: 2, COMPLETED: 3 };
  const items = rows.map((r) => {
    const out = Number(r.current_output_kg || 0);
    const packed = h.r3(Number(r.packed_kg));
    const closed = r.batch_status === 'COMPLETED' || r.current_stage === 'COMPLETED';
    const hold = !closed && r.batch_status === 'ON_HOLD';

        const minPack = Number(r.min_pack_g) || 0;
    return {
      batch_id: r.batch_id, batch_no: r.batch_no, product_name: r.product_name, batch_status: r.batch_status,
      status: closed ? 'COMPLETED' : hold ? 'WAITING' : Number(r.runs) > 0 ? 'IN_PROGRESS' : 'PENDING',
      reason: hold ? `Batch is on hold${r.hold_reason ? ` (${r.hold_reason})` : ''}` : '',
      output_kg: h.r3(out), packed_kg: packed,      output_kg: h.r3(out), packed_kg: packed, left_kg: Math.max(h.r3(out - packed), 0),
      min_pack_g: minPack, can_complete: minPack === 0 || Math.round(Math.max(h.r3(out - packed), 0) * 1000) < minPack,

      runs: Number(r.runs), total_bags: Number(r.total_bags), accepted_bags: Number(r.accepted_bags), rejected_bags: Number(r.rejected_bags),
      last_date: r.last_date, sizes: r.sizes || '',
    };
  }).sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.batch_id - a.batch_id));
  const counts = { ALL: items.length, PENDING: 0, IN_PROGRESS: 0, WAITING: 0, COMPLETED: 0 };
  items.forEach((i) => { counts[i.status] += 1; });
  return { items, counts };
}

/* ---------- complete a batch without another packing entry (leftover powder = wastage) ---------- */
async function closeBatch(idRaw, userId, ip) {
  const id = v.toId(idRaw, 'batch');
  return withTransaction(async (conn) => {
    const batch = await h.lockBatch(conn, id, 'PACKING');
    const [[{ packed, runs }]] = await conn.query(
      "SELECT COALESCE(SUM(total_packing_weight), 0) AS packed, COUNT(*) AS runs FROM packing_details WHERE batch_id = ? AND status <> 'CANCELLED'", [batch.id]);
    if (!Number(runs)) throw new AppError('Add at least one packing entry before completing this batch');
    const left = Math.max(h.r3(Number(batch.current_output_kg) - Number(packed)), 0);

        const [[{ minPack }]] = await conn.query('SELECT MIN(weight_grams) AS minPack FROM product_packing_rates WHERE product_id = ? AND is_active = 1', [batch.product_id]);
    if (Number(minPack) > 0 && Math.round(left * 1000) >= Number(minPack)) {
      throw new AppError(`${left} kg is still left, enough for another ${minPack} g packet. Add a packing entry. The batch can be completed only when less than ${minPack} g is left`);
    }
    await conn.query(
      `UPDATE batch_master SET total_wastage_kg = total_wastage_kg + ?, current_stage = 'COMPLETED', status = 'COMPLETED', completed_at = NOW() WHERE id = ?`,
      [left, batch.id]);
    const result = { batch_id: batch.id, batch_no: batch.batch_no, wastage_kg: left };
    await audit({ userId, action: 'STATUS_CHANGE', table: 'batch_master', recordId: batch.id, newValues: { ...result, closed_from: 'PACKING' }, ip }, conn);
    return result;
  });
}

module.exports = { lookups, create, list, get, queue, closeBatch };