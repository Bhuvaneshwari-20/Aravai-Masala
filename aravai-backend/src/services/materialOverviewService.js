const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { lowLevelSql } = require('../utils/lowStock');

// Stock that will last this many days or less is flagged "running out" (set MATERIAL_SOON_DAYS in .env to change)
const SOON_DAYS = Number(process.env.MATERIAL_SOON_DAYS) || 7;
// Actual weight differing from the recipe by more than this % is flagged (set MATERIAL_VARIANCE_PERCENT in .env)
const VARIANCE_PCT = Number(process.env.MATERIAL_VARIANCE_PERCENT) || 5;
// Same limit the Roasting screen uses
const ROAST_LOSS_ALERT = Number(process.env.ROASTING_LOSS_ALERT_PERCENT) || 12;

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const num = (x) => (x === null || x === undefined ? 0 : Number(x));

// stock transaction -> batch: older rows have batch_id, others only the batch number in reference_no.
// COLLATE is needed because material_stock_transactions is utf8mb4_general_ci and batch_master is utf8mb4_unicode_ci.
const TXN_BATCH_JOIN = `LEFT JOIN batch_master tb ON tb.id = t.batch_id OR (t.batch_id IS NULL AND t.reference_type = 'BATCH' AND tb.batch_no = t.reference_no COLLATE utf8mb4_unicode_ci)`;

/* ---------------------------------------------------------------- summary */
// One row per active material: stock, low flag, used this month, days of stock left, average roasting loss
async function summary(q) {
  const search = v.clean(q.search);
  const args = [];
  // only materials that already have a Material Receipt (or opening stock) are tracked here
  let where = "WHERE m.is_active = 1 AND EXISTS (SELECT 1 FROM material_stock_transactions t WHERE t.material_id = m.id AND t.txn_type IN ('INWARD','OPENING'))";
  if (search) { where += ' AND (m.material_name LIKE ? OR m.material_code LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  if (v.clean(q.category_id)) { where += ' AND m.category_id = ?'; args.push(v.toId(q.category_id, 'category')); }


    // ---- Stock tracking figures per material (Stock In / Stock Out / Transactions in the chosen period) ----
  // optional ?from=YYYY-MM-DD ; no 'from' = all time. Opening = current - in + out, so Opening + In - Out = Current always.
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? String(q.from) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? String(q.to) : null;
  const mvWhere = [from && 'txn_date >= ?', to && 'txn_date < DATE_ADD(?, INTERVAL 1 DAY)'].filter(Boolean);
  const mvArgs = [from, to].filter(Boolean);
  const [mvRows] = await pool.query(
    `SELECT material_id,
            COALESCE(SUM(CASE WHEN txn_type <> 'OPENING' THEN inward_qty ELSE 0 END), 0) AS total_in,
            COALESCE(SUM(despatch_qty), 0) AS total_out,
            COUNT(*) AS txn_count,
            MAX(CASE WHEN txn_type <> 'OPENING' AND inward_qty > 0 THEN txn_date END) AS last_in,
            MAX(CASE WHEN despatch_qty > 0 THEN txn_date END) AS last_out
       FROM material_stock_transactions
      ${mvWhere.length ? `WHERE ${mvWhere.join(' AND ')}` : ''}
      GROUP BY material_id`, mvArgs);
  const mvMap = new Map(mvRows.map((x) => [x.material_id, x]));


  
  // this month vs last month, for the "% vs last month" on the KPI cards (ignores the From / To filter)
  const mStart = "DATE_FORMAT(CURDATE(), '%Y-%m-01')";
  const [trRows] = await pool.query(
    `SELECT material_id,
            SUM(CASE WHEN txn_type <> 'OPENING' AND txn_date >= ${mStart} THEN inward_qty ELSE 0 END) AS in_cur,
            SUM(CASE WHEN txn_date >= ${mStart} THEN despatch_qty ELSE 0 END) AS out_cur,
            SUM(CASE WHEN txn_type <> 'OPENING' AND txn_date >= DATE_SUB(${mStart}, INTERVAL 1 MONTH) AND txn_date < ${mStart} THEN inward_qty ELSE 0 END) AS in_prev,
            SUM(CASE WHEN txn_date >= DATE_SUB(${mStart}, INTERVAL 1 MONTH) AND txn_date < ${mStart} THEN despatch_qty ELSE 0 END) AS out_prev
       FROM material_stock_transactions GROUP BY material_id`);
  const trMap = new Map(trRows.map((x) => [x.material_id, x]));

  const [rows] = await pool.query(
    `SELECT m.id, m.material_code, m.material_name, m.unit, m.current_stock, ${lowLevelSql('m')} AS minimum_stock, c.category_name,
            COALESCE(u.used_month, 0) AS used_month, COALESCE(u.used_30, 0) AS used_30,
            rl.roast_in, rl.roast_waste
       FROM materials m
       JOIN material_categories c ON c.id = m.category_id
       LEFT JOIN (
         SELECT material_id,
                SUM(CASE WHEN txn_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN despatch_qty ELSE 0 END) AS used_month,
                SUM(CASE WHEN txn_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN despatch_qty ELSE 0 END) AS used_30
           FROM material_stock_transactions
          WHERE txn_type = 'ISSUE' AND COALESCE(issue_type, '') <> 'RETURN_TO_VENDOR'
          GROUP BY material_id) u ON u.material_id = m.id
       LEFT JOIN (
         SELECT material_id, SUM(input_weight) AS roast_in, SUM(wastage_weight) AS roast_waste
           FROM roasting_details WHERE status = 'COMPLETED' AND material_id IS NOT NULL GROUP BY material_id) rl ON rl.material_id = m.id
       ${where} ORDER BY m.material_name`, args);

  const items = rows.map((r) => {
    const stock = num(r.current_stock);
    const min = num(r.minimum_stock);
    const daily = num(r.used_30) / 30;
    const days = daily > 0 ? Math.floor(stock / daily) : null;
    let state = 'OK';
    if (stock <= 0) state = 'OUT';
    else if (stock <= min) state = 'LOW';
    else if (days !== null && days <= SOON_DAYS) state = 'SOON';
        const mv = mvMap.get(r.id) || {};
            const tr = trMap.get(r.id) || {};

    const tin = num(mv.total_in);
    const tout = num(mv.total_out);

     return {
      id: r.id, material_code: r.material_code, material_name: r.material_name, category_name: r.category_name, unit: r.unit,
      current_stock: stock, minimum_stock: min, is_low: stock <= min, state,
      used_month: r3(num(r.used_month)), days_of_stock: days,
      roast_loss_pct: num(r.roast_in) > 0 ? r2((num(r.roast_waste) / num(r.roast_in)) * 100) : null,
      total_in: r3(tin), total_out: r3(tout), txn_count: num(mv.txn_count), opening_stock: r3(stock - tin + tout),
            last_in_date: mv.last_in || null, last_out_date: mv.last_out || null,

                  in_cur: r3(num(tr.in_cur)), out_cur: r3(num(tr.out_cur)), in_prev: r3(num(tr.in_prev)), out_prev: r3(num(tr.out_prev)),

    };
  });

  const summaryCards = {
    total: items.length,
    low: items.filter((i) => i.state === 'LOW').length,
    out: items.filter((i) => i.state === 'OUT').length,
    soon: items.filter((i) => i.state === 'SOON').length,
    used_month_kg: r3(items.filter((i) => String(i.unit).toUpperCase() === 'KG').reduce((a, i) => a + i.used_month, 0)),
    soon_days: SOON_DAYS,
  };

    const toKg = (i, q) => (String(i.unit).toUpperCase() === 'GRAM' ? q / 1000 : String(i.unit).toUpperCase() === 'KG' ? q : 0);
  summaryCards.stock_kg = r3(items.reduce((a, i) => a + toKg(i, i.current_stock), 0));
  summaryCards.in_kg = r3(items.reduce((a, i) => a + toKg(i, i.total_in), 0));
  summaryCards.out_kg = r3(items.reduce((a, i) => a + toKg(i, i.total_out), 0));
  summaryCards.txn_total = items.reduce((a, i) => a + i.txn_count, 0);

    ['in_cur', 'out_cur', 'in_prev', 'out_prev'].forEach((k) => { summaryCards[`${k}_kg`] = r3(items.reduce((a, i) => a + toKg(i, i[k]), 0)); });

  const f = String(q.filter || '').toUpperCase();
  const shown = f === 'LOW' ? items.filter((i) => i.state === 'LOW' || i.state === 'OUT')
    : f === 'OUT' ? items.filter((i) => i.state === 'OUT')
    : f === 'SOON' ? items.filter((i) => i.state === 'SOON') : items;
  return { items: shown, summary: summaryCards };
}

/* ---------------------------------------------------------- material trace */
// One material: which batches used it, its roasting loss, stock in/out ledger linked to batch numbers
async function materialTrace(idRaw) {
  const id = v.toId(idRaw, 'material');
  const [[m]] = await pool.query(
    `SELECT m.id, m.material_code, m.material_name, m.unit, m.current_stock, ${lowLevelSql('m')} AS minimum_stock, m.place, c.category_name
       FROM materials m JOIN material_categories c ON c.id = m.category_id WHERE m.id = ?`, [id]);
  if (!m) throw new AppError('Material not found', 404);

  const [batches] = await pool.query(
    `SELECT b.id AS batch_id, b.batch_no, b.production_date, b.status, b.current_stage, p.product_name, SUM(bd.weighed_qty) AS qty
       FROM batching_details bd
       JOIN batch_master b ON b.id = bd.batch_id
       JOIN product_master p ON p.id = b.product_id
      WHERE bd.material_id = ? GROUP BY b.id, b.batch_no, b.production_date, b.status, b.current_stage, p.product_name
      ORDER BY b.id DESC LIMIT 50`, [id]);

  const [roast] = await pool.query(
    `SELECT r.id, b.batch_no, r.roast_date, r.input_weight, r.output_weight, r.wastage_weight, r.loss_percent
       FROM roasting_details r JOIN batch_master b ON b.id = r.batch_id
      WHERE r.material_id = ? AND r.status = 'COMPLETED' ORDER BY r.id DESC LIMIT 50`, [id]);
  const [[rt]] = await pool.query(
    `SELECT COALESCE(SUM(input_weight),0) AS input, COALESCE(SUM(wastage_weight),0) AS waste, COUNT(*) AS n
       FROM roasting_details WHERE material_id = ? AND status = 'COMPLETED'`, [id]);

  const [ledger] = await pool.query(
    `SELECT t.id, t.txn_date, t.txn_type, t.issue_type, t.inward_qty, t.despatch_qty, t.closing_stock, t.purpose, t.grn_no,
            t.agency_supplier, t.reference_no, tb.id AS batch_id, tb.batch_no, tp.product_name
       FROM material_stock_transactions t ${TXN_BATCH_JOIN}
       LEFT JOIN product_master tp ON tp.id = tb.product_id
      WHERE t.material_id = ? ORDER BY t.txn_date DESC, t.id DESC LIMIT 100`, [id]);
  const [[tot]] = await pool.query(
    `SELECT COALESCE(SUM(inward_qty),0) AS received,
            COALESCE(SUM(CASE WHEN txn_type = 'ISSUE' AND COALESCE(issue_type,'') <> 'RETURN_TO_VENDOR' THEN despatch_qty ELSE 0 END),0) AS issued
       FROM material_stock_transactions WHERE material_id = ?`, [id]);


         // balance before the first ledger entry (opening stock) + a breakdown so the page always adds up
  const [[first]] = await pool.query(
    'SELECT opening_stock FROM material_stock_transactions WHERE material_id = ? ORDER BY id ASC LIMIT 1', [id]);
  const [[mv]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN txn_type = 'INWARD' THEN inward_qty END),0) AS received_qty,
            COALESCE(SUM(CASE WHEN txn_type = 'ADJUSTMENT_IN' THEN inward_qty END),0) AS correction_in,
            COALESCE(SUM(CASE WHEN txn_type = 'ADJUSTMENT_OUT' THEN despatch_qty END),0) AS correction_out,
            COALESCE(SUM(CASE WHEN txn_type = 'ISSUE' AND issue_type = 'RETURN_TO_VENDOR' THEN despatch_qty END),0) AS returned_qty
       FROM material_stock_transactions WHERE material_id = ?`, [id]);

  const lossPct = num(rt.input) > 0 ? r2((num(rt.waste) / num(rt.input)) * 100) : null;
  return {
    material: { ...m, current_stock: num(m.current_stock), minimum_stock: num(m.minimum_stock) },
    totals: {
      batch_count: batches.length, used_in_batches_kg: r3(batches.reduce((a, b) => a + num(b.qty), 0)),
      received: r3(num(tot.received)), issued: r3(num(tot.issued)),
      opening_balance: r3(num(first && first.opening_stock)), received_qty: r3(num(mv.received_qty)),
      correction_in: r3(num(mv.correction_in)), correction_out: r3(num(mv.correction_out)), returned_qty: r3(num(mv.returned_qty)),      roast_entries: rt.n, roast_input_kg: r3(num(rt.input)), roast_loss_kg: r3(num(rt.waste)), roast_loss_pct: lossPct,
      roast_loss_limit: ROAST_LOSS_ALERT, roast_loss_alert: lossPct !== null && lossPct > ROAST_LOSS_ALERT,
    },
    batches: batches.map((b) => ({ ...b, qty: r3(num(b.qty)) })),
    roasting: roast.map((r) => ({ ...r, loss_alert: r.loss_percent !== null && num(r.loss_percent) > ROAST_LOSS_ALERT })),
    ledger,
  };
}

/* ---------------------------------------------------------------- batches */
// Batch picker for the reverse trace
async function batches(q) {
  const { page, limit, offset } = v.paging(q);
  const search = v.clean(q.search);
  const args = [];
  let like = '';
  if (search) { like = ' AND (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const base = `FROM batch_master b JOIN product_master p ON p.id = b.product_id WHERE 1=1${like}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${base}`, args);
  const [rows] = await pool.query(
    `SELECT b.id, b.batch_no, b.production_date, b.status, b.current_stage, b.planned_qty_kg, p.product_name,
            (SELECT COUNT(*) FROM batching_details bd WHERE bd.batch_id = b.id) AS material_count
       ${base} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

/* ------------------------------------------------------------ batch trace */
// Reverse trace + recipe vs actual: which materials went into this batch, how much, vs what the recipe says
async function batchTrace(idRaw) {
  const id = v.toId(idRaw, 'batch');
  const [[b]] = await pool.query(
    `SELECT b.id, b.batch_no, b.production_date, b.status, b.current_stage, b.planned_qty_kg, p.product_name, r.recipe_no, r.id AS recipe_id, r.base_quantity_kg
       FROM batch_master b JOIN product_master p ON p.id = b.product_id LEFT JOIN recipe_master r ON r.id = b.recipe_id WHERE b.id = ?`, [id]);
  if (!b) throw new AppError('Batch not found', 404);

  const [recipe] = b.recipe_id ? await pool.query(
    'SELECT material_id, quantity_kg, percentage FROM recipe_details WHERE recipe_id = ?', [b.recipe_id]) : [[]];
  const [actual] = await pool.query(
    `SELECT bd.material_id, m.material_code, m.material_name, m.unit, SUM(bd.weighed_qty) AS qty
       FROM batching_details bd JOIN materials m ON m.id = bd.material_id WHERE bd.batch_id = ? GROUP BY bd.material_id, m.material_code, m.material_name, m.unit`, [id]);
  const [roast] = await pool.query(
    `SELECT material_id, SUM(input_weight) AS input, SUM(wastage_weight) AS waste FROM roasting_details
      WHERE batch_id = ? AND status = 'COMPLETED' AND material_id IS NOT NULL GROUP BY material_id`, [id]);
  const [txns] = await pool.query(
    `SELECT t.material_id, t.txn_date, t.despatch_qty, t.closing_stock, t.reference_no
       FROM material_stock_transactions t ${TXN_BATCH_JOIN} WHERE tb.id = ? AND t.txn_type = 'ISSUE'`, [id]);
  const [recipeNames] = recipe.length ? await pool.query(
    'SELECT id, material_code, material_name, unit FROM materials WHERE id IN (?)', [recipe.map((r) => r.material_id)]) : [[]];
  const [packed] = await pool.query(
    `SELECT pr.sku_code, pr.packing_size_label, SUM(pk.accepted_bag_count) AS bags, SUM(pk.rejected_bag_count) AS rejected, SUM(pk.accepted_weight) AS kg
       FROM packing_details pk LEFT JOIN product_packing_rates pr ON pr.id = pk.packing_rate_id
      WHERE pk.batch_id = ? AND pk.status <> 'CANCELLED' GROUP BY pr.sku_code, pr.packing_size_label`, [id]);

  const totalActual = r3(actual.reduce((a, x) => a + num(x.qty), 0));
  const info = new Map();
  recipeNames.forEach((x) => info.set(x.id, x));
  actual.forEach((x) => info.set(x.material_id, { id: x.material_id, material_code: x.material_code, material_name: x.material_name, unit: x.unit }));
  const rec = new Map(recipe.map((x) => [x.material_id, x]));
  const act = new Map(actual.map((x) => [x.material_id, num(x.qty)]));
  const rst = new Map(roast.map((x) => [x.material_id, x]));
  const iss = new Map(txns.map((x) => [x.material_id, x]));

  const ids = [...new Set([...rec.keys(), ...act.keys()])];
  const materials = ids.map((mid) => {
    const m = info.get(mid) || {};
    const rd = rec.get(mid);
    // recipe share of the batch: percentage, or kg against the recipe base quantity
    const recipePct = rd ? (rd.percentage !== null && rd.percentage !== undefined ? num(rd.percentage) : (num(rd.quantity_kg) / (num(b.base_quantity_kg) || 100)) * 100) : null;
    const actualKg = act.get(mid) || 0;
    const expectedKg = recipePct !== null && totalActual > 0 ? r3((recipePct / 100) * totalActual) : null;
    const diffKg = expectedKg !== null ? r3(actualKg - expectedKg) : null;
    const diffPct = expectedKg ? r2((diffKg / expectedKg) * 100) : null;
    const rl = rst.get(mid);
    const lossPct = rl && num(rl.input) > 0 ? r2((num(rl.waste) / num(rl.input)) * 100) : null;
    const tx = iss.get(mid);
    let flag = null;
    if (!rd) flag = 'NOT IN RECIPE';
    else if (actualKg === 0) flag = 'NOT WEIGHED';
    else if (diffPct !== null && Math.abs(diffPct) > VARIANCE_PCT) flag = diffPct > 0 ? 'OVER' : 'UNDER';
    return {
      material_id: mid, material_code: m.material_code, material_name: m.material_name, unit: m.unit,
      recipe_pct: recipePct !== null ? r2(recipePct) : null, expected_kg: expectedKg, actual_kg: r3(actualKg),
      actual_pct: totalActual > 0 ? r2((actualKg / totalActual) * 100) : null, diff_kg: diffKg, diff_pct: diffPct, flag,
      roast_loss_pct: lossPct, roast_loss_alert: lossPct !== null && lossPct > ROAST_LOSS_ALERT,
      stock_date: tx ? tx.txn_date : null, stock_after: tx ? num(tx.closing_stock) : null,
    };
  }).sort((a, c) => (c.actual_kg - a.actual_kg));

  return {
    batch: { ...b, planned_qty_kg: num(b.planned_qty_kg) },
    totals: { weighed_kg: totalActual, materials: materials.length, flagged: materials.filter((m) => m.flag).length, variance_limit: VARIANCE_PCT, roast_loss_limit: ROAST_LOSS_ALERT },
    materials,
    packed: packed.map((p) => ({ ...p, bags: num(p.bags), rejected: num(p.rejected), kg: r3(num(p.kg)) })),
  };
}


/* ------------------------------------------------------------ transactions */
// Stock In / Stock Out history across ALL materials (latest 1000). type = IN | OUT, optional from=YYYY-MM-DD, search = name / code
async function transactions(q) {
  const dir = String(q.type || '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
  const search = v.clean(q.search);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? String(q.from) : null;
  const args = [];
  let where = dir === 'IN' ? "WHERE t.inward_qty > 0 AND t.txn_type <> 'OPENING'" : 'WHERE t.despatch_qty > 0';
  if (from) { where += ' AND t.txn_date >= ?'; args.push(from); }
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? String(q.to) : null;
  if (to) { where += ' AND t.txn_date < DATE_ADD(?, INTERVAL 1 DAY)'; args.push(to); }
  if (search) { where += ' AND (m.material_name LIKE ? OR m.material_code LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const [rows] = await pool.query(
    `SELECT t.id, t.txn_date, t.txn_type, t.issue_type, t.inward_qty, t.despatch_qty, t.closing_stock, t.purpose, t.grn_no,
            t.agency_supplier, t.reference_no, m.material_name, m.material_code, m.unit, tb.batch_no, tp.product_name
       FROM material_stock_transactions t
       JOIN materials m ON m.id = t.material_id
       ${TXN_BATCH_JOIN}
       LEFT JOIN product_master tp ON tp.id = tb.product_id
       ${where} ORDER BY t.txn_date DESC, t.id DESC LIMIT 1000`, args);
  return { items: rows.map((r) => ({ ...r, inward_qty: num(r.inward_qty), despatch_qty: num(r.despatch_qty), closing_stock: num(r.closing_stock) })) };
}

module.exports = { summary, materialTrace, batches, batchTrace, transactions };

