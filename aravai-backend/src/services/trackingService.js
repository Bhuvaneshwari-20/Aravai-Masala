const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

// A batch with no movement for this many hours is shown as "stuck" (set TRACKING_STUCK_HOURS in .env to change)
const STUCK_HOURS = Number(process.env.TRACKING_STUCK_HOURS) || 48;
// Roasting loss % above this is highlighted (same .env key the Roasting screen uses)
const ROAST_LOSS_ALERT = Number(process.env.ROASTING_LOSS_ALERT_PERCENT) || 12;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (x) => (x === null || x === undefined ? 0 : Number(x));
const names = (arr) => [...new Set(arr.filter(Boolean))].join(', ') || null;

const STEPS = [
  { key: 'BATCHING', label: 'Batching' },
  { key: 'FILTERING', label: 'Filtering' },
  { key: 'ROASTING', label: 'Roasting' },
  { key: 'GRINDING', label: 'Grinding' },
  { key: 'BLENDING', label: 'Blending' },
  { key: 'PACKING', label: 'Packing' },
];
const ORDER = [...STEPS.map((s) => s.key), 'COMPLETED'];

/* ------------------------------------------------------------------ board */
// All running batches grouped by the stage they are waiting at, plus the last 10 completed ones.
// Optional filters (query string): search, product_id, from, to (production date, YYYY-MM-DD)
async function board(q) {
  const search = v.clean(q.search);
  const args = [];
  let like = '';
  if (search) { like += ' AND (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  if (v.clean(q.product_id)) { like += ' AND b.product_id = ?'; args.push(v.toId(q.product_id, 'product')); }
  const date = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? x : null);
  if (date(q.from)) { like += ' AND b.production_date >= ?'; args.push(q.from); }
  if (date(q.to)) { like += ' AND b.production_date <= ?'; args.push(q.to); }

  const [rows] = await pool.query(
    `SELECT x.*, TIMESTAMPDIFF(HOUR, COALESCE(x.stage_since, x.created_at), NOW()) AS hours_in_stage FROM (
       SELECT b.id, b.batch_no, b.status, b.current_stage, b.production_date, b.planned_qty_kg, b.current_output_kg,
              b.total_wastage_kg, b.hold_reason, b.created_at, p.product_name, r.recipe_no,
              CASE b.current_stage
                WHEN 'BATCHING' THEN b.created_at
                WHEN 'FILTERING' THEN b.batching_completed_at
                WHEN 'ROASTING' THEN COALESCE((SELECT MAX(end_time) FROM filtering_details WHERE batch_id = b.id), b.batching_completed_at)
                WHEN 'GRINDING' THEN COALESCE((SELECT MAX(end_time) FROM roasting_details WHERE batch_id = b.id AND status = 'COMPLETED'), b.batching_completed_at)
                WHEN 'BLENDING' THEN COALESCE((SELECT MAX(output_time) FROM grinding_details WHERE batch_id = b.id AND status = 'COMPLETED'), b.batching_completed_at)
                WHEN 'PACKING' THEN COALESCE((SELECT MAX(end_time) FROM blending_details WHERE batch_id = b.id), b.batching_completed_at)
                ELSE b.completed_at
              END AS stage_since
         FROM batch_master b
         JOIN product_master p ON p.id = b.product_id
         LEFT JOIN recipe_master r ON r.id = b.recipe_id
        WHERE ((b.status NOT IN ('COMPLETED', 'CANCELLED'))
               OR b.id IN (SELECT t.id FROM (SELECT id FROM batch_master WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 10) t))
          ${like}
     ) x ORDER BY x.id DESC`, args);

  const [[done]] = await pool.query(
    "SELECT COUNT(*) AS n FROM batch_master WHERE status = 'COMPLETED' AND completed_at >= DATE_FORMAT(NOW(), '%Y-%m-01')");

  const columns = ORDER.map((stage) => ({ stage, label: stage === 'COMPLETED' ? 'Completed' : STEPS.find((s) => s.key === stage).label, count: 0, total_kg: 0, items: [] }));
  let onHold = 0; let stuck = 0; let running = 0; let runningKg = 0;
  rows.forEach((r) => {
    const col = columns[Math.max(ORDER.indexOf(r.current_stage), 0)];
    const active = r.status !== 'COMPLETED' && r.status !== 'CANCELLED';
    const isStuck = active && r.status !== 'ON_HOLD' && Number(r.hours_in_stage) > STUCK_HOURS;
    const kg = r3(num(r.current_output_kg));
    col.items.push({
      id: r.id, batch_no: r.batch_no, product_name: r.product_name, recipe_no: r.recipe_no, status: r.status,
      stage: r.current_stage, kg, planned_qty_kg: num(r.planned_qty_kg), wastage_kg: r3(num(r.total_wastage_kg)),
      hours_in_stage: active ? Number(r.hours_in_stage) : null, on_hold: r.status === 'ON_HOLD', hold_reason: r.hold_reason, stuck: isStuck,
    });
    col.count += 1; col.total_kg = r3(col.total_kg + kg);
    if (active) { running += 1; runningKg = r3(runningKg + kg); if (r.status === 'ON_HOLD') onHold += 1; if (isStuck) stuck += 1; }
  });
  columns.forEach((c) => c.items.sort((a, b) => (b.hours_in_stage ?? -1) - (a.hours_in_stage ?? -1)));
  return { columns, summary: { running, running_kg: runningKg, on_hold: onHold, stuck, completed_this_month: done.n, stuck_hours: STUCK_HOURS } };
}

/* ----------------------------------------------------------------- detail */
// Pure function: turns the batch row + the rows of every stage table into the timeline (easy to test)
function buildTimeline(b, d) {
  const completed = b.status === 'COMPLETED' || b.current_stage === 'COMPLETED';
  const cur = ORDER.indexOf(b.current_stage);
  const weighed = r3(d.batching.reduce((s, r) => s + num(r.weighed_qty), 0));
  const has = {
    BATCHING: d.batching.length > 0, FILTERING: d.filtering.length > 0, ROASTING: d.roasting.length > 0,
    GRINDING: d.grinding.length > 0, BLENDING: d.blending.length > 0, PACKING: d.packing.length > 0,
  };
  const min = (arr) => arr.filter(Boolean).sort()[0] || null;
  const max = (arr) => arr.filter(Boolean).sort().slice(-1)[0] || null;
  const doneRoast = d.roasting.filter((r) => r.status === 'COMPLETED');
  const doneGrind = d.grinding.filter((r) => r.status === 'COMPLETED');

  // raw numbers of every step: input comes from the previous step's output
  const f = d.filtering[0];
  const raw = {
    BATCHING: { out: weighed || null, started: b.created_at, ended: b.batching_completed_at },
    FILTERING: f ? { out: num(f.output_weight), started: f.start_time, ended: f.end_time } : { out: null },
    ROASTING: {
      loss: r3(doneRoast.reduce((s, r) => s + num(r.wastage_weight), 0)),
      started: min(d.roasting.map((r) => r.start_time)), ended: max(doneRoast.map((r) => r.end_time)),
    },
    GRINDING: {
      out: doneGrind.length ? r3(doneGrind.reduce((s, r) => s + num(r.output_weight), 0)) : null,
      started: min(d.grinding.map((r) => r.input_time)), ended: max(doneGrind.map((r) => r.output_time)),
    },
    BLENDING: {
      out: d.blending.length ? r3(d.blending.reduce((s, r) => s + num(r.output_weight), 0)) : null,
      started: min(d.blending.map((r) => r.start_time)), ended: max(d.blending.map((r) => r.end_time)),
    },
    PACKING: {
      out: d.packing.length ? r3(d.packing.reduce((s, r) => s + num(r.accepted_weight), 0)) : null,
      started: min(d.packing.map((r) => r.packing_date)), ended: max(d.packing.map((r) => r.packing_date)),
    },
  };
  const operators = {
    BATCHING: names(d.batching.map((x) => x.done_by_name)),
    FILTERING: names(d.filtering.map((x) => x.done_by_name)),
    ROASTING: names(d.roasting.map((x) => x.operator_name)),
    GRINDING: names(d.grinding.map((x) => x.operator_name)),
    BLENDING: names(d.blending.map((x) => x.operator_name)),
    PACKING: names(d.packing.map((x) => x.operator_name)),
  };

  let last = weighed || null; // weight carried to the next step
  const steps = STEPS.map((s, i) => {
    let status;
    if (completed) status = (s.key === 'FILTERING' && !has.FILTERING) ? 'SKIPPED' : 'DONE';
    else if (i < cur) status = (s.key === 'FILTERING' && !has.FILTERING) ? 'SKIPPED' : 'DONE';
    else if (i === cur) status = 'CURRENT';
    else status = 'PENDING';

    const r = raw[s.key];
    const finished = status === 'DONE';
    const inKg = s.key === 'BATCHING' ? null : last;
    let outKg = null;
    if (finished || (status === 'CURRENT' && s.key === 'BATCHING')) {
      if (s.key === 'ROASTING') outKg = inKg !== null && has.ROASTING ? Math.max(r3(inKg - r.loss), 0) : null;
      else outKg = r.out;
    }
    const lossKg = inKg !== null && outKg !== null ? Math.max(r3(inKg - outKg), 0) : null;
    const lossPct = lossKg !== null && inKg > 0 ? r2((lossKg / inKg) * 100) : null;
    if (outKg !== null) last = outKg;

    // detail lines shown under the step
    let lines = [];
    if (s.key === 'BATCHING') lines = d.batching.map((x) => ({ label: x.material_name, value: `${r3(num(x.weighed_qty))} kg` }));
    if (s.key === 'FILTERING' && f) lines = [{ label: 'Stages', value: String(f.stages ?? '-') }, { label: 'Done by', value: f.done_by_name || '-' }];
    if (s.key === 'ROASTING') lines = d.roasting.map((x) => ({
      label: x.material_name || 'Roasting entry',
      value: `${r3(num(x.input_weight))} → ${x.output_weight === null ? 'in progress' : `${r3(num(x.output_weight))} kg`}${x.loss_percent === null || x.output_weight === null ? '' : ` · loss ${num(x.loss_percent)}%`}`,
      alert: x.loss_percent !== null && x.output_weight !== null && num(x.loss_percent) > ROAST_LOSS_ALERT,
    }));
    if (s.key === 'GRINDING') lines = d.grinding.map((x) => ({ label: `Mesh ${x.mesh_size} mm`, value: `${r3(num(x.input_weight))} → ${r3(num(x.output_weight))} kg · loss ${num(x.loss_percent)}%` }));
    if (s.key === 'BLENDING') lines = d.blending.map((x) => ({ label: 'Blended', value: `${r3(num(x.output_weight))} kg${x.mixing_duration_min ? ` · ${x.mixing_duration_min} min` : ''}` }));
    if (s.key === 'PACKING') lines = d.packing.map((x) => ({
      label: x.sku_code || `${x.bag_size_grams} g`,
      value: `${num(x.accepted_bag_count)} bags OK · ${num(x.rejected_bag_count)} rejected · ${r3(num(x.total_packing_weight))} kg`,
    }));

    return {
      key: s.key, label: s.label, status, on_hold: status === 'CURRENT' && b.status === 'ON_HOLD',
      started_at: r.started || null, ended_at: finished ? (r.ended || null) : null, operator: operators[s.key],
      in_kg: inKg, out_kg: outKg, loss_kg: lossKg, loss_pct: lossPct,
      loss_alert: s.key === 'ROASTING' && lossPct !== null && lossPct > ROAST_LOSS_ALERT,
      entries: s.key === 'BATCHING' ? d.batching.length : (d[s.key.toLowerCase()] || []).length, lines,
    };
  });

  const packedKg = has.PACKING ? raw.PACKING.out : null;
  const acceptedBags = d.packing.reduce((s, r) => s + num(r.accepted_bag_count), 0);
  const rejectedBags = d.packing.reduce((s, r) => s + num(r.rejected_bag_count), 0);
  return {
    batch: {
      id: b.id, batch_no: b.batch_no, product_name: b.product_name, product_code: b.product_code, recipe_no: b.recipe_no,
      status: b.status, current_stage: b.current_stage, hold_reason: b.hold_reason, production_date: b.production_date,
      planned_qty_kg: num(b.planned_qty_kg), current_output_kg: r3(num(b.current_output_kg)), total_wastage_kg: r3(num(b.total_wastage_kg)),
      needs_filtering: !!b.needs_filtering, completed_at: b.completed_at,
    },
    steps,
    totals: {
      weighed_kg: weighed || null, packed_kg: packedKg, accepted_bags: acceptedBags, rejected_bags: rejectedBags,
      yield_pct: weighed > 0 && packedKg !== null ? r2((packedKg / weighed) * 100) : null,
      wastage_kg: r3(num(b.total_wastage_kg)), roasting_loss_limit: ROAST_LOSS_ALERT,
    },
  };
}

async function detail(idRaw) {
  const id = v.toId(idRaw, 'batch');
  const [[b]] = await pool.query(
    `SELECT b.*, p.product_name, p.product_code, r.recipe_no
       FROM batch_master b JOIN product_master p ON p.id = b.product_id LEFT JOIN recipe_master r ON r.id = b.recipe_id WHERE b.id = ?`, [id]);
  if (!b) throw new AppError('Batch not found', 404);

  const [batching] = await pool.query(
    `SELECT bd.material_id, m.material_name, m.material_code, bd.weighed_qty, u.full_name AS done_by_name FROM batching_details bd
       JOIN materials m ON m.id = bd.material_id LEFT JOIN users u ON u.id = bd.done_by WHERE bd.batch_id = ? ORDER BY bd.id`, [id]);
  const [filtering] = await pool.query(
    `SELECT f.stages, f.input_weight, f.output_weight, f.wastage_weight, f.loss_percent, f.start_time, f.end_time, u.full_name AS done_by_name
       FROM filtering_details f LEFT JOIN users u ON u.id = f.done_by WHERE f.batch_id = ?`, [id]);
  const [roasting] = await pool.query(
    `SELECT r.id, mt.material_name, r.input_weight, r.output_weight, r.wastage_weight, r.loss_percent, r.start_time, r.end_time, r.status,
            u.full_name AS operator_name
       FROM roasting_details r LEFT JOIN materials mt ON mt.id = r.material_id LEFT JOIN users u ON u.id = r.operator_id
      WHERE r.batch_id = ? AND r.status <> 'REJECTED' ORDER BY r.id`, [id]);
  const [grinding] = await pool.query(
    `SELECT g.id, g.mesh_size, g.input_weight, g.output_weight, g.wastage_weight, g.loss_percent, g.input_time, g.output_time, g.status,
            u.full_name AS operator_name
       FROM grinding_details g LEFT JOIN users u ON u.id = g.operator_id WHERE g.batch_id = ? AND g.status <> 'REJECTED' ORDER BY g.id`, [id]);
  const [blending] = await pool.query(
    `SELECT bl.id, bl.total_input_weight, bl.output_weight, bl.wastage_weight, bl.start_time, bl.end_time, bl.mixing_duration_min, bl.status,
            u.full_name AS operator_name
       FROM blending_details bl LEFT JOIN users u ON u.id = bl.operator_id WHERE bl.batch_id = ? ORDER BY bl.id`, [id]);
  const [packing] = await pool.query(
    `SELECT pk.id, pk.packing_date, pk.bag_size_grams, pk.total_bag_count, pk.rejected_bag_count, pk.accepted_bag_count,
            pk.total_packing_weight, pk.rejected_weight, pk.accepted_weight, pr.sku_code, u.full_name AS operator_name
       FROM packing_details pk LEFT JOIN product_packing_rates pr ON pr.id = pk.packing_rate_id LEFT JOIN users u ON u.id = pk.operator_id
      WHERE pk.batch_id = ? AND pk.status <> 'CANCELLED' ORDER BY pk.id`, [id]);

  return buildTimeline(b, { batching, filtering, roasting, grinding, blending, packing });
}

module.exports = { board, detail, buildTimeline };