const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PIN_RE = /^[0-9]{6}$/;
const BANK_AC_RE = /^[0-9]{9,18}$/;
const MAX_MATERIALS = 500;

// undefined -> not sent (keep current list). Otherwise unique positive integer ids.
function cleanMaterialIds(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError('Materials supplied must be a list');
  const ids = [...new Set(raw.map((x) => v.toId(x, 'material id')))];
  if (ids.length > MAX_MATERIALS) throw new AppError(`At most ${MAX_MATERIALS} materials can be linked to a vendor`);
  return ids;
}

async function saveMaterials(conn, vendorId, ids) {
  if (ids === undefined) return;
  if (ids.length) {
    const [found] = await conn.query('SELECT id FROM materials WHERE id IN (?)', [ids]);
    if (found.length !== ids.length) throw new AppError('One or more selected materials do not exist');
  }
  await conn.query('DELETE FROM vendor_materials WHERE vendor_id = ?', [vendorId]);
  if (ids.length) await conn.query('INSERT INTO vendor_materials (vendor_id, material_id) VALUES ?', [ids.map((m) => [vendorId, m])]);
}

async function loadMaterials(db, vendorId) {
  const [rows] = await db.query(
    `SELECT m.id, m.material_code, m.material_name, m.unit, c.category_name
       FROM vendor_materials vm JOIN materials m ON m.id = vm.material_id
       JOIN material_categories c ON c.id = m.category_id
      WHERE vm.vendor_id = ? ORDER BY c.category_name, m.material_name`, [vendorId]);
  return rows;
}

function cleanInput(body) {
  const d = {
    vendor_name: v.reqStr(body.vendor_name, 'Vendor name', 150),
    contact_person: v.optStr(body.contact_person, 'Contact person', 100),
    mobile: v.reqStr(body.mobile, 'Mobile', 15),
    email: v.optStr(body.email, 'Email', 100),
    address: v.optStr(body.address, 'Address', 1000),
    gst_number: v.optStr(body.gst_number, 'GST number', 15),
    payment_terms: v.optStr(body.payment_terms, 'Payment terms', 100),
    ref_no: v.optStr(body.ref_no, 'Ref no', 30),
    account_name: v.optStr(body.account_name, 'Account name', 150),
    opening_balance: v.num(body.opening_balance, 'Opening balance', { max: 999999999999, decimals: 2 }),
    account_group: v.optStr(body.account_group, 'Account group', 100),
    md_name: v.optStr(body.md_name, 'MD name', 100),
    landline: v.optStr(body.landline, 'Landline', 20),
    sms: v.optStr(body.sms, 'SMS number', 15),
    place: v.optStr(body.place, 'Place', 100),
    street: v.optStr(body.street, 'Street', 150),
    city: v.optStr(body.city, 'City', 80),
    state: v.optStr(body.state, 'State', 80),
    pin_code: v.optStr(body.pin_code, 'Pin code', 10),
    pan_no: v.optStr(body.pan_no, 'PAN number', 10),
    bank_name: v.optStr(body.bank_name, 'Bank name', 100),
    bank_branch: v.optStr(body.bank_branch, 'Bank branch', 100),
    bank_account_no: v.optStr(body.bank_account_no, 'Bank account number', 30),
    ifsc_code: v.optStr(body.ifsc_code, 'IFSC code', 11),
    material_ids: cleanMaterialIds(body.material_ids),
  };
  if (!v.MOBILE_RE.test(d.mobile)) throw new AppError('Mobile must be exactly 10 digits');
  if (d.sms && !v.MOBILE_RE.test(d.sms)) throw new AppError('SMS number must be exactly 10 digits');
  if (d.pin_code && !PIN_RE.test(d.pin_code)) throw new AppError('Pin code must be exactly 6 digits');
  if (d.pan_no) {
    d.pan_no = d.pan_no.toUpperCase();
    if (!PAN_RE.test(d.pan_no)) throw new AppError('PAN must be 10 characters (e.g. ABCDE1234F)');
  }
  if (d.ifsc_code) {
    d.ifsc_code = d.ifsc_code.toUpperCase();
    if (!IFSC_RE.test(d.ifsc_code)) throw new AppError('IFSC must be 11 characters (e.g. SBIN0001234)');
  }
  if (d.bank_account_no && !BANK_AC_RE.test(d.bank_account_no)) throw new AppError('Bank account number must be 9 to 18 digits');
  if (d.email && !v.EMAIL_RE.test(d.email)) throw new AppError('Email format is not valid');
  if (d.gst_number) {
    d.gst_number = d.gst_number.toUpperCase();
    if (!v.GST_RE.test(d.gst_number)) throw new AppError('GST number must be 15 characters in valid GSTIN format (e.g. 33ABCDE1234F1Z5)');
  }
  if (body.status !== undefined && body.status !== null && body.status !== '') {
    d.status = String(body.status).toUpperCase();
    if (!STATUSES.includes(d.status)) throw new AppError(`Status must be one of ${STATUSES.join(', ')}`);
  }
  return d;
}

async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'vendor id');
  const [rows] = await db.query('SELECT * FROM vendors WHERE id = ?', [id]);
  if (!rows.length) throw new AppError('Vendor not found', 404);
  return { ...rows[0], materials: await loadMaterials(db, rows[0].id) };
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  const search = v.clean(q.search);
  if (search) {
    where.push('(vendor_name LIKE ? OR vendor_code LIKE ? OR contact_person LIKE ? OR mobile LIKE ? OR ref_no LIKE ? OR account_name LIKE ? OR city LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like, like, like, like, like, like);
  }
  if (q.status) {
    const s = String(q.status).toUpperCase();
    if (!STATUSES.includes(s)) throw new AppError('Invalid status filter');
    where.push('status = ?'); args.push(s);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM vendors ${w}`, args);
  const [rows] = await pool.query(`SELECT * FROM vendors ${w} ORDER BY vendor_name ASC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

async function create(body, userId, ip) {
  const d = cleanInput(body);
  return withTransaction(async (conn) => {
    const code = await nextNumber(conn, 'VENDOR');
    const [r] = await conn.query(
      `INSERT INTO vendors (vendor_code, vendor_name, ref_no, account_name, opening_balance, account_group, contact_person, md_name,
         mobile, landline, sms, email, address, place, street, city, state, pin_code, gst_number, pan_no,
         bank_name, bank_branch, bank_account_no, ifsc_code, payment_terms, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, d.vendor_name, d.ref_no, d.account_name, d.opening_balance, d.account_group, d.contact_person, d.md_name,
        d.mobile, d.landline, d.sms, d.email, d.address, d.place, d.street, d.city, d.state, d.pin_code, d.gst_number, d.pan_no,
        d.bank_name, d.bank_branch, d.bank_account_no, d.ifsc_code, d.payment_terms, d.status || 'ACTIVE']);
    await saveMaterials(conn, r.insertId, d.material_ids);
    const created = await getById(r.insertId, conn);
    await audit({ userId, action: 'CREATE', table: 'vendors', recordId: r.insertId, newValues: created, ip }, conn);
    return created;
  });
}

async function update(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'vendor id');
  const d = cleanInput(body);
  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id FROM vendors WHERE id = ? FOR UPDATE', [id]);
    if (!cur.length) throw new AppError('Vendor not found', 404);
    const before = await getById(id, conn);
    await conn.query(
      `UPDATE vendors SET vendor_name=?, ref_no=?, account_name=?, opening_balance=?, account_group=?, contact_person=?, md_name=?,
         mobile=?, landline=?, sms=?, email=?, address=?, place=?, street=?, city=?, state=?, pin_code=?, gst_number=?, pan_no=?,
         bank_name=?, bank_branch=?, bank_account_no=?, ifsc_code=?, payment_terms=?, status=? WHERE id=?`,
      [d.vendor_name, d.ref_no, d.account_name, d.opening_balance, d.account_group, d.contact_person, d.md_name,
        d.mobile, d.landline, d.sms, d.email, d.address, d.place, d.street, d.city, d.state, d.pin_code, d.gst_number, d.pan_no,
        d.bank_name, d.bank_branch, d.bank_account_no, d.ifsc_code, d.payment_terms, d.status || before.status, id]);
    await saveMaterials(conn, id, d.material_ids);
    const after = await getById(id, conn);
    await audit({ userId, action: 'UPDATE', table: 'vendors', recordId: id, oldValues: before, newValues: after, ip }, conn);
    return after;
  });
}

async function setStatus(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'vendor id');
  const status = String(body.status || '').toUpperCase();
  if (!STATUSES.includes(status)) throw new AppError(`Status must be one of ${STATUSES.join(', ')}`);
  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id, status FROM vendors WHERE id = ? FOR UPDATE', [id]);
    if (!cur.length) throw new AppError('Vendor not found', 404);
    await conn.query('UPDATE vendors SET status = ? WHERE id = ?', [status, id]);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'vendors', recordId: id,
      oldValues: { status: cur[0].status }, newValues: { status }, ip }, conn);
    return getById(id, conn);
  });
}

module.exports = { list, getById, create, update, setStatus };
