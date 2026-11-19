const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { lowLevelSql, lowLevelOf } = require('../utils/lowStock');

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

  const level = await lowLevelOf(conn, m.id); // 10% of the biggest stock on the stock card (this row included)
  const low = closing <= level;
  return {
    txn_id: r.insertId,
    material_id: m.id, material_code: m.material_code, material_name: m.material_name, unit: m.unit,
    opening_stock: opening, closing_stock: closing, minimum_stock: level,
    is_low_stock: low,
    low_stock_alert: low ? `Low stock: ${m.material_name} is ${closing} ${m.unit} (low stock level ${level} ${m.unit})` : null,
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
  const unitIn = String(body.unit || '').trim().toUpperCase(); // only used for a material that has no unit yet

  return withTransaction(async (conn) => {
    const [ven] = await conn.query('SELECT id, vendor_name, status FROM vendors WHERE id = ?', [vendorId]);
    if (!ven.length) throw new AppError('Vendor not found', 404);
    if (ven[0].status !== 'ACTIVE') throw new AppError(`Vendor ${ven[0].vendor_name} is ${ven[0].status.toLowerCase()}`);

    // double-entry guard: same vendor + invoice/challan + material already received
    const [dup] = await conn.query(
      `SELECT id FROM material_stock_transactions
       WHERE txn_type = 'INWARD' AND vendor_id = ? AND reference_no = ? AND material_id = ? LIMIT 1`, [vendorId, refNo, materialId]);
    if (dup.length) throw new AppError('This invoice/challan is already entered for this material and vendor', 409);

    // A material is created WITHOUT a unit. The unit chosen with its first stock receipt becomes its unit (and then stays fixed).
    const [mu] = await conn.query('SELECT unit FROM materials WHERE id = ? FOR UPDATE', [materialId]);
    if (!mu.length) throw new AppError('Material not found', 404);
    const curUnit = String(mu[0].unit || '').trim();
    if (!curUnit) {
      if (!unitIn) throw new AppError('Select the unit of this material');
      const [un] = await conn.query('SELECT unit_name FROM material_units WHERE unit_name = ?', [unitIn]);
      if (!un.length) throw new AppError('Selected unit does not exist. Add it first using "Add unit"');
      await conn.query('UPDATE materials SET unit = ? WHERE id = ?', [un[0].unit_name, materialId]);
    } else if (unitIn && unitIn !== curUnit.toUpperCase()) {
      throw new AppError(`This material is already stocked in ${curUnit}. Its unit cannot be changed`);
    }

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

/* ---------- A.1b  Latest receipt of a material (to edit it) ---------- */
async function latestReceipt(materialIdRaw) {
  const materialId = v.toId(materialIdRaw, 'material id');
  const [rows] = await pool.query(
    `SELECT t.id, t.material_id, t.vendor_id, t.reference_no, t.inward_qty AS quantity, t.txn_date, t.remarks, t.closing_stock
     FROM material_stock_transactions t
     WHERE t.material_id = ? AND t.txn_type = 'INWARD'
     ORDER BY t.txn_date DESC, t.id DESC LIMIT 1`, [materialId]);
  if (!rows.length) return null;
  const r = rows[0];
  return { ...r, quantity: Number(r.quantity), txn_date: String(r.txn_date).slice(0, 10) };
}

/* ---------- A.1c  Edit a material receipt ----------
 * Vendor, invoice/challan no, date and remarks are simply updated. If the quantity changes, the difference is carried
 * through every later line of the material card (opening / closing balance) and into materials.current_stock.
 * A reduction is refused when later issues need that stock (balance would go below 0). */
async function updateReceipt(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'receipt id');
  const vendorId = v.toId(body.vendor_id, 'vendor');
  const refNo = v.reqStr(body.reference_no, 'Invoice / challan number', 50);
  if (body.quantity === undefined || body.quantity === null || String(body.quantity).trim() === '') throw new AppError('Quantity is required');
  const qty = v.num(body.quantity, 'Quantity'); // editing a receipt may set it to 0 (nothing received); a NEW receipt still needs more than 0
  const date = v.date(body.txn_date, 'Receipt date');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);

  return withTransaction(async (conn) => {
    const [trows] = await conn.query(
      `SELECT * FROM material_stock_transactions WHERE id = ? AND txn_type = 'INWARD' FOR UPDATE`, [id]);
    if (!trows.length) throw new AppError('Receipt not found', 404);
    const old = trows[0];
    if (body.material_id && Number(body.material_id) !== Number(old.material_id)) throw new AppError('The material of a receipt cannot be changed');

    const [mrows] = await conn.query('SELECT id, material_name, unit, current_stock FROM materials WHERE id = ? FOR UPDATE', [old.material_id]);
    if (!mrows.length) throw new AppError('Material not found', 404);
    const m = mrows[0];

    const [ven] = await conn.query('SELECT id, vendor_name, status FROM vendors WHERE id = ?', [vendorId]);
    if (!ven.length) throw new AppError('Vendor not found', 404);
    if (Number(old.vendor_id) !== vendorId && ven[0].status !== 'ACTIVE') throw new AppError(`Vendor ${ven[0].vendor_name} is ${ven[0].status.toLowerCase()}`);

    const [dup] = await conn.query(
      `SELECT id FROM material_stock_transactions
       WHERE txn_type = 'INWARD' AND vendor_id = ? AND reference_no = ? AND material_id = ? AND id <> ? LIMIT 1`, [vendorId, refNo, old.material_id, id]);
    if (dup.length) throw new AppError('This invoice/challan is already entered for this material and vendor', 409);

    const round = (n) => Math.round(n * 1000) / 1000;
    const delta = round(qty - Number(old.inward_qty));
    if (delta !== 0) {
      const [later] = await conn.query(
        'SELECT id, opening_stock, closing_stock FROM material_stock_transactions WHERE material_id = ? AND id > ? ORDER BY id FOR UPDATE', [old.material_id, id]);
      const newCurrent = round(Number(m.current_stock) + delta);
      const bad = later.some((r) => round(Number(r.opening_stock) + delta) < 0 || round(Number(r.closing_stock) + delta) < 0);
      if (newCurrent < 0 || bad) {
        throw new AppError(`Cannot reduce this receipt: later issues of ${m.material_name} already used this stock. Use Stock Correction instead.`);
      }
      if (later.length) {
        await conn.query(
          `UPDATE material_stock_transactions
           SET opening_stock = opening_stock + ?, closing_stock = closing_stock + ?, total_qty = total_qty + ?
           WHERE material_id = ? AND id > ?`, [delta, delta, delta, old.material_id, id]);
      }
      await conn.query('UPDATE materials SET current_stock = ? WHERE id = ?', [newCurrent, old.material_id]);
    }

    await conn.query(
      `UPDATE material_stock_transactions
       SET txn_date = ?, vendor_id = ?, agency_supplier = ?, purpose = ?, reference_no = ?, remarks = ?,
           inward_qty = ?, closing_stock = closing_stock + ?, total_qty = total_qty + ?
       WHERE id = ?`,
      [date, vendorId, ven[0].vendor_name, `Received from ${ven[0].vendor_name}`, refNo, remarks, qty, delta, delta, id]);

    await audit({ userId, action: 'UPDATE', table: 'material_stock_transactions', recordId: id,
      oldValues: { vendor_id: old.vendor_id, reference_no: old.reference_no, qty: Number(old.inward_qty), date: String(old.txn_date).slice(0, 10), remarks: old.remarks },
      newValues: { vendor_id: vendorId, reference_no: refNo, qty, date, remarks }, ip }, conn);

    const [[cur]] = await conn.query('SELECT current_stock FROM materials WHERE id = ?', [old.material_id]);
    return { txn_id: id, material_id: old.material_id, material_name: m.material_name, unit: m.unit, closing_stock: Number(cur.current_stock), quantity_change: delta };
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
    `SELECT m.id, m.material_code, m.material_name, m.place, m.unit, m.current_stock, ${lowLevelSql('m')} AS minimum_stock,
            (m.current_stock <= ${lowLevelSql('m')}) AS is_low_stock
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
    `SELECT m.id, m.material_code, m.material_name, m.unit, m.current_stock, ${lowLevelSql('m')} AS minimum_stock,
            (${lowLevelSql('m')} - m.current_stock) AS shortage
     FROM materials m WHERE m.is_active = 1 AND m.current_stock <= ${lowLevelSql('m')}
     ORDER BY (m.current_stock / NULLIF(${lowLevelSql('m')}, 0)) ASC, m.material_name`);
  return { count: rows.length, items: rows };
}

module.exports = { postTxn, receipt, latestReceipt, updateReceipt, issue, adjustment, card, lowStock, ISSUE_TYPES };