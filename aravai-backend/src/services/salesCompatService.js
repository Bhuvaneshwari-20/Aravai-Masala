// Adapters between the Sales screens in the app and the sales services.
// The app sends / expects: sale_date, quantity, notes, name, skus[], status, return_type, packs, gross, net ...
// The services use:        invoice_date, qty, remarks, customer_name, products[], settlement_status, resolution ...
// Nothing here changes stock or money logic: every write goes through salesService / salesReturnService.
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const sales = require('./salesService');
const returns = require('./salesReturnService');
const { r2 } = require('../utils/salesStock');
const deliveries = require('./salesDeliveryService');

const n = (x) => Number(x) || 0;
const toServiceCondition = (c) => { const u = String(c || 'RESALABLE').toUpperCase(); return u === 'RESALABLE' ? 'RESALEABLE' : u; };
const toAppCondition = (c) => (c === 'RESALEABLE' ? 'RESALABLE' : c);

/* ---------- lookups: customers (name) + flat skus (stock_packs) ---------- */
async function lookups() {
  const base = await sales.lookups();
  const skus = base.products.flatMap((p) => p.skus.map((s) => ({ ...s, stock_packs: n(s.available_qty) })));
  const customers = base.customers.map((c) => ({ ...c, name: c.customer_name }));
  return { ...base, customers, skus, ...returns.lookups() };
}

/* ---------- new sale ---------- */
function createSale(body, userId, ip) {
  return sales.createInvoice({
    invoice_no: body.invoice_no, invoice_date: body.sale_date, customer_id: body.customer_id, payment_mode: body.payment_mode, remarks: body.notes,
    items: (Array.isArray(body.items) ? body.items : []).map((i) => ({ packing_rate_id: i && i.packing_rate_id, qty: i && (i.quantity ?? i.qty), rate: i && i.rate })),
  }, userId, ip);
}

/* ---------- invoice list: GET /sales ---------- */
async function listSales(q) {
  const h = await sales.history({ ...q, group: 'invoice', status: q.status || 'ACTIVE' });
  const ids = h.items.map((x) => x.id);
  const summary = new Map();
  if (ids.length) {
    const [rows] = await pool.query(
      `SELECT ii.invoice_id, GROUP_CONCAT(CONCAT(p.product_name, ' ', r.packing_size_label, ' x ', ii.qty) ORDER BY ii.id SEPARATOR ', ') AS s
         FROM sales_invoice_items ii JOIN product_master p ON p.id = ii.product_id JOIN product_packing_rates r ON r.id = ii.packing_rate_id
        WHERE ii.invoice_id IN (?) GROUP BY ii.invoice_id`, [ids]);
    rows.forEach((x) => summary.set(x.invoice_id, x.s));
  }
  const t = h.totals || {};
  const dStatus = await deliveries.statusForInvoices(ids);
  return {
    ...h,
    items: h.items.map((x) => ({
      ...x, sale_date: x.invoice_date, item_count: n(x.line_count), total_packs: n(x.packs_sold), total_amount: n(x.gross_sales),
      returned_amount: n(x.returns_value), net_amount: n(x.net_sales), items_summary: summary.get(x.id) || '',
      delivery_status: x.status === 'CANCELLED' ? null : (dStatus.get(x.id) || {}).status || 'PENDING',
      delivered_packs: (dStatus.get(x.id) || {}).received || 0, dispatched_packs: (dStatus.get(x.id) || {}).sent || 0,
    })),
    summary: { invoices: n(t.invoices), packs: n(t.packs_sold), gross: n(t.gross_sales), returns: n(t.returns_value), net: n(t.net_sales) },
  };
}

/* ---------- date / customer / SKU wise: GET /sales/history?group= ---------- */
async function groupHistory(q) {
  const h = await sales.history(q);
  if (!['date', 'customer', 'sku'].includes(h.group)) return h;
  const t = h.totals || {};
  return {
    ...h,
    items: h.items.map((x) => ({
      ...x,
      key: h.group === 'date' ? x.label : h.group === 'customer' ? x.customer_id : x.packing_rate_id,
      sub: h.group === 'customer' ? (x.customer_type === 'AGENCY' ? 'Agency' : 'Customer') : h.group === 'sku' ? x.sku_code : undefined,
      packs: n(x.packs_sold), gross: n(x.gross_sales), net: n(x.net_sales), returns: n(x.returns_value), returned_packs: n(x.packs_returned),
    })),
    summary: { invoices: n(t.invoices), packs: n(t.packs_sold), gross: n(t.gross_sales), returns: n(t.returns_value), net: n(t.net_sales) },
  };
}

/* ---------- one invoice: GET /sales/:id ---------- */
async function getSale(id) {
  const inv = await sales.getInvoice(id);
  const [[c]] = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(IF(direction = 'OUT', 1, -1) * CAST(qty AS SIGNED) * (unit_material_cost + unit_packing_cost)), 0) AS cogs
       FROM sales_stock_ledger WHERE invoice_id = ? AND source_type <> 'CANCEL'`, [inv.id]);
  const cost = n(c.cnt) > 0 && inv.status !== 'CANCELLED' ? r2(n(c.cogs)) : null;

  let moves = [];
  const skuIds = [...new Set(inv.items.map((i) => i.packing_rate_id))];
  const refs = [inv.invoice_no, ...inv.returns.map((r) => r.return_no)];
  if (skuIds.length) {
    [moves] = await pool.query(
      `SELECT x.* FROM (
         SELECT t.id, t.txn_date, t.txn_type, t.reference_no, t.remarks AS purpose, r.sku_code,
                CASE WHEN t.txn_type = 'INWARD' THEN t.quantity WHEN t.txn_type = 'ADJUSTMENT' AND t.quantity > 0 THEN t.quantity ELSE 0 END AS received,
                CASE WHEN t.txn_type = 'OUTWARD' THEN t.quantity WHEN t.txn_type = 'ADJUSTMENT' AND t.quantity < 0 THEN -t.quantity ELSE 0 END AS issue,
                SUM(CASE WHEN t.txn_type = 'OUTWARD' THEN -t.quantity ELSE t.quantity END) OVER (PARTITION BY fg.packing_rate_id ORDER BY t.txn_date, t.id) AS balance
           FROM finished_goods_transactions t JOIN finished_goods_stock fg ON fg.id = t.fg_stock_id JOIN product_packing_rates r ON r.id = fg.packing_rate_id
          WHERE fg.packing_rate_id IN (?)) x
        WHERE x.reference_no IN (?) ORDER BY x.txn_date, x.id`, [skuIds, refs]);
  }
  return {
    ...inv, sale_date: inv.invoice_date, notes: inv.remarks,
    items: inv.items.map((it) => ({ ...it, quantity: it.qty })),
    gross_amount: n(inv.total_amount), returned_amount: n(inv.refunded_amount), net_amount: n(inv.net_amount),
    cost_amount: cost, profit: cost === null ? null : r2(n(inv.net_amount) - cost),
    deliveries: await deliveries.forInvoice(inv.id),
    delivery_status: inv.status === 'CANCELLED' ? null : ((await deliveries.statusForInvoices([inv.id])).get(inv.id) || {}).status || 'PENDING',
    returns: inv.returns.map((r) => ({ ...r, total_packs: n(r.total_qty), status: r.settlement_status, return_type: r.resolution })),
    stock_moves: moves,
  };
}

/* ---------- sales returns ---------- */
async function listReturns(q) {
  const r = await returns.list({ ...q, settlement_status: q.status });
  const ids = r.items.map((x) => x.id);
  const lines = new Map(); const remarks = new Map();
  if (ids.length) {
    const [items] = await pool.query(
      `SELECT ri.id, ri.return_id, ri.qty, ri.amount, ri.reason, ri.item_condition, p.product_name, r.sku_code, r.packing_size_label
         FROM sales_return_items ri JOIN product_master p ON p.id = ri.product_id JOIN product_packing_rates r ON r.id = ri.packing_rate_id
        WHERE ri.return_id IN (?) ORDER BY ri.id`, [ids]);
    items.forEach((x) => {
      if (!lines.has(x.return_id)) lines.set(x.return_id, []);
      lines.get(x.return_id).push({ id: x.id, product_name: x.product_name, packing_size_label: x.packing_size_label, sku_code: x.sku_code,
        quantity: n(x.qty), amount: n(x.amount), reason: x.reason, condition: toAppCondition(x.item_condition) });
    });
    const [rem] = await pool.query('SELECT id, remarks FROM sales_returns WHERE id IN (?)', [ids]);
    rem.forEach((x) => remarks.set(x.id, x.remarks));
  }
  return {
    ...r,
    items: r.items.map((x) => ({
      ...x, total_packs: n(x.total_qty), return_type: x.resolution, status: x.settlement_status,
      items: lines.get(x.id) || [], remarks: remarks.get(x.id) || null,
    })),
  };
}

async function createReturn(body, userId, ip) {
  const r = await returns.create({
    invoice_id: body.sale_id ?? body.invoice_id, return_date: body.return_date, resolution: body.return_type ?? body.resolution,
    settlement_status: body.status ?? body.settlement_status, remarks: body.remarks,
    items: (Array.isArray(body.items) ? body.items : []).map((i) => ({
      invoice_item_id: i && (i.sale_item_id ?? i.invoice_item_id), qty: i && (i.quantity ?? i.qty), reason: i && i.reason, condition: toServiceCondition(i && i.condition),
    })),
  }, userId, ip);
  return { ...r, total_packs: r.total_qty, return_type: r.resolution, status: r.settlement_status };
}

function setReturnStatus(id, body, userId, ip) {
  if (!body || String(body.status).toUpperCase() !== 'COMPLETED') throw new AppError('Only COMPLETED can be set on a return');
  return returns.settle(id, userId, ip);
}

/* ---------- finished goods stock card ---------- */
async function stockCard(id, q) {
  const c = await sales.stockCard(id, q);
  return { ...c, sku: { ...c.sku, stock_packs: n(c.sku.available_qty) }, items: c.items.map((x) => ({ ...x, purpose: x.remarks, issue: n(x.issue), received: n(x.received), balance: n(x.balance) })) };
}

module.exports = { lookups, createSale, listSales, groupHistory, getSale, listReturns, createReturn, setReturnStatus, stockCard };