const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const ISSUE_TYPES = ['PRODUCTION', 'SAMPLE', 'WASTAGE', 'RETURN_TO_VENDOR', 'OTHER'];

/**
 * The ONLY place that changes raw-material stock.
 * Must be called inside a transaction (conn). Locks the material row, checks the balance,
 * updates materials.current_stock and writes the ledger row (= one line of the Material Card).
 * direction 'IN' adds to stock, 'OUT' removes from it.
 */
async function postTxn(conn, t) {
  const [rows] = await conn.query(
    'SELECT id, material_code, material_name, unit, current_stock, minimum_stock, is_active FROM materials WHERE id = ? FOR UPDATE',
    [t.material_id]);
  if (!rows.length) throw new AppError('Material not found', 404);
  const m = rows[0];
  if (!m.is_active) throw new AppError(`${m.material_name} is inactive`);

  const opening = Number(m.current_stock);
  const qty = Number(t.qty);
  const isIn = t.direction === 'IN';
  const closing = Math.round((isIn ? opening + qty : opening - qty) * 1000) / 1000;
  if (closing < 0) {
    throw new AppError(`Insufficient stock for ${m.material_name}. Available: ${opening} ${m.unit}, required: ${qty} ${m.unit}`);
  }

  await conn.query('UPDATE materials SET current_stock = ? WHERE id = ?', [closing, m.id]);
  const [r] = await conn.query(
    `INSERT INTO material_stock_transactions
       (material_id, txn_date, txn_type, opening_stock, inward_qty, total_qty, despatch_qty, issue_type, closing_stock,
        agency_supplier, vendor_id, purpose, reference_type, reference_no, po_id, batch_id, entered_by, remarks)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [m.id, t.txn_date, t.txn_type, opening, isIn ? qty : 0, isIn ? closing : opening, isIn ? 0 : qty, t.issue_type || null, closing,
      t.agency_supplier || null, t.vendor_id || null, t.purpose || null, t.reference_type || 'MANUAL', t.reference_no || null,
      t.po_id || null, t.batch_id || null, t.entered_by, t.remarks || null]);

  const low = closing <= Number(m.minimum_stock);
  return {
    txn_id: r.insertId,
    material_id: m.id, material_code: m.material_code, material_name: m.material_name, unit: m.unit,
    opening_stock: opening, closing_stock: closing, minimum_stock: Number(m.minimum_stock),
    is_low_stock: low,
    low_stock_alert: low ? `Low stock: ${m.material_name} is ${closing} ${m.unit} (minimum ${m.minimum_stock} ${m.unit})` : null,
  };
}

/* ---------- A.1  Material receipt (Store Incharge) ---------- */
async function receipt(body, userId, ip) {
  const materialId = v.toId(body.material_id, 'material');
  const vendorId = v.toId(body.vendor_id, 'vendor');
  const refNo = v.reqStr(body.reference_no, 'Invoice / challan number', 50);
  const qty = v.positive(body.quantity, 'Quantity');
  const date = v.date(body.txn_date, 'Receipt date');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);

  return withTransaction(async (conn) => {
    const [ven] = await conn.query('SELECT id, vendor_name, status FROM vendors WHERE id = ?', [vendorId]);
    if (!ven.length) throw new AppError('Vendor not found', 404);
    if (ven[0].status !== 'ACTIVE') throw new AppError(`Vendor ${ven[0].vendor_name} is ${ven[0].status.toLowerCase()}`);

    // double-entry guard: same vendor + invoice/challan + material already received
    const [dup] = await conn.query(
      `SELECT id FROM material_stock_transactions
       WHERE txn_type = 'INWARD' AND vendor_id = ? AND reference_no = ? AND material_id = ? LIMIT 1`, [vendorId, refNo, materialId]);
    if (dup.length) throw new AppError('This invoice/challan is already entered for this material and vendor', 409);

    const res = await postTxn(conn, {
      material_id: materialId, direction: 'IN', txn_type: 'INWARD', qty, txn_date: date,
      vendor_id: vendorId, agency_supplier: ven[0].vendor_name, purpose: `Received from ${ven[0].vendor_name}`,
      reference_type: 'MANUAL', reference_no: refNo, entered_by: userId, remarks,
    });
    await audit({ userId, action: 'CREATE', table: 'material_stock_transactions', recordId: res.txn_id,
      newValues: { type: 'INWARD', material_id: materialId, vendor_id: vendorId, reference_no: refNo, qty, date }, ip }, conn);
    return res;
  });
}

/* ---------- A.3  Store issue ---------- */
async function issue(body, userId, ip) {
  const materialId = v.toId(body.material_id, 'material');
  const qty = v.positive(body.quantity, 'Quantity');
  const date = v.date(body.txn_date, 'Issue date');
  const purpose = v.reqStr(body.purpose, 'Purpose', 255);
  const issueType = String(body.issue_type || 'OTHER').toUpperCase();
  if (!ISSUE_TYPES.includes(issueType)) throw new AppError(`Issue type must be one of ${ISSUE_TYPES.join(', ')}`);

  return withTransaction(async (conn) => {
    const res = await postTxn(conn, {
      material_id: materialId, direction: 'OUT', txn_type: 'ISSUE', qty, txn_date: date,
      issue_type: issueType, purpose, reference_type: 'MANUAL', reference_no: v.optStr(body.reference_no, 'Reference no', 50),
      entered_by: userId, remarks: v.optStr(body.remarks, 'Remarks', 255),
    });
    await audit({ userId, action: 'CREATE', table: 'material_stock_transactions', recordId: res.txn_id,
      newValues: { type: 'ISSUE', material_id: materialId, qty, issueType, purpose }, ip }, conn);
    return res;
  });
}

/* ---------- A.3  Stock correction ---------- */
async function adjustment(body, userId, ip) {
  const materialId = v.toId(body.material_id, 'material');
  const qty = v.positive(body.quantity, 'Quantity');
  const date = v.date(body.txn_date, 'Date');
  const reason = v.reqStr(body.reason, 'Reason', 255);
  const dir = String(body.direction || '').toUpperCase();
  if (!['IN', 'OUT'].includes(dir)) throw new AppError('Direction must be IN or OUT');

  return withTransaction(async (conn) => {
    const res = await postTxn(conn, {
      material_id: materialId, direction: dir, txn_type: dir === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', qty, txn_date: date,
      purpose: `Stock correction: ${reason}`, reference_type: 'ADJUSTMENT', entered_by: userId, remarks: reason,
    });
    await audit({ userId, action: 'CREATE', table: 'material_stock_transactions', recordId: res.txn_id,
      newValues: { type: dir === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', material_id: materialId, qty, reason }, ip }, conn);
    return res;
  });
}

/* ---------- A.2  Material Card (paper card layout) ---------- */
async function card(materialIdRaw, q) {
  const id = v.toId(materialIdRaw, 'material id');
  const [mrows] = await pool.query(
    `SELECT m.id, m.material_code, m.material_name, m.place, m.unit, m.current_stock, m.minimum_stock,
            (m.current_stock <= m.minimum_stock) AS is_low_stock
     FROM materials m WHERE m.id = ?`, [id]);
  if (!mrows.length) throw new AppError('Material not found', 404);
  const m = { ...mrows[0], is_low_stock: !!mrows[0].is_low_stock };

  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  if (q.from) { where.push('x.txn_date >= ?'); args.push(v.date(q.from, 'From date', { allowFuture: true })); }
  if (q.to) { where.push('x.txn_date <= ?'); args.push(v.date(q.to, 'To date', { allowFuture: true })); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';

  const inner = `
    SELECT t.id, ROW_NUMBER() OVER (ORDER BY t.txn_date, t.id) AS s_no, t.txn_date, t.txn_type, t.purpose,
           t.despatch_qty AS issue, t.inward_qty AS received, t.closing_stock AS balance,
           t.reference_type, t.reference_no, t.batch_id, v.vendor_name, u.full_name AS sign, t.remarks
    FROM material_stock_transactions t
    JOIN users u ON u.id = t.entered_by
    LEFT JOIN vendors v ON v.id = t.vendor_id
    WHERE t.material_id = ?`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${inner}) x ${w}`, [id, ...args]);
  const [rows] = await pool.query(`SELECT x.* FROM (${inner}) x ${w} ORDER BY x.s_no ${dir} LIMIT ? OFFSET ?`, [id, ...args, limit, offset]);
  return { material: m, items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

/* ---------- A.3  Low-stock alerts ---------- */
async function lowStock() {
  const [rows] = await pool.query(
    `SELECT m.id, m.material_code, m.material_name, m.unit, m.current_stock, m.minimum_stock,
            (m.minimum_stock - m.current_stock) AS shortage
     FROM materials m WHERE m.is_active = 1 AND m.current_stock <= m.minimum_stock
     ORDER BY (m.current_stock / NULLIF(m.minimum_stock, 0)) ASC, m.material_name`);
  return { count: rows.length, items: rows };
}

module.exports = { postTxn, receipt, issue, adjustment, card, lowStock, ISSUE_TYPES };
