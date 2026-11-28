// Sales: lookups, customers / agencies, invoices (create, view, cancel), sales history, finished-goods stock card.
const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');
const stock = require('../utils/salesStock');

const MAX_LINES = 100;
const PAY_MODES = ['CASH', 'UPI', 'BANK', 'CREDIT'];
const CUSTOMER_TYPES = ['CUSTOMER', 'AGENCY', 'WHOLESALE', 'DISTRIBUTOR', 'RETAIL'];

/* ---------- dropdown data for the entry forms ---------- */
async function lookups() {
  const [customers] = await pool.query(
    `SELECT id, customer_code, customer_name, customer_type, contact_person, mobile, gst_number, address, city FROM sales_customers WHERE is_active = 1 ORDER BY customer_name`);
  const [skus] = await pool.query(
    `SELECT r.id AS packing_rate_id, r.product_id, p.product_code, p.product_name, r.sku_code, r.packing_size_label, r.weight_grams, r.mrp,
            COALESCE((SELECT SUM(fg.available_qty) FROM finished_goods_stock fg WHERE fg.packing_rate_id = r.id), 0) AS available_qty
       FROM product_packing_rates r JOIN product_master p ON p.id = r.product_id
      WHERE r.is_active = 1 AND p.is_active = 1 ORDER BY p.product_name, r.weight_grams`);
  for (const s of skus) {
    s.cost_per_pack = null;
    if (Number(s.available_qty) > 0) {
      const [[fg]] = await pool.query(
        `SELECT fg.batch_id FROM finished_goods_stock fg JOIN batch_master b ON b.id = fg.batch_id
          WHERE fg.packing_rate_id = ? AND fg.available_qty > 0 ORDER BY b.production_date, fg.batch_id LIMIT 1`, [s.packing_rate_id]);
      if (fg) { const c = await stock.unitCost(pool, fg.batch_id, s.packing_rate_id); s.cost_per_pack = stock.r2(c.material + c.packing); }
    }
  }
  const products = [];
  const byId = new Map();
  for (const s of skus) {
    if (!byId.has(s.product_id)) {
      const p = { id: s.product_id, product_code: s.product_code, product_name: s.product_name, skus: [] };
      byId.set(s.product_id, p); products.push(p);
    }
    byId.get(s.product_id).skus.push(s);
  }
  return { customers, products, payment_modes: PAY_MODES };
}

/* ---------- next invoice no (preview only: does not use up the number) ---------- */
async function peekInvoiceNo() {
  const [rows] = await pool.query("SELECT * FROM document_sequences WHERE series_code = 'SALES_INVOICE'");
  if (!rows.length) return { invoice_no: '' };
  const s = rows[0];
  const year = new Date().getFullYear();
  let next = s.last_number + 1;
  if (s.year_scope !== null && s.year_scope !== year) next = 1;
  const num = String(next).padStart(s.pad_length, '0');
  return { invoice_no: s.year_scope !== null ? `${s.prefix}${year}-${num}` : `${s.prefix}${num}` };
}

/* ---------- customers / agencies ---------- */
function cleanCustomer(b) {
  const type = v.clean(b.customer_type) || 'CUSTOMER';
  if (!CUSTOMER_TYPES.includes(type)) throw new AppError(`Type must be one of ${CUSTOMER_TYPES.join(', ')}`);
  const mobile = v.optStr(b.mobile, 'Mobile', 15);
  if (mobile && !v.MOBILE_RE.test(mobile)) throw new AppError('Mobile must be 10 digits');
  const email = v.optStr(b.email, 'Email', 100);
  if (email && !v.EMAIL_RE.test(email)) throw new AppError('Email is not valid');
  const gst = v.optStr(b.gst_number, 'GST number', 15);
  if (gst && !v.GST_RE.test(gst.toUpperCase())) throw new AppError('GST number is not valid');
  return {
    customer_name: v.reqStr(b.customer_name, 'Customer / agency name', 150), customer_type: type,
    contact_person: v.optStr(b.contact_person, 'Contact person', 100), mobile, email,
    gst_number: gst ? gst.toUpperCase() : null, address: v.optStr(b.address, 'Address', 500), city: v.optStr(b.city, 'City', 80),
  };
}

async function listCustomers(q) {
  const { page, limit, offset } = v.paging(q);
  const w = []; const a = [];
  const s = v.clean(q.search);
  if (s) { w.push('(c.customer_name LIKE ? OR c.customer_code LIKE ? OR c.mobile LIKE ? OR c.city LIKE ?)'); a.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`); }
  if (CUSTOMER_TYPES.includes(q.type)) { w.push('c.customer_type = ?'); a.push(q.type); }
  if (q.active === '0' || q.active === '1') { w.push('c.is_active = ?'); a.push(Number(q.active)); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sales_customers c ${where}`, a);
  const [items] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM sales_invoices i WHERE i.customer_id = c.id AND i.status = 'ACTIVE') AS invoice_count,
            (SELECT COALESCE(SUM(i.total_amount), 0) FROM sales_invoices i WHERE i.customer_id = c.id AND i.status = 'ACTIVE') AS total_sales
       FROM sales_customers c ${where} ORDER BY c.customer_name LIMIT ? OFFSET ?`, [...a, limit, offset]);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

async function createCustomer(body, userId, ip) {
  const d = cleanCustomer(body);
  return withTransaction(async (conn) => {
    const code = await nextNumber(conn, 'SALES_CUSTOMER');
    const [r] = await conn.query(
      `INSERT INTO sales_customers (customer_code, customer_name, customer_type, contact_person, mobile, email, gst_number, address, city, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [code, d.customer_name, d.customer_type, d.contact_person, d.mobile, d.email, d.gst_number, d.address, d.city, userId]);
    const out = { id: r.insertId, customer_code: code, ...d };
    await audit({ userId, action: 'CREATE', table: 'sales_customers', recordId: r.insertId, newValues: out, ip }, conn);
    return out;
  });
}

async function updateCustomer(id, body, userId, ip) {
  const cid = v.toId(id, 'customer');
  const d = cleanCustomer(body);
  const active = body.is_active === undefined ? undefined : v.toBool(body.is_active, 'is_active');
  return withTransaction(async (conn) => {
    const [[old]] = await conn.query('SELECT * FROM sales_customers WHERE id = ? FOR UPDATE', [cid]);
    if (!old) throw new AppError('Customer not found', 404);
    await conn.query(
      `UPDATE sales_customers SET customer_name=?, customer_type=?, contact_person=?, mobile=?, email=?, gst_number=?, address=?, city=?, is_active=? WHERE id=?`,
      [d.customer_name, d.customer_type, d.contact_person, d.mobile, d.email, d.gst_number, d.address, d.city, active === undefined ? old.is_active : (active ? 1 : 0), cid]);
    await audit({ userId, action: 'UPDATE', table: 'sales_customers', recordId: cid, oldValues: old, newValues: { ...d, is_active: active }, ip }, conn);
    return { id: cid, ...d, is_active: active === undefined ? !!old.is_active : active };
  });
}

/* ---------- new sales entry ---------- */
function cleanInvoice(b) {
  const d = {
    invoice_no: v.optStr(b.invoice_no, 'Invoice no', 30),   // typed by the user; blank = auto number
    invoice_date: v.date(b.invoice_date, 'Invoice date'),
    customer_id: v.toId(b.customer_id, 'customer / agency'),
    payment_mode: v.optStr(b.payment_mode, 'Payment mode', 20),
    remarks: v.optStr(b.remarks, 'Remarks', 255),
  };
  if (d.invoice_no && !/^[A-Za-z0-9][A-Za-z0-9\/\-_.]*$/.test(d.invoice_no)) throw new AppError('Invoice no can have only letters, numbers and - / _ .');
  if (d.payment_mode) {
    d.payment_mode = d.payment_mode.toUpperCase();
    if (!PAY_MODES.includes(d.payment_mode)) throw new AppError(`Payment mode must be one of ${PAY_MODES.join(', ')}`);
  }
  if (!Array.isArray(b.items) || !b.items.length) throw new AppError('Add at least one product to the invoice');
  if (b.items.length > MAX_LINES) throw new AppError(`An invoice can have at most ${MAX_LINES} lines`);
  d.items = b.items.map((i, n) => {
    if (!i) throw new AppError(`Line ${n + 1} is empty`);
    const qty = h.wholeNum(i.qty, `Line ${n + 1}: pack quantity`, { max: 10000000 });
    if (qty <= 0) throw new AppError(`Line ${n + 1}: pack quantity must be more than 0`);
    return {
      packing_rate_id: v.toId(i.packing_rate_id, `line ${n + 1} SKU`),
      qty, rate: v.positive(i.rate, `Line ${n + 1}: selling rate`, { max: 10000000, decimals: 2 }),
    };
  });
  return d;
}

async function createInvoice(body, userId, ip) {
  const d = cleanInvoice(body);
  return withTransaction(async (conn) => {
    const [[cust]] = await conn.query('SELECT id, customer_name, is_active FROM sales_customers WHERE id = ?', [d.customer_id]);
    if (!cust) throw new AppError('Customer / agency not found', 404);
    if (!cust.is_active) throw new AppError('This customer / agency is inactive');

    const rateIds = [...new Set(d.items.map((i) => i.packing_rate_id))];
    const [rates] = await conn.query('SELECT * FROM product_packing_rates WHERE id IN (?) AND is_active = 1', [rateIds]);
    const rateMap = new Map(rates.map((r) => [r.id, r]));
    for (const id of rateIds) if (!rateMap.has(id)) throw new AppError('A selected SKU / pack size does not exist or is inactive');

    let invoiceNo = d.invoice_no;
    if (invoiceNo) {
      const [[dup]] = await conn.query('SELECT id FROM sales_invoices WHERE invoice_no = ?', [invoiceNo]);
      if (dup) throw new AppError(`Invoice no ${invoiceNo} already exists`);
    } else invoiceNo = await nextNumber(conn, 'SALES_INVOICE');
    const totalQty = d.items.reduce((a, i) => a + i.qty, 0);
    const total = stock.r2(d.items.reduce((a, i) => a + stock.r2(i.qty * i.rate), 0));
    const [inv] = await conn.query(
      `INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, total_qty, total_amount, payment_mode, remarks, created_by)
       VALUES (?,?,?,?,?,?,?,?)`, [invoiceNo, d.invoice_date, d.customer_id, totalQty, total, d.payment_mode, d.remarks, userId]);

    // lock stock in a fixed SKU order (no deadlocks between two people billing at once); lines of the same SKU are checked one after another
    const order = d.items.map((it, idx) => ({ ...it, idx })).sort((a, b) => a.packing_rate_id - b.packing_rate_id || a.idx - b.idx);
    const warnings = []; const lines = new Array(d.items.length);
    for (const it of order) {
      const r = rateMap.get(it.packing_rate_id);
      const amount = stock.r2(it.qty * it.rate);
      const [li] = await conn.query(
        `INSERT INTO sales_invoice_items (invoice_id, product_id, packing_rate_id, qty, rate, amount, mrp_snapshot) VALUES (?,?,?,?,?,?,?)`,
        [inv.insertId, r.product_id, r.id, it.qty, it.rate, amount, r.mrp]);
      const out = await stock.issueFifo(conn, {
        packingRateId: r.id, productId: r.product_id, qty: it.qty, date: d.invoice_date, source: 'SALE', invoiceId: inv.insertId,
        invoiceItemId: li.insertId, ref: invoiceNo, userId, label: `Sale ${invoiceNo}`,
      });
      await conn.query('UPDATE sales_invoice_items SET cost_amount = ? WHERE id = ?', [out.cost, li.insertId]);
      if (it.rate * it.qty < out.cost) warnings.push(`${r.sku_code}: selling below cost (sale ${amount}, cost ${out.cost})`);
      lines[it.idx] = { id: li.insertId, sku_code: r.sku_code, qty: it.qty, rate: it.rate, amount, batches: out.allocations.map((a) => ({ batch_no: a.batch_no, qty: a.qty })) };
    }
    const result = { id: inv.insertId, invoice_no: invoiceNo, invoice_date: d.invoice_date, customer: cust.customer_name, total_qty: totalQty, total_amount: total, items: lines, warnings };
    await audit({ userId, action: 'CREATE', table: 'sales_invoices', recordId: inv.insertId, newValues: result, ip }, conn);
    return result;
  });
}

/* ---------- one invoice ---------- */
async function getInvoice(id) {
  const iid = v.toId(id, 'invoice');
  const [rows] = await pool.query(
    `SELECT i.*, c.customer_code, c.customer_name, c.customer_type, c.mobile, c.gst_number, c.address, u.full_name AS created_by_name
       FROM sales_invoices i JOIN sales_customers c ON c.id = i.customer_id JOIN users u ON u.id = i.created_by WHERE i.id = ?`, [iid]);
  if (!rows.length) throw new AppError('Invoice not found', 404);
  const inv = rows[0];
  const [items] = await pool.query(
    `SELECT ii.id, ii.product_id, p.product_name, ii.packing_rate_id, r.sku_code, r.packing_size_label, ii.qty, ii.rate, ii.amount, ii.mrp_snapshot,
            ii.returned_qty, ii.qty - ii.returned_qty AS returnable_qty, ii.refunded_amount, ii.cost_amount
       FROM sales_invoice_items ii JOIN product_master p ON p.id = ii.product_id JOIN product_packing_rates r ON r.id = ii.packing_rate_id
      WHERE ii.invoice_id = ? ORDER BY ii.id`, [iid]);
  const [batches] = await pool.query(
    `SELECT l.invoice_item_id, b.batch_no, SUM(CASE WHEN l.direction='OUT' THEN l.qty ELSE -CAST(l.qty AS SIGNED) END) AS qty
       FROM sales_stock_ledger l JOIN batch_master b ON b.id = l.batch_id
      WHERE l.invoice_id = ? AND l.source_type = 'SALE' GROUP BY l.invoice_item_id, b.batch_no`, [iid]);
  items.forEach((it) => { it.batches = batches.filter((b) => b.invoice_item_id === it.id).map((b) => ({ batch_no: b.batch_no, qty: Number(b.qty) })); });
  const [returns] = await pool.query(
    `SELECT id, return_no, return_date, resolution, settlement_status, total_qty, refund_amount FROM sales_returns WHERE invoice_id = ? ORDER BY id`, [iid]);
  const refunded = items.reduce((a, i) => a + Number(i.refunded_amount), 0);
  const [[pay]] = await pool.query(
    "SELECT COALESCE(SUM(amount_collected), 0) AS collected FROM sales_deliveries WHERE invoice_id = ? AND status = 'DELIVERED'", [iid]);
  const net = stock.r2(Number(inv.total_amount) - refunded);
  const collected = stock.r2(Number(pay.collected));
  return { ...inv, items, returns, refunded_amount: stock.r2(refunded), net_amount: net, collected_amount: collected, balance_amount: Math.max(stock.r2(net - collected), 0) };
}

/* ---------- cancel an invoice (puts every pack back, only when nothing was returned against it) ---------- */
async function cancelInvoice(id, body, userId, ip) {
  const iid = v.toId(id, 'invoice');
  const reason = v.reqStr(body && body.reason, 'Cancel reason', 255);
  return withTransaction(async (conn) => {
    const [[inv]] = await conn.query('SELECT * FROM sales_invoices WHERE id = ? FOR UPDATE', [iid]);
    if (!inv) throw new AppError('Invoice not found', 404);
    if (inv.status === 'CANCELLED') throw new AppError('This invoice is already cancelled');
    const [items] = await conn.query('SELECT * FROM sales_invoice_items WHERE invoice_id = ?', [iid]);
    if (items.some((i) => i.returned_qty > 0)) throw new AppError('This invoice has sales returns against it, so it cannot be cancelled');
    if (await require('./salesDeliveryService').hasActiveDelivery(conn, iid)) throw new AppError('This invoice has a delivery against it. Cancel the delivery first, then cancel the invoice');
    const today = v.date(null);
    for (const it of items) {
      await stock.restoreToStock(conn, { invoiceItemId: it.id, qty: it.qty, date: today, source: 'CANCEL', invoiceId: iid, ref: inv.invoice_no, userId, label: `Cancelled ${inv.invoice_no}` });
    }
    await conn.query(`UPDATE sales_invoices SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=?, cancel_reason=? WHERE id=?`, [userId, reason, iid]);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'sales_invoices', recordId: iid, oldValues: { status: 'ACTIVE' }, newValues: { status: 'CANCELLED', reason }, ip }, conn);
    return { id: iid, invoice_no: inv.invoice_no, status: 'CANCELLED' };
  });
}

/* ---------- sales history ----------
   group = invoice (default) | item | date | customer | sku       filters: from, to, customer_id, product_id, packing_rate_id, search, status */
const GROUPS = ['invoice', 'item', 'date', 'customer', 'sku'];
async function history(q) {
  const group = q.group || 'invoice';
  if (!GROUPS.includes(group)) throw new AppError(`group must be one of ${GROUPS.join(', ')}`);
  const { page, limit, offset } = v.paging(q);
  const w = []; const a = [];
  if (q.from) { w.push('i.invoice_date >= ?'); a.push(v.date(q.from, 'From date', { allowFuture: true })); }
  if (q.to) { w.push('i.invoice_date <= ?'); a.push(v.date(q.to, 'To date', { allowFuture: true })); }
  if (q.customer_id) { w.push('i.customer_id = ?'); a.push(v.toId(q.customer_id, 'customer')); }
  if (q.product_id) { w.push('ii.product_id = ?'); a.push(v.toId(q.product_id, 'product')); }
  if (q.packing_rate_id) { w.push('ii.packing_rate_id = ?'); a.push(v.toId(q.packing_rate_id, 'SKU')); }
  const s = v.clean(q.search);
  if (s) { w.push('(i.invoice_no LIKE ? OR c.customer_name LIKE ? OR p.product_name LIKE ? OR r.sku_code LIKE ?)'); a.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`); }
  const baseW = [...w]; const baseA = [...a]; // filters only; the totals card always adds "ACTIVE invoices only" itself
  // group totals never count cancelled invoices; the invoice / item lists show them (flagged) unless status=ACTIVE
  if (q.status === 'ACTIVE' || q.status === 'CANCELLED') { w.push('i.status = ?'); a.push(q.status); }
  else if (['date', 'customer', 'sku'].includes(group)) w.push("i.status = 'ACTIVE'");
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const joins = `FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id JOIN sales_customers c ON c.id = i.customer_id
                JOIN product_master p ON p.id = ii.product_id JOIN product_packing_rates r ON r.id = ii.packing_rate_id`;
  const from = `${joins} ${where}`;
  const totals = () => historyTotals(`${joins} WHERE ${[...baseW, "i.status = 'ACTIVE'"].join(' AND ')}`, baseA);
  const sums = `SUM(ii.qty) AS packs_sold, SUM(ii.amount) AS gross_sales, SUM(ii.returned_qty) AS packs_returned,
                SUM(ii.refunded_amount) AS returns_value, SUM(ii.amount - ii.refunded_amount) AS net_sales, SUM(ii.cost_amount) AS sold_cost`;

  let key; let cols; let order;
  if (group === 'item') {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, a);
    const [items] = await pool.query(
      `SELECT ii.id, i.id AS invoice_id, i.invoice_no, i.invoice_date, i.status, c.customer_name, c.customer_type, p.product_name, r.sku_code, r.packing_size_label,
              ii.qty, ii.rate, ii.amount, ii.returned_qty, ii.refunded_amount ${from} ORDER BY i.invoice_date DESC, i.id DESC, ii.id LIMIT ? OFFSET ?`, [...a, limit, offset]);
    return { group, items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1), totals: await totals() };
  }
  if (group === 'invoice') {
    const [[{ total }]] = await pool.query(`SELECT COUNT(DISTINCT i.id) AS total ${from}`, a);
    const [items] = await pool.query(
      `SELECT i.id, i.invoice_no, i.invoice_date, i.status, i.payment_mode, c.customer_name, c.customer_type, COUNT(*) AS line_count, SUM(ii.qty) AS packs_sold,
              i.total_amount AS gross_sales, SUM(ii.refunded_amount) AS returns_value, i.total_amount - SUM(ii.refunded_amount) AS net_sales
         ${from} GROUP BY i.id, i.invoice_no, i.invoice_date, i.status, i.payment_mode, i.total_amount, c.customer_name, c.customer_type ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`, [...a, limit, offset]);
    return { group, items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1), totals: await totals() };
  }
  if (group === 'date') { key = 'i.invoice_date'; cols = 'i.invoice_date AS label, COUNT(DISTINCT i.id) AS invoices'; order = 'i.invoice_date DESC'; }
  if (group === 'customer') { key = 'c.id, c.customer_name, c.customer_type'; cols = 'c.id AS customer_id, c.customer_name AS label, c.customer_type, COUNT(DISTINCT i.id) AS invoices'; order = 'gross_sales DESC'; }
  if (group === 'sku') { key = 'r.id, r.sku_code, p.product_name, r.packing_size_label'; cols = "r.id AS packing_rate_id, r.sku_code, p.product_name, r.packing_size_label, CONCAT(p.product_name, ' - ', r.packing_size_label) AS label, COUNT(DISTINCT i.id) AS invoices"; order = 'gross_sales DESC'; }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (SELECT 1 ${from} GROUP BY ${key}) x`, a);
  const [items] = await pool.query(`SELECT ${cols}, ${sums} ${from} GROUP BY ${key} ORDER BY ${order} LIMIT ? OFFSET ?`, [...a, limit, offset]);
  return { group, items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1), totals: await totals() };
}

async function historyTotals(fromWhere, args) {
  const [[t]] = await pool.query(
    `SELECT COUNT(DISTINCT i.id) AS invoices, COALESCE(SUM(ii.qty),0) AS packs_sold, COALESCE(SUM(ii.amount),0) AS gross_sales,
            COALESCE(SUM(ii.refunded_amount),0) AS returns_value, COALESCE(SUM(ii.amount - ii.refunded_amount),0) AS net_sales ${fromWhere}`, args);
  return t;
}

/* ---------- finished-goods stock card of one SKU (the Material Card idea, for packs) ---------- */
async function stockCard(rateIdRaw, q) {
  const id = v.toId(rateIdRaw, 'SKU');
  const [[sku]] = await pool.query(
    `SELECT r.id AS packing_rate_id, r.sku_code, r.packing_size_label, p.product_name,
            COALESCE((SELECT SUM(available_qty) FROM finished_goods_stock WHERE packing_rate_id = r.id), 0) AS available_qty
       FROM product_packing_rates r JOIN product_master p ON p.id = r.product_id WHERE r.id = ?`, [id]);
  if (!sku) throw new AppError('SKU not found', 404);
  const { page, limit, offset } = v.paging(q);
  const w = []; const a = []; // date filters apply AFTER the running balance is worked out, so the balance column stays true
  if (q.from) { w.push('x.txn_date >= ?'); a.push(v.date(q.from, 'From date', { allowFuture: true })); }
  if (q.to) { w.push('x.txn_date <= ?'); a.push(v.date(q.to, 'To date', { allowFuture: true })); }
  const inner = `
    SELECT t.id, ROW_NUMBER() OVER (ORDER BY t.txn_date, t.id) AS s_no, t.txn_date, t.txn_type,
           CASE WHEN t.txn_type = 'INWARD' THEN t.quantity WHEN t.txn_type = 'ADJUSTMENT' AND t.quantity > 0 THEN t.quantity ELSE 0 END AS received,
           CASE WHEN t.txn_type = 'OUTWARD' THEN t.quantity WHEN t.txn_type = 'ADJUSTMENT' AND t.quantity < 0 THEN -t.quantity ELSE 0 END AS issue,
           SUM(CASE WHEN t.txn_type = 'OUTWARD' THEN -t.quantity ELSE t.quantity END) OVER (ORDER BY t.txn_date, t.id) AS balance,
           t.reference_no, b.batch_no, t.remarks, u.full_name AS sign
      FROM finished_goods_transactions t JOIN finished_goods_stock fg ON fg.id = t.fg_stock_id JOIN batch_master b ON b.id = fg.batch_id
      JOIN users u ON u.id = t.entered_by
     WHERE fg.packing_rate_id = ?`;
  const filt = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${inner}) x ${filt}`, [id, ...a]);
  const [items] = await pool.query(`SELECT x.* FROM (${inner}) x ${filt} ORDER BY x.s_no ${dir} LIMIT ? OFFSET ?`, [id, ...a, limit, offset]);
  return { sku, items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

module.exports = { peekInvoiceNo, lookups, listCustomers, createCustomer, updateCustomer, createInvoice, getInvoice, cancelInvoice, history, stockCard };