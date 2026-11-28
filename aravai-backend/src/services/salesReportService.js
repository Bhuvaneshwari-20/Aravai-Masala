// Sales dashboard + Monthly Sales & Profit report.
//
// Stock (packs):   closing = opening + production received - packs sold + returned packs put back - replacement packs sent +/- adjustments
//                  (production = accepted bags from packing_details, the same numbers Packing puts into finished_goods_stock)
// Profit (money):  net sales = gross sales - refunded returns
//                  cost of goods sold = cost of packs sold - cost of resaleable packs returned + cost of replacement packs sent
//                  (each pack is costed at the ACTUAL cost of the batch it came from: pouch + packing labour booked on Packing,
//                   plus raw material issued to the batch x purchase rate, spread over the batch output - see utils/salesStock.unitCost)
//                  estimated profit = net sales - cost of goods sold      (damaged returns are not restocked, so their cost stays as a loss)
// "Production cost" is the cost of the packs produced in the month (shown beside profit, NOT subtracted from it - only what was sold is costed).
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { r2 } = require('../utils/salesStock');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 36;
const pad = (n) => String(n).padStart(2, '0');
const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); return monthOf(new Date(y, m - 1 + n, 1)); };
const monthEnd = (key) => { const [y, m] = key.split('-').map(Number); return `${key}-${pad(new Date(y, m, 0).getDate())}`; };
const label = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' }); };
const n = (x) => Number(x) || 0;

// "AND col = ?" fragments for the optional product / SKU filter
function filt(q, productCol, rateCol) {
  let sql = ''; const args = [];
  if (q.product_id) { sql += ` AND ${productCol} = ?`; args.push(v.toId(q.product_id, 'product')); }
  if (q.packing_rate_id) { sql += ` AND ${rateCol} = ?`; args.push(v.toId(q.packing_rate_id, 'SKU')); }
  return { sql, args };
}

const RAW_PER_KG = `(SELECT b.id AS batch_id, COALESCE(SUM(bd.weighed_qty * mt.purchase_rate), 0) / NULLIF(b.current_output_kg, 0) AS raw_per_kg
                       FROM batch_master b LEFT JOIN batching_details bd ON bd.batch_id = b.id LEFT JOIN materials mt ON mt.id = bd.material_id
                      GROUP BY b.id, b.current_output_kg)`;

async function monthly(q = {}) {
  const thisMonth = monthOf(new Date());
  const to = q.to ? String(q.to) : thisMonth;
  const from = q.from ? String(q.from) : addMonths(to, -5);
  if (!MONTH_RE.test(from) || !MONTH_RE.test(to)) throw new AppError('Month must be in YYYY-MM format');
  if (from > to) throw new AppError('From month cannot be after To month');
  const span = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
  if (span > MAX_MONTHS) throw new AppError(`Choose at most ${MAX_MONTHS} months`);
  const end = monthEnd(to);

  const fp = filt(q, 'pd.product_id', 'pd.packing_rate_id');
  const fl = filt(q, 'l.product_id', 'l.packing_rate_id');
  const fi = filt(q, 'ii.product_id', 'ii.packing_rate_id');
  const fr = filt(q, 'ri.product_id', 'ri.packing_rate_id');
  const fa = filt(q, 'fg.product_id', 'fg.packing_rate_id');
  const COST = '(l.unit_material_cost + l.unit_packing_cost)';

  const [production] = await pool.query(
    `SELECT DATE_FORMAT(pd.packing_date, '%Y-%m') AS m, SUM(pd.accepted_bag_count) AS packs, SUM(pd.accepted_weight) AS kg,
            SUM(pd.total_bag_material_cost + pd.production_cost) AS packing_cost, SUM(pd.accepted_weight * COALESCE(br.raw_per_kg, 0)) AS material_cost
       FROM packing_details pd LEFT JOIN ${RAW_PER_KG} br ON br.batch_id = pd.batch_id
      WHERE pd.status <> 'CANCELLED' AND pd.packing_date <= ? ${fp.sql} GROUP BY m`, [end, ...fp.args]);
  const [moves] = await pool.query(
    `SELECT DATE_FORMAT(l.txn_date, '%Y-%m') AS m,
            SUM(IF(l.source_type = 'SALE', l.qty, 0)) AS sold, SUM(IF(l.source_type = 'RETURN', l.qty, 0)) AS restocked,
            SUM(IF(l.source_type = 'REPLACEMENT', l.qty, 0)) AS replaced,
            SUM(IF(l.source_type = 'SALE', l.qty * pr.weight_grams, 0)) / 1000 AS sold_kg,
            SUM(IF(l.direction = 'OUT', 1, -1) * CAST(l.qty AS SIGNED) * ${COST}) AS net_cost
       FROM sales_stock_ledger l JOIN sales_invoices i ON i.id = l.invoice_id JOIN product_packing_rates pr ON pr.id = l.packing_rate_id
      WHERE l.source_type <> 'CANCEL' AND i.status = 'ACTIVE' AND l.txn_date <= ? ${fl.sql} GROUP BY m`, [end, ...fl.args]);
  const [sales] = await pool.query(
    `SELECT DATE_FORMAT(i.invoice_date, '%Y-%m') AS m, SUM(ii.amount) AS gross, COUNT(DISTINCT i.id) AS invoices
       FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id
      WHERE i.status = 'ACTIVE' AND i.invoice_date <= ? ${fi.sql} GROUP BY m`, [end, ...fi.args]);
  const [returns] = await pool.query(
    `SELECT DATE_FORMAT(sr.return_date, '%Y-%m') AS m, SUM(ri.qty) AS returned, SUM(IF(ri.item_condition = 'DAMAGED', ri.qty, 0)) AS damaged,
            SUM(IF(sr.resolution = 'REFUND', ri.amount, 0)) AS refund_value, SUM(IF(sr.resolution = 'REFUND' AND sr.settlement_status = 'PENDING', ri.amount, 0)) AS refund_pending
       FROM sales_return_items ri JOIN sales_returns sr ON sr.id = ri.return_id JOIN sales_invoices i ON i.id = sr.invoice_id
      WHERE i.status = 'ACTIVE' AND sr.return_date <= ? ${fr.sql} GROUP BY m`, [end, ...fr.args]);
  const [adj] = await pool.query(
    `SELECT DATE_FORMAT(t.txn_date, '%Y-%m') AS m, SUM(t.quantity) AS qty
       FROM finished_goods_transactions t JOIN finished_goods_stock fg ON fg.id = t.fg_stock_id
      WHERE t.txn_type = 'ADJUSTMENT' AND t.txn_date <= ? ${fa.sql} GROUP BY m`, [end, ...fa.args]);

  const idx = (rows) => new Map(rows.map((r) => [r.m, r]));
  const P = idx(production); const M = idx(moves); const S = idx(sales); const R = idx(returns); const A = idx(adj);
  const all = [...P.keys(), ...M.keys(), ...S.keys(), ...R.keys(), ...A.keys(), from].sort();
  const rows = [];
  let running = 0; // stock rolled forward from the very first month, so the opening of `from` is exact
  for (let key = all[0]; key <= to; key = addMonths(key, 1)) {
    const p = P.get(key) || {}; const m = M.get(key) || {}; const s = S.get(key) || {}; const r = R.get(key) || {}; const a = A.get(key) || {};
    const opening = running;
    const production_received = n(p.packs); const sold = n(m.sold); const restocked = n(m.restocked); const replaced = n(m.replaced); const adjustments = n(a.qty);
    const closing = opening + production_received - sold + restocked - replaced + adjustments;
    running = closing;
    if (key < from) continue;
    const gross = r2(n(s.gross)); const returnsValue = r2(n(r.refund_value)); const netSales = r2(gross - returnsValue);
    const cogs = r2(n(m.net_cost)); const profit = r2(netSales - cogs);
    rows.push({
      month: key, label: label(key), opening_stock: opening, production_received, production_kg: r2(n(p.kg)), sold_kg: r2(n(m.sold_kg)), packs_sold: sold, packs_returned: n(r.returned),
      packs_restocked: restocked, packs_damaged: n(r.damaged), replacement_packs: replaced, adjustments, closing_stock: closing,
      invoices: n(s.invoices), gross_sales: gross, returns_value: returnsValue, refund_pending: r2(n(r.refund_pending)), net_sales: netSales,
      production_cost: r2(n(p.packing_cost) + n(p.material_cost)), packing_cost: r2(n(p.packing_cost)), material_cost: r2(n(p.material_cost)),
      cost_of_goods_sold: cogs, estimated_profit: profit, profit_margin_pct: netSales > 0 ? r2((profit / netSales) * 100) : 0,
    });
  }

  const sum = (k) => r2(rows.reduce((a, x) => a + x[k], 0));
  const totals = {
    opening_stock: rows[0].opening_stock, closing_stock: rows[rows.length - 1].closing_stock,
    ...Object.fromEntries(['production_received', 'production_kg', 'sold_kg', 'packs_sold', 'packs_returned', 'packs_restocked', 'packs_damaged', 'replacement_packs', 'adjustments', 'invoices',
      'gross_sales', 'returns_value', 'refund_pending', 'net_sales', 'production_cost', 'packing_cost', 'material_cost', 'cost_of_goods_sold', 'estimated_profit'].map((k) => [k, sum(k)])),
  };
  totals.profit_margin_pct = totals.net_sales > 0 ? r2((totals.estimated_profit / totals.net_sales) * 100) : 0;

  // stock the system holds right now (should equal the last closing stock when the range ends this month or later)
  const [[{ stock_now }]] = await pool.query(
    `SELECT COALESCE(SUM(fg.closing_stock), 0) AS stock_now FROM finished_goods_stock fg WHERE 1 = 1 ${fa.sql}`, fa.args);

  return {
    from, to, rows, totals, current_system_stock: n(stock_now),
    chart: {
      labels: rows.map((x) => x.label), gross_sales: rows.map((x) => x.gross_sales), net_sales: rows.map((x) => x.net_sales),
      production_cost: rows.map((x) => x.production_cost), cost_of_goods_sold: rows.map((x) => x.cost_of_goods_sold), estimated_profit: rows.map((x) => x.estimated_profit),
      packs_sold: rows.map((x) => x.packs_sold), packs_returned: rows.map((x) => x.packs_returned),
      closing_stock: rows.map((x) => x.closing_stock),
    },
    by_sku: await bySku(`${from}-01`, end, q),
  };
}

// sales and profit per SKU for the chosen months (for the "top products" chart / table)
async function bySku(fromDate, toDate, q) {
  const fi = filt(q, 'ii.product_id', 'ii.packing_rate_id');
  const fl = filt(q, 'l.product_id', 'l.packing_rate_id');
  const fr = filt(q, 'ri.product_id', 'ri.packing_rate_id');
  const [sales] = await pool.query(
    `SELECT ii.packing_rate_id, SUM(ii.amount) AS gross, SUM(ii.qty) AS packs FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id
      WHERE i.status = 'ACTIVE' AND i.invoice_date BETWEEN ? AND ? ${fi.sql} GROUP BY ii.packing_rate_id`, [fromDate, toDate, ...fi.args]);
  const [cost] = await pool.query(
    `SELECT l.packing_rate_id, SUM(IF(l.direction = 'OUT', 1, -1) * CAST(l.qty AS SIGNED) * (l.unit_material_cost + l.unit_packing_cost)) AS cogs
       FROM sales_stock_ledger l JOIN sales_invoices i ON i.id = l.invoice_id
      WHERE l.source_type <> 'CANCEL' AND i.status = 'ACTIVE' AND l.txn_date BETWEEN ? AND ? ${fl.sql} GROUP BY l.packing_rate_id`, [fromDate, toDate, ...fl.args]);
  const [ret] = await pool.query(
    `SELECT ri.packing_rate_id, SUM(IF(sr.resolution = 'REFUND', ri.amount, 0)) AS refund, SUM(ri.qty) AS packs
       FROM sales_return_items ri JOIN sales_returns sr ON sr.id = ri.return_id JOIN sales_invoices i ON i.id = sr.invoice_id
      WHERE i.status = 'ACTIVE' AND sr.return_date BETWEEN ? AND ? ${fr.sql} GROUP BY ri.packing_rate_id`, [fromDate, toDate, ...fr.args]);
  const ids = [...new Set([...sales, ...cost, ...ret].map((x) => x.packing_rate_id))];
  if (!ids.length) return [];
  const [skus] = await pool.query(
    `SELECT r.id, r.sku_code, r.packing_size_label, p.product_name FROM product_packing_rates r JOIN product_master p ON p.id = r.product_id WHERE r.id IN (?)`, [ids]);
  const S = new Map(sales.map((x) => [x.packing_rate_id, x])); const C = new Map(cost.map((x) => [x.packing_rate_id, x])); const R = new Map(ret.map((x) => [x.packing_rate_id, x]));
  return skus.map((k) => {
    const gross = r2(n(S.get(k.id)?.gross)); const refund = r2(n(R.get(k.id)?.refund)); const cogs = r2(n(C.get(k.id)?.cogs));
    return { packing_rate_id: k.id, sku_code: k.sku_code, product_name: k.product_name, packing_size_label: k.packing_size_label, packs_sold: n(S.get(k.id)?.packs),
      packs_returned: n(R.get(k.id)?.packs), gross_sales: gross, returns_value: refund, net_sales: r2(gross - refund), cost_of_goods_sold: cogs, estimated_profit: r2(gross - refund - cogs) };
  }).sort((a, b) => b.net_sales - a.net_sales);
}

/* ---------- Finished goods stock, product by product: every pack size with packs and KG (e.g. Chicken Masala 50g / 100g / 500g / 1kg) ---------- */
async function stockSummary(q = {}) {
  const w = []; const a = [];
  if (q.product_id) { w.push('p.id = ?'); a.push(v.toId(q.product_id, 'product')); }
  const [rows] = await pool.query(
    `SELECT p.id AS product_id, p.product_name, r.id AS packing_rate_id, r.sku_code, r.packing_size_label, r.weight_grams,
            COALESCE(SUM(fg.available_qty), 0) AS stock_packs
       FROM product_packing_rates r JOIN product_master p ON p.id = r.product_id LEFT JOIN finished_goods_stock fg ON fg.packing_rate_id = r.id
      WHERE r.is_active = 1 AND p.is_active = 1 ${w.length ? `AND ${w.join(' AND ')}` : ''}
      GROUP BY p.id, p.product_name, r.id, r.sku_code, r.packing_size_label, r.weight_grams ORDER BY p.product_name, r.weight_grams`, a);
  const products = []; const byId = new Map();
  for (const x of rows) {
    if (!byId.has(x.product_id)) { const p = { product_id: x.product_id, product_name: x.product_name, total_packs: 0, total_kg: 0, skus: [] }; byId.set(x.product_id, p); products.push(p); }
    const p = byId.get(x.product_id);
    const packs = n(x.stock_packs); const kg = Math.round((packs * n(x.weight_grams))) / 1000;
    p.skus.push({ packing_rate_id: x.packing_rate_id, sku_code: x.sku_code, packing_size_label: x.packing_size_label, weight_grams: n(x.weight_grams), stock_packs: packs, stock_kg: kg });
    p.total_packs += packs; p.total_kg = Math.round((p.total_kg + kg) * 1000) / 1000;
  }
  return {
    products,
    total_packs: products.reduce((s, p) => s + p.total_packs, 0),
    total_kg: Math.round(products.reduce((s, p) => s + p.total_kg, 0) * 1000) / 1000,
  };
}

/* ---------- Sales Dashboard ---------- */
// Response shape matches SalesDashboardScreen (frontend):
//   month_key, today{sales,invoices,packs}, month{gross_sales,packs_sold,returns_amount,returned_packs,net_sales,estimated_profit,profit_margin_pct},
//   trend[{date,gross,net}] (last 14 days), recent[], top_skus[{packs,amount}], stock[]
async function dashboard() {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const cur = monthOf(now);
  const rep = await monthly({ from: addMonths(cur, -5), to: cur });
  const m = rep.rows[rep.rows.length - 1];

  const [[t]] = await pool.query(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(total_amount), 0) AS sales, COALESCE(SUM(total_qty), 0) AS packs
       FROM sales_invoices WHERE status = 'ACTIVE' AND invoice_date = ?`, [today]);
  const [[tr]] = await pool.query(
    `SELECT COALESCE(SUM(ri.qty), 0) AS packs, COALESCE(SUM(IF(sr.resolution = 'REFUND', ri.amount, 0)), 0) AS value
       FROM sales_return_items ri JOIN sales_returns sr ON sr.id = ri.return_id JOIN sales_invoices i ON i.id = sr.invoice_id
      WHERE i.status = 'ACTIVE' AND sr.return_date = ?`, [today]);
  const [topCustomers] = await pool.query(
    `SELECT c.id, c.customer_name, c.customer_type, SUM(ii.amount - ii.refunded_amount) AS net_sales, SUM(ii.qty) AS packs
       FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id JOIN sales_customers c ON c.id = i.customer_id
      WHERE i.status = 'ACTIVE' AND DATE_FORMAT(i.invoice_date, '%Y-%m') = ? GROUP BY c.id, c.customer_name, c.customer_type ORDER BY net_sales DESC LIMIT 5`, [cur]);
  const [recentRows] = await pool.query(
    `SELECT i.id, i.invoice_no, i.invoice_date, c.customer_name, i.total_qty, i.total_amount,
            i.total_amount - COALESCE((SELECT SUM(ii.refunded_amount) FROM sales_invoice_items ii WHERE ii.invoice_id = i.id), 0) AS net_amount
       FROM sales_invoices i JOIN sales_customers c ON c.id = i.customer_id
      WHERE i.status = 'ACTIVE' ORDER BY i.id DESC LIMIT 5`);
  const [[pend]] = await pool.query("SELECT COUNT(*) AS c FROM sales_returns WHERE settlement_status = 'PENDING'");
  const deliveries = await require('./salesDeliveryService').list({ limit: 1 });
  const fgSummary = await stockSummary({});

  // last 14 days (oldest -> newest), zero-filled
  const days = Array.from({ length: 14 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - k));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [dailySales] = await pool.query(
    `SELECT DATE_FORMAT(invoice_date, '%Y-%m-%d') AS d, COALESCE(SUM(total_amount), 0) AS gross
       FROM sales_invoices WHERE status = 'ACTIVE' AND invoice_date BETWEEN ? AND ? GROUP BY d`, [days[0], days[13]]);
  const [dailyReturns] = await pool.query(
    `SELECT DATE_FORMAT(sr.return_date, '%Y-%m-%d') AS d, COALESCE(SUM(IF(sr.resolution = 'REFUND', ri.amount, 0)), 0) AS refund
       FROM sales_return_items ri JOIN sales_returns sr ON sr.id = ri.return_id JOIN sales_invoices i ON i.id = sr.invoice_id
      WHERE i.status = 'ACTIVE' AND sr.return_date BETWEEN ? AND ? GROUP BY d`, [days[0], days[13]]);
  const G = new Map(dailySales.map((x) => [x.d, n(x.gross)])); const RF = new Map(dailyReturns.map((x) => [x.d, n(x.refund)]));
  const trend = days.map((d) => ({ date: d, gross: r2(G.get(d) || 0), net: r2((G.get(d) || 0) - (RF.get(d) || 0)) }));

  const topSkus = (await bySku(`${cur}-01`, monthEnd(cur), {})).slice(0, 5)
    .map((x) => ({ ...x, packs: x.packs_sold, amount: x.net_sales }));

  const [stock] = await pool.query(
    `SELECT r.id AS packing_rate_id, r.sku_code, r.packing_size_label, r.weight_grams, p.product_name, COALESCE(SUM(fg.available_qty), 0) AS stock_packs
       FROM finished_goods_stock fg JOIN product_packing_rates r ON r.id = fg.packing_rate_id JOIN product_master p ON p.id = r.product_id
      GROUP BY r.id, r.sku_code, r.packing_size_label, r.weight_grams, p.product_name
     HAVING stock_packs > 0 ORDER BY p.product_name, r.id`);

  return {
    as_of: today, month_key: cur,
    today: { sales: r2(n(t.sales)), invoices: n(t.invoices), packs: n(t.packs), returns_value: r2(n(tr.value)), packs_returned: n(tr.packs) },
    month: {
      gross_sales: m.gross_sales, packs_sold: m.packs_sold, returns_amount: m.returns_value, returned_packs: m.packs_returned,
      net_sales: m.net_sales, estimated_profit: m.estimated_profit, profit_margin_pct: m.profit_margin_pct, invoices: m.invoices, closing_stock: m.closing_stock,
    },
    trend, top_skus: topSkus, top_customers: topCustomers,
    recent: recentRows.map((x) => ({ ...x, sale_date: x.invoice_date, total_packs: x.total_qty, net_amount: r2(n(x.net_amount)) })),
    stock: stock.map((x) => ({ ...x, stock_packs: n(x.stock_packs), stock_kg: Math.round(n(x.stock_packs) * n(x.weight_grams)) / 1000 })),
    stock_by_product: fgSummary.products, stock_total_kg: fgSummary.total_kg, stock_total_packs: fgSummary.total_packs,
    pending_returns: n(pend.c),
    deliveries: deliveries.summary,
    month_wise: rep.rows,
  };
}

/* ---------- Monthly Sales & Profit report (the screen: month + optional product) ---------- */
async function monthlyReport(q = {}) {
  const month = q.month ? String(q.month) : monthOf(new Date());
  if (!MONTH_RE.test(month)) throw new AppError('Month must be in YYYY-MM format');
  const f = {};
  if (q.product_id) f.product_id = q.product_id;
  const start = `${month}-01`; const end = monthEnd(month);

  const rep = await monthly({ from: addMonths(month, -11), to: month, ...f });
  const cur = rep.rows[rep.rows.length - 1];
  const skuSales = await bySku(start, end, f);

  const fa = filt(f, 'fg.product_id', 'fg.packing_rate_id');
  const fp = filt(f, 'pd.product_id', 'pd.packing_rate_id');
  const fl = filt(f, 'l.product_id', 'l.packing_rate_id');
  const fi = filt(f, 'ii.product_id', 'ii.packing_rate_id');
  const fr = filt(f, 'ri.product_id', 'ri.packing_rate_id');
  const SIGNED = "IF(t.txn_type = 'OUTWARD', -t.quantity, t.quantity)";

  const [bal] = await pool.query(
    `SELECT fg.packing_rate_id, SUM(IF(t.txn_date < ?, ${SIGNED}, 0)) AS opening, SUM(${SIGNED}) AS closing
       FROM finished_goods_transactions t JOIN finished_goods_stock fg ON fg.id = t.fg_stock_id
      WHERE t.txn_date <= ? ${fa.sql} GROUP BY fg.packing_rate_id`, [start, end, ...fa.args]);
  const [prod] = await pool.query(
    `SELECT pd.packing_rate_id, SUM(pd.accepted_bag_count) AS packs, SUM(pd.total_bag_material_cost + pd.production_cost) AS packing_cost,
            SUM(pd.accepted_weight * COALESCE(br.raw_per_kg, 0)) AS material_cost
       FROM packing_details pd LEFT JOIN ${RAW_PER_KG} br ON br.batch_id = pd.batch_id
      WHERE pd.status <> 'CANCELLED' AND pd.packing_date BETWEEN ? AND ? ${fp.sql} GROUP BY pd.packing_rate_id`, [start, end, ...fp.args]);
  const [rest] = await pool.query(
    `SELECT l.packing_rate_id, SUM(l.qty) AS restocked FROM sales_stock_ledger l JOIN sales_invoices i ON i.id = l.invoice_id
      WHERE l.source_type = 'RETURN' AND i.status = 'ACTIVE' AND l.txn_date BETWEEN ? AND ? ${fl.sql} GROUP BY l.packing_rate_id`, [start, end, ...fl.args]);

  const B = new Map(bal.map((x) => [x.packing_rate_id, x])); const P = new Map(prod.map((x) => [x.packing_rate_id, x]));
  const R = new Map(rest.map((x) => [x.packing_rate_id, x])); const S = new Map(skuSales.map((x) => [x.packing_rate_id, x]));
  const ids = [...new Set([...B.keys(), ...P.keys(), ...R.keys(), ...S.keys()])];
  let names = new Map();
  if (ids.length) {
    const [skus] = await pool.query(
      `SELECT r.id, r.sku_code, r.packing_size_label, p.product_name FROM product_packing_rates r JOIN product_master p ON p.id = r.product_id WHERE r.id IN (?)`, [ids]);
    names = new Map(skus.map((x) => [x.id, x]));
  }
  const rows = ids.filter((id) => names.has(id)).map((id) => {
    const k = names.get(id); const b = B.get(id) || {}; const p = P.get(id) || {}; const s = S.get(id) || {};
    return {
      packing_rate_id: id, product_name: k.product_name, packing_size_label: k.packing_size_label, sku_code: k.sku_code,
      opening_packs: n(b.opening), produced_packs: n(p.packs), sold_packs: n(s.packs_sold), returned_packs: n((R.get(id) || {}).restocked), closing_packs: n(b.closing),
      gross_sales: n(s.gross_sales), net_sales: n(s.net_sales), production_cost: r2(n(p.packing_cost) + n(p.material_cost)), estimated_profit: n(s.estimated_profit),
    };
  }).filter((r) => r.opening_packs || r.produced_packs || r.sold_packs || r.returned_packs || r.closing_packs || r.gross_sales)
    .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.packing_rate_id - b.packing_rate_id);

  // day by day for the chosen month (up to today when it is the current month)
  const [dg] = await pool.query(
    `SELECT i.invoice_date AS d, SUM(ii.amount) AS v FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id
      WHERE i.status = 'ACTIVE' AND i.invoice_date BETWEEN ? AND ? ${fi.sql} GROUP BY i.invoice_date`, [start, end, ...fi.args]);
  const [dr] = await pool.query(
    `SELECT sr.return_date AS d, SUM(IF(sr.resolution = 'REFUND', ri.amount, 0)) AS v
       FROM sales_return_items ri JOIN sales_returns sr ON sr.id = ri.return_id JOIN sales_invoices i ON i.id = sr.invoice_id
      WHERE i.status = 'ACTIVE' AND sr.return_date BETWEEN ? AND ? ${fr.sql} GROUP BY sr.return_date`, [start, end, ...fr.args]);
  const [dc] = await pool.query(
    `SELECT l.txn_date AS d, SUM(IF(l.direction = 'OUT', 1, -1) * CAST(l.qty AS SIGNED) * (l.unit_material_cost + l.unit_packing_cost)) AS v
       FROM sales_stock_ledger l JOIN sales_invoices i ON i.id = l.invoice_id
      WHERE l.source_type <> 'CANCEL' AND i.status = 'ACTIVE' AND l.txn_date BETWEEN ? AND ? ${fl.sql} GROUP BY l.txn_date`, [start, end, ...fl.args]);
  const G = new Map(dg.map((x) => [x.d, n(x.v)])); const RF = new Map(dr.map((x) => [x.d, n(x.v)])); const CG = new Map(dc.map((x) => [x.d, n(x.v)]));
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const lastDay = Number(end.slice(8));
  const daily = [];
  for (let d = 1; d <= lastDay; d += 1) {
    const key = `${month}-${pad(d)}`;
    if (key > today) break;
    const gross = r2(G.get(key) || 0); const net = r2(gross - (RF.get(key) || 0));
    daily.push({ date: key, gross, net, profit: r2(net - (CG.get(key) || 0)) });
  }

  const [products] = await pool.query('SELECT id, product_name FROM product_master WHERE is_active = 1 ORDER BY product_name');
  return {
    month, products, rows, daily,
    months: rep.rows.map((x) => ({ month: x.month, net: x.net_sales, profit: x.estimated_profit })),
    month_wise: rep.rows, month_wise_totals: rep.totals,
    totals: {
      opening_packs: cur.opening_stock, produced_packs: cur.production_received, sold_packs: cur.packs_sold, returned_packs: cur.packs_restocked,
      closing_packs: cur.closing_stock, gross_sales: cur.gross_sales, returns_amount: cur.returns_value, net_sales: cur.net_sales,
      production_cost: cur.production_cost, estimated_profit: cur.estimated_profit,
    },
    cost_note: 'Estimated profit = net sales - actual production and packing cost of the packs sold. Production cost is the cost of packs produced this month.',
  };
}

async function monthlyCsv(q = {}) {
  const d = await monthlyReport(q);
  const esc = (x) => { const t = String(x ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Product', 'Pack size', 'SKU', 'Opening', 'Production', 'Sold', 'Returned', 'Closing', 'Gross sales', 'Net sales', 'Production cost', 'Estimated profit'];
  const lines = [head.join(',')].concat(d.rows.map((r) => [r.product_name, r.packing_size_label, r.sku_code, r.opening_packs, r.produced_packs, r.sold_packs,
    r.returned_packs, r.closing_packs, r.gross_sales, r.net_sales, r.production_cost, r.estimated_profit].map(esc).join(',')));
  return { name: `sales-report-${d.month}.csv`, csv: `${lines.join('\r\n')}\r\n` };
}

module.exports = { monthly, dashboard, monthlyReport, monthlyCsv, stockSummary };