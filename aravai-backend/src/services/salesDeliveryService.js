// Sales delivery / dispatch.
// Stock is already issued when the sales invoice is saved (FIFO, batch-wise). A delivery records what physically left, how
// (own vehicle / transport / courier / pickup) and when it reached the customer. An invoice line can be delivered in parts.
//   invoice delivery status:  PENDING (nothing sent)  ->  PARTIAL (some packs not sent yet)  ->  IN_TRANSIT (all sent, not all received)  ->  DELIVERED
const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');

const MODES = ['OWN_VEHICLE', 'TRANSPORT', 'COURIER', 'CUSTOMER_PICKUP'];
const PAY_MODES = ['CASH', 'UPI', 'BANK', 'CREDIT'];
const n = (x) => Number(x) || 0;
const r3 = (x) => Math.round(n(x) * 1000) / 1000;

// packs already sent per invoice line (cancelled deliveries do not count)
const SENT_PER_LINE = `(SELECT di.invoice_item_id, SUM(di.qty) AS sent, SUM(IF(d.status = 'DELIVERED', di.qty, 0)) AS received
                          FROM sales_delivery_items di JOIN sales_deliveries d ON d.id = di.delivery_id
                         WHERE d.status <> 'CANCELLED' GROUP BY di.invoice_item_id)`;

function statusOf(total, sent, received) {
  if (sent <= 0) return 'PENDING';
  if (sent < total) return 'PARTIAL';
  return received >= total ? 'DELIVERED' : 'IN_TRANSIT';
}

// Map(invoiceId -> { total, sent, received, status }) for a list of invoices
async function statusForInvoices(ids) {
  const map = new Map();
  if (!ids || !ids.length) return map;
  const [rows] = await pool.query(
    `SELECT ii.invoice_id, SUM(ii.qty) AS total, COALESCE(SUM(s.sent), 0) AS sent, COALESCE(SUM(s.received), 0) AS received
       FROM sales_invoice_items ii LEFT JOIN ${SENT_PER_LINE} s ON s.invoice_item_id = ii.id
      WHERE ii.invoice_id IN (?) GROUP BY ii.invoice_id`, [ids]);
  rows.forEach((r) => map.set(r.invoice_id, { total: n(r.total), sent: n(r.sent), received: n(r.received), status: statusOf(n(r.total), n(r.sent), n(r.received)) }));
  return map;
}

/* ---------- invoices that still have packs to send (feeds the New Delivery form) ---------- */
async function pendingInvoices(q = {}) {
  const w = ["i.status = 'ACTIVE'"]; const a = [];
  const s = v.clean(q.search);
  if (s) { w.push('(i.invoice_no LIKE ? OR c.customer_name LIKE ?)'); a.push(`%${s}%`, `%${s}%`); }
  if (q.invoice_id) { w.push('i.id = ?'); a.push(v.toId(q.invoice_id, 'invoice')); }
  const [lines] = await pool.query(
    `SELECT i.id AS invoice_id, i.invoice_no, i.invoice_date, c.id AS customer_id, c.customer_name, c.mobile, c.address,
            ii.id AS invoice_item_id, ii.packing_rate_id, p.product_name, r.sku_code, r.packing_size_label, r.weight_grams,
            ii.qty, COALESCE(s.sent, 0) AS sent, ii.qty - COALESCE(s.sent, 0) AS remaining
       FROM sales_invoices i JOIN sales_customers c ON c.id = i.customer_id JOIN sales_invoice_items ii ON ii.invoice_id = i.id
       JOIN product_master p ON p.id = ii.product_id JOIN product_packing_rates r ON r.id = ii.packing_rate_id
       LEFT JOIN ${SENT_PER_LINE} s ON s.invoice_item_id = ii.id
      WHERE ${w.join(' AND ')} AND ii.qty - COALESCE(s.sent, 0) > 0
      ORDER BY i.invoice_date DESC, i.id DESC, ii.id LIMIT 1000`, a);
  const out = []; const idx = new Map();
  for (const l of lines) {
    if (!idx.has(l.invoice_id)) {
      const inv = { invoice_id: l.invoice_id, invoice_no: l.invoice_no, invoice_date: l.invoice_date, customer_id: l.customer_id, customer_name: l.customer_name, mobile: l.mobile, address: l.address, remaining_packs: 0, remaining_kg: 0, items: [] };
      idx.set(l.invoice_id, inv); out.push(inv);
    }
    const inv = idx.get(l.invoice_id);
    const kg = r3((n(l.remaining) * n(l.weight_grams)) / 1000);
    inv.items.push({ invoice_item_id: l.invoice_item_id, packing_rate_id: l.packing_rate_id, product_name: l.product_name, sku_code: l.sku_code, packing_size_label: l.packing_size_label,
      qty: n(l.qty), sent: n(l.sent), remaining: n(l.remaining), remaining_kg: kg });
    inv.remaining_packs += n(l.remaining); inv.remaining_kg = r3(inv.remaining_kg + kg);
  }
  return { items: out };
}

/* ---------- new delivery ---------- */
function clean(b) {
  const mode = String(v.clean(b.transport_mode) || 'OWN_VEHICLE').toUpperCase();
  if (!MODES.includes(mode)) throw new AppError(`Transport must be one of ${MODES.join(', ')}`);
  const mobile = v.optStr(b.driver_mobile, 'Driver mobile', 15);
  if (mobile && !v.MOBILE_RE.test(mobile)) throw new AppError('Driver mobile must be 10 digits');
  const vehicle = v.optStr(b.vehicle_no, 'Vehicle no', 20);
  if (vehicle && !/^[A-Za-z0-9][A-Za-z0-9 \-]*$/.test(vehicle)) throw new AppError('Vehicle no can have only letters, numbers, space and -');
  if (mode === 'OWN_VEHICLE' && !vehicle) throw new AppError('Enter the vehicle no');
  return {
    invoice_id: v.toId(b.invoice_id, 'invoice'),
    delivery_date: v.date(b.delivery_date, 'Delivery date'),
    transport_mode: mode, vehicle_no: vehicle ? vehicle.toUpperCase() : null,
    driver_name: v.optStr(b.driver_name, 'Driver name', 100), driver_mobile: mobile,
    lr_no: v.optStr(b.lr_no, 'LR / courier no', 50), delivery_address: v.optStr(b.delivery_address, 'Delivery address', 500),
    remarks: v.optStr(b.remarks, 'Remarks', 255),
    items: Array.isArray(b.items) ? b.items : null, // null = send everything that is left
  };
}

async function create(body, userId, ip) {
  const d = clean(body || {});
  return withTransaction(async (conn) => {
    const [[inv]] = await conn.query(
      `SELECT i.id, i.invoice_no, i.invoice_date, i.status, i.customer_id, c.customer_name, c.address
         FROM sales_invoices i JOIN sales_customers c ON c.id = i.customer_id WHERE i.id = ? FOR UPDATE`, [d.invoice_id]);
    if (!inv) throw new AppError('Invoice not found', 404);
    if (inv.status !== 'ACTIVE') throw new AppError('A cancelled invoice cannot be delivered');
    if (String(d.delivery_date) < String(inv.invoice_date instanceof Date ? inv.invoice_date.toISOString().slice(0, 10) : inv.invoice_date)) {
      throw new AppError('Delivery date cannot be before the invoice date');
    }

    const [lines] = await conn.query(
      `SELECT ii.id, ii.packing_rate_id, ii.qty, COALESCE(s.sent, 0) AS sent
         FROM sales_invoice_items ii LEFT JOIN ${SENT_PER_LINE} s ON s.invoice_item_id = ii.id WHERE ii.invoice_id = ?`, [inv.id]);
    const byId = new Map(lines.map((l) => [l.id, l]));

    let wanted;
    if (d.items === null) wanted = lines.map((l) => ({ id: l.id, qty: n(l.qty) - n(l.sent) })).filter((x) => x.qty > 0);
    else {
      if (!d.items.length) throw new AppError('Select at least one item to deliver');
      const seen = new Set(); wanted = [];
      d.items.forEach((x, k) => {
        if (!x) throw new AppError(`Line ${k + 1} is empty`);
        const id = v.toId(x.invoice_item_id, `line ${k + 1} item`);
        if (seen.has(id)) throw new AppError(`Line ${k + 1}: the same item is listed twice`);
        seen.add(id);
        const qty = h.wholeNum(x.qty ?? x.quantity ?? 0, `Line ${k + 1}: deliver quantity`, { max: 10000000 });
        if (qty > 0) wanted.push({ id, qty });
      });
    }
    if (!wanted.length) throw new AppError('Nothing left to deliver on this invoice');
    for (const x of wanted) {
      const l = byId.get(x.id);
      if (!l) throw new AppError('An item does not belong to this invoice');
      const left = n(l.qty) - n(l.sent);
      if (x.qty > left) throw new AppError(`Only ${left} pack(s) are left to deliver on one of the lines (you entered ${x.qty})`);
    }

    const no = await nextNumber(conn, 'SALES_DELIVERY');
    const totalQty = wanted.reduce((a, x) => a + x.qty, 0);
    const [r] = await conn.query(
      `INSERT INTO sales_deliveries (delivery_no, delivery_date, invoice_id, customer_id, transport_mode, vehicle_no, driver_name, driver_mobile, lr_no,
         delivery_address, total_qty, remarks, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [no, d.delivery_date, inv.id, inv.customer_id, d.transport_mode, d.vehicle_no, d.driver_name, d.driver_mobile, d.lr_no,
        d.delivery_address || inv.address || null, totalQty, d.remarks, userId]);
    for (const x of wanted) {
      await conn.query('INSERT INTO sales_delivery_items (delivery_id, invoice_item_id, packing_rate_id, qty) VALUES (?,?,?,?)',
        [r.insertId, x.id, byId.get(x.id).packing_rate_id, x.qty]);
    }
    const out = { id: r.insertId, delivery_no: no, invoice_id: inv.id, invoice_no: inv.invoice_no, customer_name: inv.customer_name, total_qty: totalQty, status: 'DISPATCHED' };
    await audit({ userId, action: 'CREATE', table: 'sales_deliveries', recordId: r.insertId, newValues: out, ip }, conn);
    return out;
  });
}

/* ---------- mark delivered / cancel ---------- */
async function setStatus(id, body, userId, ip) {
  const did = v.toId(id, 'delivery');
  const to = String((body && body.status) || '').toUpperCase();
  if (!['DELIVERED', 'CANCELLED'].includes(to)) throw new AppError('Status must be DELIVERED or CANCELLED');
  const receivedBy = v.optStr(body.received_by, 'Received by', 100);
  const remarks = v.optStr(body.remarks, 'Remarks', 255);
  const reason = to === 'CANCELLED' ? v.reqStr(body.reason, 'Cancel reason', 255) : null;
  // payment collected at the time of delivery
  let payMode = null; let paid = 0; let payRef = null;
  if (to === 'DELIVERED') {
    payMode = v.optStr(body.payment_mode, 'Payment mode', 20);
    if (payMode) { payMode = payMode.toUpperCase(); if (!PAY_MODES.includes(payMode)) throw new AppError(`Payment mode must be one of ${PAY_MODES.join(', ')}`); }
    paid = payMode === 'CREDIT' ? 0 : v.num(body.amount_collected, 'Amount collected', { decimals: 2 });
    if (paid > 0 && !payMode) throw new AppError('Select how the payment was received');
    payRef = v.optStr(body.payment_ref, 'Payment reference', 60);
  }
  return withTransaction(async (conn) => {
    const [[d]] = await conn.query('SELECT * FROM sales_deliveries WHERE id = ? FOR UPDATE', [did]);
    if (!d) throw new AppError('Delivery not found', 404);
    if (d.status !== 'DISPATCHED') throw new AppError(`This delivery is already ${d.status.toLowerCase()}`);
    if (to === 'DELIVERED') {
      const [[amt]] = await conn.query(
        'SELECT COALESCE(SUM(di.qty * ii.rate), 0) AS amount FROM sales_delivery_items di JOIN sales_invoice_items ii ON ii.id = di.invoice_item_id WHERE di.delivery_id = ?', [did]);
      if (paid > n(amt.amount) + 0.009) throw new AppError(`Amount collected cannot be more than the delivery value (${n(amt.amount).toFixed(2)})`);
      await conn.query(
        `UPDATE sales_deliveries SET status='DELIVERED', delivered_at=NOW(), received_by=?, remarks=COALESCE(?, remarks), payment_mode=?, amount_collected=?, payment_ref=? WHERE id=?`,
        [receivedBy, remarks, payMode, paid, payRef, did]);
    } else {
      await conn.query(`UPDATE sales_deliveries SET status='CANCELLED', cancelled_at=NOW(), cancel_reason=? WHERE id=?`, [reason, did]);
    }
    await audit({ userId, action: 'STATUS_CHANGE', table: 'sales_deliveries', recordId: did, oldValues: { status: d.status }, newValues: { status: to, received_by: receivedBy, reason, payment_mode: payMode, amount_collected: paid }, ip }, conn);
    return { id: did, delivery_no: d.delivery_no, status: to };
  });
}

/* ---------- list + one ---------- */
async function list(q = {}) {
  const { page, limit, offset } = v.paging(q);
  const w = []; const a = [];
  if (['DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(q.status)) { w.push('d.status = ?'); a.push(q.status); }
  if (q.from) { w.push('d.delivery_date >= ?'); a.push(v.date(q.from, 'From date', { allowFuture: true })); }
  if (q.to) { w.push('d.delivery_date <= ?'); a.push(v.date(q.to, 'To date', { allowFuture: true })); }
  if (q.customer_id) { w.push('d.customer_id = ?'); a.push(v.toId(q.customer_id, 'customer')); }
  if (q.invoice_id) { w.push('d.invoice_id = ?'); a.push(v.toId(q.invoice_id, 'invoice')); }
  const s = v.clean(q.search);
  if (s) { w.push('(d.delivery_no LIKE ? OR i.invoice_no LIKE ? OR c.customer_name LIKE ? OR d.vehicle_no LIKE ?)'); a.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const from = `FROM sales_deliveries d JOIN sales_invoices i ON i.id = d.invoice_id JOIN sales_customers c ON c.id = d.customer_id`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${where}`, a);
  const [items] = await pool.query(
    `SELECT d.id, d.delivery_no, d.delivery_date, d.status, d.transport_mode, d.vehicle_no, d.driver_name, d.total_qty, d.delivered_at, d.received_by, d.payment_mode, d.amount_collected,
            i.id AS invoice_id, i.invoice_no, c.customer_name,
            (SELECT COALESCE(SUM(di.qty * r.weight_grams), 0) / 1000 FROM sales_delivery_items di JOIN product_packing_rates r ON r.id = di.packing_rate_id WHERE di.delivery_id = d.id) AS total_kg
       ${from} ${where} ORDER BY d.delivery_date DESC, d.id DESC LIMIT ? OFFSET ?`, [...a, limit, offset]);
  const [[t]] = await pool.query(
    `SELECT COALESCE(SUM(d.status = 'DISPATCHED'), 0) AS in_transit, COALESCE(SUM(d.status = 'DELIVERED'), 0) AS delivered, COALESCE(SUM(d.status = 'CANCELLED'), 0) AS cancelled
       ${from} ${where}`, a);
  const [[p]] = await pool.query(
    `SELECT COUNT(DISTINCT ii.invoice_id) AS invoices FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id
       LEFT JOIN ${SENT_PER_LINE} s ON s.invoice_item_id = ii.id WHERE i.status = 'ACTIVE' AND ii.qty - COALESCE(s.sent, 0) > 0`);
  return {
    items: items.map((x) => ({ ...x, total_qty: n(x.total_qty), total_kg: r3(x.total_kg) })), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1),
    summary: { in_transit: n(t.in_transit), delivered: n(t.delivered), cancelled: n(t.cancelled), pending_invoices: n(p.invoices) },
  };
}

async function get(id) {
  const did = v.toId(id, 'delivery');
  const [rows] = await pool.query(
    `SELECT d.*, i.invoice_no, i.invoice_date, c.customer_name, c.customer_code, c.mobile, u.full_name AS created_by_name
       FROM sales_deliveries d JOIN sales_invoices i ON i.id = d.invoice_id JOIN sales_customers c ON c.id = d.customer_id JOIN users u ON u.id = d.created_by WHERE d.id = ?`, [did]);
  if (!rows.length) throw new AppError('Delivery not found', 404);
  const [items] = await pool.query(
    `SELECT di.id, di.invoice_item_id, di.qty, ii.rate, p.product_name, r.sku_code, r.packing_size_label, r.weight_grams, di.qty * r.weight_grams / 1000 AS kg
       FROM sales_delivery_items di JOIN sales_invoice_items ii ON ii.id = di.invoice_item_id JOIN product_master p ON p.id = ii.product_id
       JOIN product_packing_rates r ON r.id = di.packing_rate_id WHERE di.delivery_id = ? ORDER BY di.id`, [did]);
  return {
    ...rows[0], items: items.map((x) => ({ ...x, qty: n(x.qty), rate: n(x.rate), kg: r3(x.kg) })), total_kg: r3(items.reduce((a, x) => a + n(x.kg), 0)),
    delivery_amount: Math.round(items.reduce((a, x) => a + n(x.qty) * n(x.rate), 0) * 100) / 100, amount_collected: n(rows[0].amount_collected),
  };
}

// deliveries of one invoice (shown inside the invoice detail)
async function forInvoice(invoiceId) {
  const [rows] = await pool.query(
    `SELECT id, delivery_no, delivery_date, status, transport_mode, vehicle_no, driver_name, total_qty, delivered_at, received_by, payment_mode, amount_collected, payment_ref FROM sales_deliveries WHERE invoice_id = ? ORDER BY id`, [invoiceId]);
  return rows.map((x) => ({ ...x, total_qty: n(x.total_qty), amount_collected: n(x.amount_collected) }));
}

// true when an invoice has a delivery that is not cancelled (such an invoice cannot be cancelled)
async function hasActiveDelivery(conn, invoiceId) {
  const [[r]] = await conn.query("SELECT COUNT(*) AS c FROM sales_deliveries WHERE invoice_id = ? AND status <> 'CANCELLED'", [invoiceId]);
  return n(r.c) > 0;
}

module.exports = { statusForInvoices, pendingInvoices, create, setStatus, list, get, forInvoice, hasActiveDelivery };
