// Sales returns: record returned packs against an invoice, put RESALEABLE packs back into finished goods stock (to the batch they
// were sold from), and settle by refund or replacement. DAMAGED packs never go back to stock - their cost stays as a loss in profit.
const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');
const stock = require('../utils/salesStock');

const RESOLUTIONS = ['REFUND', 'REPLACEMENT'];
const STATUSES = ['PENDING', 'COMPLETED'];
const CONDITIONS = ['RESALEABLE', 'DAMAGED'];
const REASONS = ['Damaged / torn pack', 'Expired / near expiry', 'Quality complaint', 'Wrong item supplied', 'Excess stock returned', 'Other'];
const MAX_LINES = 100;

function lookups() { return { resolutions: RESOLUTIONS, settlement_statuses: STATUSES, conditions: CONDITIONS, reasons: REASONS }; }

/* active invoices that still have packs which can be returned (for the "pick an invoice" box) */
async function returnableInvoices(q) {
  const w = ["i.status = 'ACTIVE'"]; const a = [];
  if (q.customer_id) { w.push('i.customer_id = ?'); a.push(v.toId(q.customer_id, 'customer')); }
  const s = v.clean(q.search);
  if (s) { w.push('(i.invoice_no LIKE ? OR c.customer_name LIKE ?)'); a.push(`%${s}%`, `%${s}%`); }
  const [items] = await pool.query(
    `SELECT i.id, i.invoice_no, i.invoice_date, c.customer_name, i.total_amount, SUM(ii.qty - ii.returned_qty) AS returnable_qty
       FROM sales_invoices i JOIN sales_customers c ON c.id = i.customer_id JOIN sales_invoice_items ii ON ii.invoice_id = i.id
      WHERE ${w.join(' AND ')} GROUP BY i.id, c.customer_name HAVING returnable_qty > 0 ORDER BY i.invoice_date DESC, i.id DESC LIMIT 30`, a);
  return { items };
}

function cleanInput(b) {
  const d = {
    return_date: v.date(b.return_date, 'Return date'),
    invoice_id: v.toId(b.invoice_id, 'invoice'),
    resolution: String(v.clean(b.resolution) || '').toUpperCase(),
    settlement_status: String(v.clean(b.settlement_status) || 'PENDING').toUpperCase(),
    remarks: v.optStr(b.remarks, 'Remarks', 255),
  };
  if (!RESOLUTIONS.includes(d.resolution)) throw new AppError('Choose Refund or Replacement');
  if (!STATUSES.includes(d.settlement_status)) throw new AppError('Settlement status must be PENDING or COMPLETED');
  if (!Array.isArray(b.items) || !b.items.length) throw new AppError('Add at least one returned product');
  if (b.items.length > MAX_LINES) throw new AppError(`A return can have at most ${MAX_LINES} lines`);
  d.items = b.items.map((i, n) => {
    if (!i) throw new AppError(`Line ${n + 1} is empty`);
    const qty = h.wholeNum(i.qty, `Line ${n + 1}: returned pack quantity`, { max: 10000000 });
    if (qty <= 0) throw new AppError(`Line ${n + 1}: returned pack quantity must be more than 0`);
    const cond = String(v.clean(i.condition) || 'RESALEABLE').toUpperCase();
    if (!CONDITIONS.includes(cond)) throw new AppError(`Line ${n + 1}: condition must be RESALEABLE or DAMAGED`);
    return { invoice_item_id: v.toId(i.invoice_item_id, `line ${n + 1} invoice line`), qty, condition: cond, reason: v.reqStr(i.reason, `Line ${n + 1}: return reason`, 150) };
  });
  return d;
}

// replacement packs leave stock (oldest batch first)
async function issueReplacements(conn, ret, rows, userId) {
  const sorted = [...rows].sort((a, b) => a.packing_rate_id - b.packing_rate_id || a.id - b.id); // same lock order as invoices
  for (const it of sorted) {
    await stock.issueFifo(conn, {
      packingRateId: it.packing_rate_id, productId: it.product_id, qty: it.qty, date: v.date(null), source: 'REPLACEMENT', invoiceId: ret.invoice_id,
      returnId: ret.id, returnItemId: it.id, ref: ret.return_no, userId, label: `Replacement for ${ret.return_no}`,
    });
  }
}

async function create(body, userId, ip) {
  const d = cleanInput(body);
  return withTransaction(async (conn) => {
    const [[inv]] = await conn.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [d.invoice_id]);
    if (!inv) throw new AppError('Invoice not found', 404);
    if (inv.status !== 'ACTIVE') throw new AppError('This invoice is cancelled, nothing can be returned against it');
    if (d.return_date < inv.invoice_date) throw new AppError('Return date cannot be before the invoice date');

    const ids = [...new Set(d.items.map((i) => i.invoice_item_id))];
    const [lines] = await conn.query('SELECT * FROM sales_invoice_items WHERE invoice_id = ? AND id IN (?) FOR UPDATE', [d.invoice_id, ids]);
    const map = new Map(lines.map((l) => [l.id, l]));
    for (const id of ids) if (!map.has(id)) throw new AppError('A returned line does not belong to this invoice');
    const asked = new Map();
    for (const it of d.items) asked.set(it.invoice_item_id, (asked.get(it.invoice_item_id) || 0) + it.qty);
    for (const [id, qty] of asked) {
      const l = map.get(id);
      const left = l.qty - l.returned_qty;
      if (qty > left) {
        const [[r]] = await conn.query('SELECT sku_code FROM product_packing_rates WHERE id = ?', [l.packing_rate_id]);
        throw new AppError(`${r.sku_code}: only ${left} pack(s) can still be returned (sold ${l.qty}, already returned ${l.returned_qty}), but ${qty} entered`);
      }
    }

    const returnNo = await nextNumber(conn, 'SALES_RETURN');
    const totalQty = d.items.reduce((a, i) => a + i.qty, 0);
    const value = stock.r2(d.items.reduce((a, i) => a + i.qty * Number(map.get(i.invoice_item_id).rate), 0));
    const refund = d.resolution === 'REFUND' ? value : 0;
    const [hd] = await conn.query(
      `INSERT INTO sales_returns (return_no, return_date, invoice_id, customer_id, resolution, settlement_status, settled_at, total_qty, refund_amount, remarks, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [returnNo, d.return_date, inv.id, inv.customer_id, d.resolution, 'PENDING', null, totalQty, refund, d.remarks, userId]);
    const ret = { id: hd.insertId, return_no: returnNo, invoice_id: inv.id };

    const saved = [];
    for (const it of d.items) {
      const l = map.get(it.invoice_item_id);
      const amount = stock.r2(it.qty * Number(l.rate));
      const [ri] = await conn.query(
        `INSERT INTO sales_return_items (return_id, invoice_item_id, product_id, packing_rate_id, qty, rate, amount, item_condition, reason) VALUES (?,?,?,?,?,?,?,?,?)`,
        [hd.insertId, l.id, l.product_id, l.packing_rate_id, it.qty, l.rate, amount, it.condition, it.reason]);
      await conn.query('UPDATE sales_invoice_items SET returned_qty = returned_qty + ?, refunded_amount = refunded_amount + ? WHERE id = ?',
        [it.qty, d.resolution === 'REFUND' ? amount : 0, l.id]);
      // resaleable packs go straight back into finished goods stock
      if (it.condition === 'RESALEABLE') {
        await stock.restoreToStock(conn, { invoiceItemId: l.id, qty: it.qty, date: d.return_date, source: 'RETURN', invoiceId: inv.id, returnId: hd.insertId,
          returnItemId: ri.insertId, ref: returnNo, userId, label: `Sales return ${returnNo} (${inv.invoice_no})` });
      }
      saved.push({ id: ri.insertId, invoice_item_id: l.id, product_id: l.product_id, packing_rate_id: l.packing_rate_id, qty: it.qty, condition: it.condition });
    }

    if (d.settlement_status === 'COMPLETED') await settleInside(conn, { ...ret, resolution: d.resolution }, saved, userId);
    const result = { ...ret, return_date: d.return_date, resolution: d.resolution, settlement_status: d.settlement_status, total_qty: totalQty, refund_amount: refund,
      restocked_qty: d.items.filter((i) => i.condition === 'RESALEABLE').reduce((a, i) => a + i.qty, 0) };
    await audit({ userId, action: 'CREATE', table: 'sales_returns', recordId: hd.insertId, newValues: result, ip }, conn);
    return result;
  });
}

async function settleInside(conn, ret, items, userId) {
  if (ret.resolution === 'REPLACEMENT') await issueReplacements(conn, ret, items.map((i) => ({ ...i, return_no: ret.return_no })), userId);
  await conn.query("UPDATE sales_returns SET settlement_status = 'COMPLETED', settled_at = NOW() WHERE id = ?", [ret.id]);
}

/* mark a pending return as settled: refund paid, or replacement packs dispatched (replacement packs leave stock now) */
async function settle(id, userId, ip) {
  const rid = v.toId(id, 'return');
  return withTransaction(async (conn) => {
    const [[ret]] = await conn.query('SELECT * FROM sales_returns WHERE id = ? FOR UPDATE', [rid]);
    if (!ret) throw new AppError('Sales return not found', 404);
    if (ret.settlement_status === 'COMPLETED') throw new AppError('This return is already settled');
    const [items] = await conn.query('SELECT id, product_id, packing_rate_id, qty FROM sales_return_items WHERE return_id = ?', [rid]);
    await settleInside(conn, ret, items, userId);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'sales_returns', recordId: rid, oldValues: { settlement_status: 'PENDING' }, newValues: { settlement_status: 'COMPLETED' }, ip }, conn);
    return { id: rid, return_no: ret.return_no, resolution: ret.resolution, settlement_status: 'COMPLETED' };
  });
}

async function get(id) {
  const rid = v.toId(id, 'return');
  const [rows] = await pool.query(
    `SELECT sr.*, i.invoice_no, i.invoice_date, c.customer_code, c.customer_name, u.full_name AS created_by_name
       FROM sales_returns sr JOIN sales_invoices i ON i.id = sr.invoice_id JOIN sales_customers c ON c.id = sr.customer_id JOIN users u ON u.id = sr.created_by WHERE sr.id = ?`, [rid]);
  if (!rows.length) throw new AppError('Sales return not found', 404);
  const [items] = await pool.query(
    `SELECT ri.*, p.product_name, r.sku_code, r.packing_size_label FROM sales_return_items ri JOIN product_master p ON p.id = ri.product_id
       JOIN product_packing_rates r ON r.id = ri.packing_rate_id WHERE ri.return_id = ? ORDER BY ri.id`, [rid]);
  const [moves] = await pool.query(
    `SELECT l.return_item_id, l.source_type, b.batch_no, l.qty FROM sales_stock_ledger l JOIN batch_master b ON b.id = l.batch_id
      WHERE l.return_id = ? ORDER BY l.id`, [rid]);
  items.forEach((it) => { it.stock_movements = moves.filter((m) => m.return_item_id === it.id).map((m) => ({ type: m.source_type, batch_no: m.batch_no, qty: m.qty })); });
  return { ...rows[0], items };
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const w = []; const a = [];
  if (q.from) { w.push('sr.return_date >= ?'); a.push(v.date(q.from, 'From date', { allowFuture: true })); }
  if (q.to) { w.push('sr.return_date <= ?'); a.push(v.date(q.to, 'To date', { allowFuture: true })); }
  if (q.customer_id) { w.push('sr.customer_id = ?'); a.push(v.toId(q.customer_id, 'customer')); }
  if (RESOLUTIONS.includes(q.resolution)) { w.push('sr.resolution = ?'); a.push(q.resolution); }
  if (STATUSES.includes(q.settlement_status)) { w.push('sr.settlement_status = ?'); a.push(q.settlement_status); }
  const s = v.clean(q.search);
  if (s) { w.push('(sr.return_no LIKE ? OR i.invoice_no LIKE ? OR c.customer_name LIKE ?)'); a.push(`%${s}%`, `%${s}%`, `%${s}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const from = `FROM sales_returns sr JOIN sales_invoices i ON i.id = sr.invoice_id JOIN sales_customers c ON c.id = sr.customer_id ${where}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, a);
  const [items] = await pool.query(
    `SELECT sr.id, sr.return_no, sr.return_date, i.invoice_no, c.customer_name, sr.resolution, sr.settlement_status, sr.total_qty, sr.refund_amount,
            (SELECT GROUP_CONCAT(DISTINCT CONCAT(r.sku_code) SEPARATOR ', ') FROM sales_return_items ri JOIN product_packing_rates r ON r.id = ri.packing_rate_id WHERE ri.return_id = sr.id) AS skus,
            (SELECT GROUP_CONCAT(DISTINCT ri.reason SEPARATOR '; ') FROM sales_return_items ri WHERE ri.return_id = sr.id) AS reasons
       ${from} ORDER BY sr.return_date DESC, sr.id DESC LIMIT ? OFFSET ?`, [...a, limit, offset]);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

module.exports = { lookups, returnableInvoices, create, settle, get, list };
