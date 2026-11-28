const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const MAX_ITEMS = 100;

const BASE = `SELECT i.id, i.indent_no, i.indent_date, i.remarks, i.status, i.requested_by, ru.full_name AS requested_by_name,
         i.decided_by, du.full_name AS decided_by_name, i.decided_at, i.decision_remark, i.re_edit_status, i.re_edit_remark, i.created_at,
         (SELECT COUNT(*) FROM indent_items x WHERE x.indent_id = i.id) AS item_count
  FROM indents i
  LEFT JOIN users ru ON ru.id = i.requested_by
  LEFT JOIN users du ON du.id = i.decided_by`;

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = []; const args = [];
  const st = String(q.status || '').toUpperCase();
 if (STATUSES.includes(st)) { where.push('i.status = ?'); args.push(st); }
else if (st === 'REEDIT') where.push("i.status = 'APPROVED' AND i.re_edit_status = 1");
  const s = v.clean(q.search);
  if (s) {
    where.push('(i.indent_no LIKE ? OR ru.full_name LIKE ? OR EXISTS (SELECT 1 FROM indent_items x JOIN materials m ON m.id = x.material_id WHERE x.indent_id = i.id AND m.material_name LIKE ?))');
    args.push(`%${s}%`, `%${s}%`, `%${s}%`);
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM indents i LEFT JOIN users ru ON ru.id = i.requested_by ${W}`, args);
  const [items] = await pool.query(`${BASE} ${W} ORDER BY (i.status = 'PENDING') DESC, i.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [cnt] = await pool.query('SELECT status, COUNT(*) AS n FROM indents GROUP BY status');
  const summary = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
 const [[re]] = await pool.query("SELECT COUNT(*) AS n FROM indents WHERE status = 'APPROVED' AND re_edit_status = 1");
summary.REEDIT = Number(re.n);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1), summary };
}

async function getById(idRaw) {
  const id = v.toId(idRaw, 'indent');
  const [rows] = await pool.query(`${BASE} WHERE i.id = ?`, [id]);
  if (!rows.length) throw new AppError('Indent not found', 404);
  const [items] = await pool.query(
    `SELECT x.id, x.material_id, m.material_code, m.material_name, x.specification, x.available_qty, x.required_qty, x.unit, x.required_date
       FROM indent_items x JOIN materials m ON m.id = x.material_id WHERE x.indent_id = ? ORDER BY x.id`, [id]);
  return { ...rows[0], items };
}

async function create(body, userId, ip) {
  if (!Array.isArray(body.items) || !body.items.length) throw new AppError('Add at least one material');
  if (body.items.length > MAX_ITEMS) throw new AppError(`At most ${MAX_ITEMS} materials in one indent`);
  const date = v.date(body.indent_date, 'Indent date', { allowFuture: false });
  const items = body.items.map((i, n) => ({
    material_id: v.toId(i.material_id, `material (line ${n + 1})`),
    specification: v.optStr(i.specification, `Specification (line ${n + 1})`, 255),
    required_qty: v.positive(i.required_qty, `Required quantity (line ${n + 1})`),
    required_date: v.date(i.required_date, `Required date (line ${n + 1})`, { allowFuture: true }),
  }));
  items.forEach((i, n) => { if (i.required_date < date) throw new AppError(`Required date (line ${n + 1}) cannot be before the indent date`); });
  const remarks = v.optStr(body.remarks, 'Remarks', 500);

  return withTransaction(async (conn) => {
    // available quantity comes from the stock, not from the screen
    const [mats] = await conn.query('SELECT id, material_name, unit, current_stock, is_active FROM materials WHERE id IN (?)', [[...new Set(items.map((i) => i.material_id))]]);
    const byId = new Map(mats.map((m) => [m.id, m]));
    items.forEach((i, n) => {
      const m = byId.get(i.material_id);
      if (!m) throw new AppError(`Material in line ${n + 1} does not exist`);
      if (!m.is_active) throw new AppError(`${m.material_name} is inactive`);
    });
    const [r] = await conn.query('INSERT INTO indents (indent_date, remarks, requested_by) VALUES (?,?,?)', [date, remarks, userId]);
    const no = `IND-${new Date().getFullYear()}-${String(r.insertId).padStart(4, '0')}`;
    await conn.query('UPDATE indents SET indent_no = ? WHERE id = ?', [no, r.insertId]);
    await conn.query('INSERT INTO indent_items (indent_id, material_id, specification, available_qty, required_qty, unit, required_date) VALUES ?',
      [items.map((i) => { const m = byId.get(i.material_id); return [r.insertId, i.material_id, i.specification, m.current_stock || 0, i.required_qty, m.unit || 'KG', i.required_date]; })]);
    await audit({ userId, action: 'CREATE', table: 'indents', recordId: r.insertId, newValues: { indent_no: no, lines: items.length }, ip }, conn);
    return { id: r.insertId, indent_no: no };
  });
}

// Manager / Super Admin: APPROVED or REJECTED (reason compulsory for a rejection)
async function decide(idRaw, status, body, user, ip) {
  const id = v.toId(idRaw, 'indent');
  const remark = v.optStr(body.remark, 'Remark', 500);
  if (status === 'REJECTED' && !remark) throw new AppError('Enter the reason for rejecting');
  const [r] = await pool.query("UPDATE indents SET status = ?, decided_by = ?, decided_at = NOW(), decision_remark = ? WHERE id = ? AND status = 'PENDING'", [status, user.id, remark, id]);
  if (!r.affectedRows) throw new AppError('This indent is not pending any more', 409);
  await audit({ userId: user.id, action: status, table: 'indents', recordId: id, newValues: { remark }, ip });
  return getById(id);
}

async function cancel(idRaw, user, ip) {
  const id = v.toId(idRaw, 'indent');
  const [[p]] = await pool.query('SELECT requested_by, status FROM indents WHERE id = ?', [id]);
  if (!p) throw new AppError('Indent not found', 404);
  if (p.status !== 'PENDING') throw new AppError('Only a pending indent can be cancelled', 409);
  if (p.requested_by !== user.id && user.role_name !== 'Super Admin') throw new AppError('Only the person who raised the indent can cancel it', 403);
  await pool.query("UPDATE indents SET status = 'CANCELLED', decided_by = ?, decided_at = NOW() WHERE id = ?", [user.id, id]);
  await audit({ userId: user.id, action: 'CANCEL', table: 'indents', recordId: id, ip });
  return getById(id);
}

// Edit (PENDING) or re-edit (APPROVED -> goes back to PENDING for the Manager)
async function update(idRaw, body, user, ip) {
  const id = v.toId(idRaw, 'indent');
  if (!Array.isArray(body.items) || !body.items.length) throw new AppError('Add at least one material');
  if (body.items.length > MAX_ITEMS) throw new AppError(`At most ${MAX_ITEMS} materials in one indent`);
  const items = body.items.map((i, n) => ({
    material_id: v.toId(i.material_id, `material (line ${n + 1})`),
    specification: v.optStr(i.specification, `Specification (line ${n + 1})`, 255),
    required_qty: v.positive(i.required_qty, `Required quantity (line ${n + 1})`),
    required_date: v.date(i.required_date, `Required date (line ${n + 1})`, { allowFuture: true }),
  }));
  const remarks = v.optStr(body.remarks, 'Remarks', 500);

  return withTransaction(async (conn) => {
    const [[ind]] = await conn.query('SELECT status, requested_by, indent_date, re_edit_status FROM indents WHERE id = ? FOR UPDATE', [id]);
    if (!ind) throw new AppError('Indent not found', 404);
    if (!['PENDING', 'APPROVED'].includes(ind.status)) throw new AppError('Only a pending or approved indent can be edited', 409);
    if (ind.status === 'APPROVED' && ind.re_edit_status !== 2) throw new AppError('Request a re-edit first and wait for the Manager to allow it', 409);
    if (ind.requested_by !== user.id && user.role_name !== 'Super Admin') throw new AppError('Only the person who raised the indent can edit it', 403);

    const [mats] = await conn.query('SELECT id, material_name, unit, current_stock, is_active FROM materials WHERE id IN (?)', [[...new Set(items.map((i) => i.material_id))]]);
    const byId = new Map(mats.map((m) => [m.id, m]));
    items.forEach((i, n) => {
      const m = byId.get(i.material_id);
      if (!m) throw new AppError(`Material in line ${n + 1} does not exist`);
      if (!m.is_active) throw new AppError(`${m.material_name} is inactive`);
      if (i.required_date < ind.indent_date) throw new AppError(`Required date (line ${n + 1}) cannot be before the indent date`);
    });

    await conn.query('DELETE FROM indent_items WHERE indent_id = ?', [id]);
    await conn.query('INSERT INTO indent_items (indent_id, material_id, specification, available_qty, required_qty, unit, required_date) VALUES ?',
      [items.map((i) => { const m = byId.get(i.material_id); return [id, i.material_id, i.specification, m.current_stock || 0, i.required_qty, m.unit || 'KG', i.required_date]; })]);
    await conn.query("UPDATE indents SET remarks = ?, status = 'PENDING', decided_by = NULL, decided_at = NULL, decision_remark = NULL, re_edit_status = 0, re_edit_remark = NULL WHERE id = ?", [remarks, id]);
    await audit({ userId: user.id, action: ind.status === 'APPROVED' ? 'REEDIT' : 'UPDATE', table: 'indents', recordId: id, newValues: { lines: items.length }, ip }, conn);
    return getById(id);
  });
}

// Delete: only while PENDING
async function remove(idRaw, user, ip) {
  const id = v.toId(idRaw, 'indent');
  const [[p]] = await pool.query('SELECT requested_by, status, indent_no FROM indents WHERE id = ?', [id]);
  if (!p) throw new AppError('Indent not found', 404);
  if (p.status !== 'PENDING') throw new AppError('Only a pending indent can be deleted', 409);
  if (p.requested_by !== user.id && user.role_name !== 'Super Admin') throw new AppError('Only the person who raised the indent can delete it', 403);
  await pool.query('DELETE FROM indents WHERE id = ?', [id]);
  await audit({ userId: user.id, action: 'DELETE', table: 'indents', recordId: id, newValues: { indent_no: p.indent_no }, ip });
  return { id };
}

// Admin: ask to re-edit an approved indent
async function requestReedit(idRaw, body, user, ip) {
  const id = v.toId(idRaw, 'indent');
  const remark = v.clean(body.remark);
  if (!remark) throw new AppError('Enter the reason for the re-edit');
  const [[p]] = await pool.query('SELECT status, requested_by, re_edit_status FROM indents WHERE id = ?', [id]);
  if (!p) throw new AppError('Indent not found', 404);
  if (p.status !== 'APPROVED') throw new AppError('Only an approved indent needs a re-edit request', 409);
  if (p.requested_by !== user.id && user.role_name !== 'Super Admin') throw new AppError('Only the person who raised the indent can request a re-edit', 403);
  if (p.re_edit_status === 1) throw new AppError('Re-edit already requested', 409);
  await pool.query('UPDATE indents SET re_edit_status = 1, re_edit_remark = ? WHERE id = ?', [remark.slice(0, 500), id]);
  await audit({ userId: user.id, action: 'REEDIT_REQUEST', table: 'indents', recordId: id, newValues: { remark }, ip });
  return getById(id);
}

// Manager: allow the re-edit
async function allowReedit(idRaw, user, ip) {
  const id = v.toId(idRaw, 'indent');
  const [[p]] = await pool.query('SELECT status, re_edit_status FROM indents WHERE id = ?', [id]);
  if (!p) throw new AppError('Indent not found', 404);
  if (p.status !== 'APPROVED' || p.re_edit_status !== 1) throw new AppError('No re-edit request waiting', 409);
  await pool.query('UPDATE indents SET re_edit_status = 2 WHERE id = ?', [id]);
  await audit({ userId: user.id, action: 'REEDIT_ALLOW', table: 'indents', recordId: id, ip });
  return getById(id);
}

// the number the next indent will get (shown in the New Indent form)
async function nextNo() {
  const [[r]] = await pool.query("SELECT AUTO_INCREMENT AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'indents'");
  return { indent_no: `IND-${new Date().getFullYear()}-${String(r.n).padStart(4, '0')}` };
}

module.exports = { list, getById, create, update, remove, decide, cancel, requestReedit, allowReedit, nextNo };
