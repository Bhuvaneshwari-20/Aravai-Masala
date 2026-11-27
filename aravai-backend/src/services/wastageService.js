const { pool } = require('../config/db');
const v = require('../utils/validate');

const r3 = (n) => Math.round(n * 1000) / 1000;
const num = (x) => (x === null || x === undefined ? 0 : Number(x));

// batches with wastage + every packing entry with its overfill / underfill
async function report(q) {
  const search = v.clean(q.search);
  const args = [];
  let like = '';
  if (search) { like = ' AND (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }

  const [b] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.status, b.completed_at, b.current_output_kg, b.total_wastage_kg, p.product_name,
            COALESCE((SELECT SUM(pd.total_packing_weight) FROM packing_details pd WHERE pd.batch_id = b.id AND pd.status <> 'CANCELLED'), 0) AS packed_kg,
            COALESCE((SELECT SUM(pd.rejected_weight) FROM packing_details pd WHERE pd.batch_id = b.id AND pd.status <> 'CANCELLED'), 0) AS rejected_kg
       FROM batch_master b JOIN product_master p ON p.id = b.product_id
      WHERE b.total_wastage_kg > 0${like} ORDER BY b.id DESC LIMIT 200`, args);
  const batches = b.map((r) => {
    const out = num(r.current_output_kg); const packed = num(r.packed_kg);
    return {
      batch_id: r.batch_id, batch_no: r.batch_no, product_name: r.product_name, status: r.status,
      output_kg: r3(out), packed_kg: r3(packed), rejected_kg: r3(num(r.rejected_kg)),
      unpacked_kg: r.status === 'COMPLETED' ? r3(Math.max(out - packed, 0)) : 0,   // powder left when the batch was completed
      wastage_kg: r3(num(r.total_wastage_kg)),
    };
  });

  const [f] = await pool.query(
    `SELECT pd.id, pd.packing_date, pd.packing_code, pd.total_bag_count, pd.target_weight, pd.actual_weight,
            b.batch_no, p.product_name, pr.packing_size_label
       FROM packing_details pd
       JOIN batch_master b ON b.id = pd.batch_id
       JOIN product_master p ON p.id = b.product_id
       LEFT JOIN product_packing_rates pr ON pr.id = pd.packing_rate_id
      WHERE pd.status <> 'CANCELLED'${like} ORDER BY pd.id DESC LIMIT 500`, args);
  const fills = f.map((r) => {
    const bags = num(r.total_bag_count);
    const kg = r3(((num(r.actual_weight) - num(r.target_weight)) * bags) / 1000);   // average gram difference x packets
    return {
      id: r.id, packing_date: r.packing_date ? String(r.packing_date).slice(0, 10) : null, packing_code: r.packing_code,
      batch_no: r.batch_no, product_name: r.product_name, pack: r.packing_size_label, packets: bags,
      target_g: num(r.target_weight), actual_g: num(r.actual_weight), fill_kg: kg,
      fill: kg > 0.0005 ? 'OVER' : kg < -0.0005 ? 'UNDER' : 'EXACT',
    };
  });

  return {
    batches, fills,
    summary: {
      wastage_kg: r3(batches.reduce((a, x) => a + x.wastage_kg, 0)),
      overfill_kg: r3(fills.filter((x) => x.fill_kg > 0).reduce((a, x) => a + x.fill_kg, 0)),
      underfill_kg: r3(Math.abs(fills.filter((x) => x.fill_kg < 0).reduce((a, x) => a + x.fill_kg, 0))),
    },
  };
}

module.exports = { report };