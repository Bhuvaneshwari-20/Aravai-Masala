// Per-user sidebar / module access, chosen by the Super Admin in the Add / Edit user form.
//   table user_menu_access (user_id, module, allowed)
//     allowed = 1 -> this user MAY open that module   (view always; create / edit / delete / approve follow the role_permissions row,
//                    and when the role has no row for it: create + edit only)
//     allowed = 0 -> this user may NOT open that module (even if the role says yes)
//     no row      -> nothing changes: the role_permissions of the user's role decide, exactly as before.
// Super Admin / Admin ('ALL') never come here.
const { pool } = require('../config/db');

const clean = (a) => [...new Set((Array.isArray(a) ? a : []).map(String).filter((m) => /^[a-z_]{2,50}$/.test(m)))];
const ZERO = { can_view: 0, can_create: 0, can_edit: 0, can_delete: 0, can_approve: 0 };

async function ensure() {
  await pool.query(`CREATE TABLE IF NOT EXISTS user_menu_access (
    user_id INT UNSIGNED NOT NULL,
    module  VARCHAR(50)  NOT NULL,
    allowed TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, module)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// role_permissions rows of a user -> the same list with this user's choices applied (used by login / profile)
async function apply(userId, perms) {
  const [rows] = await pool.query('SELECT module, allowed FROM user_menu_access WHERE user_id = ?', [userId]);
  if (!rows.length) return perms;
  const m = new Map(perms.map((p) => [p.module, { ...p }]));
  for (const r of rows) {
    const old = m.get(r.module);
    if (!r.allowed) { m.set(r.module, { module: r.module, ...ZERO }); continue; }
    m.set(r.module, {
      module: r.module, can_view: 1,
      can_create: old ? old.can_create : 1, can_edit: old ? old.can_edit : 1,
      can_delete: old ? old.can_delete : 0, can_approve: old ? old.can_approve : 0,
    });
  }
  return [...m.values()];
}

// the server-side check (replaces the single role_permissions query in authorize / authorizeAny)
async function allows(user, module, action) {
  const [base] = await pool.query(`SELECT can_${action} AS ok FROM role_permissions WHERE role_id = ? AND module = ?`, [user.role_id, module]);
  const [mine] = await pool.query('SELECT allowed FROM user_menu_access WHERE user_id = ? AND module = ?', [user.id, module]);
  if (!mine.length) return !!(base.length && base[0].ok);
  if (!mine[0].allowed) return false;
  if (action === 'view') return true;
  return base.length ? !!base[0].ok : (action === 'create' || action === 'edit');
}

// for the account list: { userId: { allowed: [modules], hasOverride } }
async function mapFor(userIds) {
  const out = {};
  if (!userIds.length) return out;
  const [rows] = await pool.query('SELECT user_id, module, allowed FROM user_menu_access WHERE user_id IN (?)', [userIds]);
  rows.forEach((r) => {
    const o = out[r.user_id] || (out[r.user_id] = { allowed: [], hasOverride: true });
    if (r.allowed) o.allowed.push(r.module);
  });
  return out;
}

// replace this user's choices. allowed / denied = arrays of module keys. Both empty = back to the role's defaults.
async function save(userId, allowed, denied) {
  const a = clean(allowed);
  const d = clean(denied).filter((x) => !a.includes(x));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM user_menu_access WHERE user_id = ?', [userId]);
    const vals = [...a.map((m) => [userId, m, 1]), ...d.map((m) => [userId, m, 0])];
    if (vals.length) await conn.query('INSERT INTO user_menu_access (user_id, module, allowed) VALUES ?', [vals]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
const clear = (userId) => pool.query('DELETE FROM user_menu_access WHERE user_id = ?', [userId]);

module.exports = { ensure, apply, allows, mapFor, save, clear };