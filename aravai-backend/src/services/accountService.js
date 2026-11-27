const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const { SUPER, ADMIN, FULL_ACCESS } = require('../utils/roles');
const userPerms = require('../utils/userPermissions');

// Who creates whom:  Super Admin -> any role he picks (default Admin),   Admin -> User (staff)
const CREATES = { [SUPER]: ADMIN, [ADMIN]: 'User' };
const COLS = 'u.id, u.full_name, u.username, u.is_active, u.created_at, u.role_id, r.role_name';

const roleId = async (name) => {
  const [[r]] = await pool.query('SELECT id FROM roles WHERE role_name = ?', [name]);
  if (!r) throw new AppError(`Role "${name}" is missing. Run aravai_migration_v4.sql`, 500);
  return r.id;
};

// Super Admin sees every account except Super Admin (Admins, System Admin, staff). Admin sees only the staff they created.
async function listRows(actor) {
  if (actor.role_name === SUPER) {
    const [rows] = await pool.query(`SELECT ${COLS} FROM users u JOIN roles r ON r.id = u.role_id WHERE r.role_name <> ? ORDER BY u.id DESC`, [SUPER]);
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT ${COLS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.created_by = ? AND r.role_name NOT IN (?) ORDER BY u.id DESC`,
    [actor.id, FULL_ACCESS]);
  return rows;
}
async function list(actor) {
  const rows = await listRows(actor);
  const n = await userPerms.countsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, access_menus: n[r.id] || 0, has_explicit: !!n[r.id] }));
}

async function summary(actor) {
  const rows = await listRows(actor);
  const active = rows.filter((r) => r.is_active).length;
  return { total: rows.length, active, inactive: rows.length - active };
}

// Roles an Admin may give to staff (everything except Admin / Super Admin)
async function staffRoles() {
  const [rows] = await pool.query('SELECT id, role_name FROM roles WHERE role_name NOT IN (?) ORDER BY id', [FULL_ACCESS]);
  return rows;
}

// Role this actor may give: Super Admin -> every role except Super Admin. Admin -> staff roles only.
async function assignableRole(actor, id) {
  const [[r]] = await pool.query('SELECT id, role_name FROM roles WHERE id = ?', [Number(id) || 0]);
  const ok = r && (actor.role_name === SUPER ? r.role_name !== SUPER : !FULL_ACCESS.includes(r.role_name));
  if (!ok) throw new AppError('Invalid role');
  return r;
}

async function rolePermissions() {
  const [roles] = await pool.query('SELECT id, role_name, description FROM roles ORDER BY id');
  const [perms] = await pool.query('SELECT role_id, module, can_view, can_create, can_edit, can_delete, can_approve FROM role_permissions ORDER BY module');
  return roles.map((r) => {
    const full = FULL_ACCESS.includes(r.role_name);
    return {
      id: r.id, role_name: r.role_name, description: r.description, full_access: full,
      permissions: full ? 'ALL' : perms.filter((p) => p.role_id === r.id).map(({ role_id, ...p }) => p),
    };
  });
}

async function create(actor, body, ip) {
  const { full_name, username, password } = body;
  if (!full_name || !username || !password) throw new AppError('Name, username and password are required');
  if (password.length < 8) throw new AppError('Password must be at least 8 characters');

  let rid = await roleId(CREATES[actor.role_name]);
  if (body.role_id) rid = (await assignableRole(actor, body.role_id)).id;
  try {
    const [r] = await pool.query(
      'INSERT INTO users (full_name, username, password_hash, role_id, created_by) VALUES (?,?,?,?,?)',
      [String(full_name).trim(), String(username).trim(), await bcrypt.hash(password, 10), rid, actor.id]);
    if (actor.role_name === SUPER && body.permissions && typeof body.permissions === 'object') await userPerms.save(r.insertId, body.permissions);
    await audit({ userId: actor.id, action: 'CREATE', table: 'users', recordId: r.insertId, newValues: { username, role_id: rid, modules: Object.keys(body.permissions || {}) }, ip });
    return { id: r.insertId };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError('That username is already taken', 409);
    throw e;
  }
}

// The account must be one this actor is allowed to manage (a Super Admin account is never manageable here)
async function managed(actor, id) {
  const [[t]] = await pool.query('SELECT u.*, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
  const ok = t && (actor.role_name === SUPER
    ? t.role_name !== SUPER
    : t.created_by === actor.id && !FULL_ACCESS.includes(t.role_name));
  if (!ok) throw new AppError('Account not found', 404);
  return t;
}

async function update(actor, id, body, ip) {
  const t = await managed(actor, id);
  const name = String(body.full_name || t.full_name).trim();
  let hash = t.password_hash;
  if (body.password) {
    if (body.password.length < 8) throw new AppError('Password must be at least 8 characters');
    hash = await bcrypt.hash(body.password, 10);
  }
  let rid = t.role_id;
  if (body.role_id) rid = (await assignableRole(actor, body.role_id)).id;
  await pool.query('UPDATE users SET full_name = ?, password_hash = ?, role_id = ? WHERE id = ?', [name, hash, rid, t.id]);
  if (actor.role_name === SUPER && body.permissions && typeof body.permissions === 'object') await userPerms.save(t.id, body.permissions);
  await audit({ userId: actor.id, action: 'UPDATE', table: 'users', recordId: t.id, oldValues: { role_id: t.role_id }, newValues: { full_name: name, role_id: rid, password_changed: !!body.password, modules: body.permissions ? Object.keys(body.permissions) : undefined }, ip });
  return { message: 'Updated' };
}

async function permissionsOf(actor, id) {
  if (actor.role_name !== SUPER) throw new AppError('Only the Super Admin can see user permissions', 403);
  const t = await managed(actor, id);
  return userPerms.effective(t.id, t.role_id, t.role_name);
}

async function setActive(actor, id, isActive, ip) {
  const t = await managed(actor, id);
  const a = isActive ? 1 : 0;
  await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [a, t.id]);
  await audit({ userId: actor.id, action: 'STATUS_CHANGE', table: 'users', recordId: t.id, oldValues: { is_active: t.is_active }, newValues: { is_active: a }, ip });
  return { message: a ? 'Activated' : 'Deactivated' };
}

// Delete: Super Admin only. Never himself, never a Super Admin account (so the last Super Admin can never disappear).
// A user who already has records in the system cannot be deleted (the database keeps the history): deactivate instead.
async function remove(actor, id, ip) {
  if (actor.role_name !== SUPER) throw new AppError('Only the Super Admin can delete accounts', 403);
  const t = await managed(actor, id);
  if (t.id === actor.id) throw new AppError('You cannot delete your own account', 400);
  try { await pool.query('DELETE FROM users WHERE id = ?', [t.id]); }
  catch (e) {
    if (e.errno === 1451 || e.code === 'ER_ROW_IS_REFERENCED_2') throw new AppError('This user already has records in the system, so it cannot be deleted. Deactivate the account instead.', 409);
    throw e;
  }
  await userPerms.clear(t.id);
  await pool.query('DELETE FROM user_menu_access WHERE user_id = ?', [t.id]).catch(() => {});
  await audit({ userId: actor.id, action: 'DELETE', table: 'users', recordId: t.id, oldValues: { username: t.username, role: t.role_name }, ip });
  return { message: 'Deleted' };
}

module.exports = { list, summary, staffRoles, rolePermissions, create, update, setActive, permissionsOf, remove };