// Per-user permissions chosen by the Super Admin in "User Access & Permission Management".
//   table user_permissions: one row per (user, module) with ten independent switches
//     view (= the sidebar menu), create, edit, delete, start, stop, history, review, remark, approve
//
// How a request is decided (check()):
//   Super Admin                      -> always allowed
//   user HAS user_permissions rows   -> "explicit" user: ONLY those rows count
//        module has a row            -> the switch of that row (no switch = no access)
//        module has NO row           -> view: falls back to the role (so lookup lists keep working), every other action: denied
//   user has no rows                 -> the old rules, exactly as before (Admin role rules / role_permissions / user_menu_access)
//        (start / stop count as "create", history as "view", review / remark as "edit" for these old accounts)
const { pool } = require('../config/db');
const { SUPER, ADMIN, ADMIN_ACCESS, roleDecision } = require('./roles');
const menuAccess = require('./userMenuAccess');

const ACTIONS = ['view', 'create', 'edit', 'delete', 'start', 'stop', 'history', 'review', 'remark', 'approve'];
const LEGACY = { start: 'create', stop: 'create', history: 'view', review: 'edit', remark: 'edit' };
const NEVER = ['users'];                       // account management is never given through this table

async function ensure() {
  await pool.query(`CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INT UNSIGNED NOT NULL,
    module  VARCHAR(50)  NOT NULL,
    ${ACTIONS.map((a) => `can_${a} TINYINT(1) NOT NULL DEFAULT 0`).join(',\n    ')},
    PRIMARY KEY (user_id, module)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

const rowsOf = async (userId) => (await pool.query('SELECT * FROM user_permissions WHERE user_id = ?', [userId]))[0];

// true / false when the user is explicit, null when the old rules must decide
async function decide(user, module, action) {
  const rows = await rowsOf(user.id);
  if (!rows.length) return null;
  const r = rows.find((x) => x.module === module);
  if (r) return !!r[`can_${action}`];
  return action === 'view' ? null : false;
}

// THE server-side permission check (used by authorize / authorizeAny)
async function check(user, module, action) {
  if (user.role_name === SUPER) return true;
  const ex = await decide(user, module, action);
  if (ex !== null) return ex;
  const a = LEGACY[action] || action;
  const d = roleDecision(user.role_name, module, a);
  if (d !== null) return d;
  return menuAccess.allows(user, module, a);
}

// login / me: the list the frontend uses, or null when the user is not explicit
async function forProfile(userId) {
  const rows = await rowsOf(userId);
  if (!rows.length) return null;
  return rows.map(({ user_id, ...p }) => p);
}

const toMap = (r) => Object.fromEntries(ACTIONS.map((a) => [a, !!r[`can_${a}`]]));
const fromLegacy = (r) => ({
  view: true, history: true,
  create: !!r.can_create, start: !!r.can_create, stop: !!r.can_create,
  edit: !!r.can_edit, review: !!r.can_edit, remark: !!r.can_edit,
  delete: !!r.can_delete, approve: !!r.can_approve,
});
const ALL = Object.fromEntries(ACTIONS.map((a) => [a, true]));

// what the editor shows for a user: his saved permissions, or - when none are saved yet - what his role gives him today
async function effective(userId, roleId, roleName) {
  const rows = await rowsOf(userId);
  if (rows.length) return { explicit: true, permissions: Object.fromEntries(rows.map((r) => [r.module, toMap(r)])) };
  const out = {};
  if (roleName === ADMIN) {
    Object.entries(ADMIN_ACCESS).forEach(([m, a]) => {
      out[m] = a === '*' ? { ...ALL } : { ...Object.fromEntries(ACTIONS.map((x) => [x, a.includes(x)])), view: true };
    });
  } else {
    const [rp] = await pool.query('SELECT * FROM role_permissions WHERE role_id = ? AND can_view = 1', [roleId]);
    rp.forEach((r) => { out[r.module] = fromLegacy(r); });
    const [ov] = await pool.query('SELECT module, allowed FROM user_menu_access WHERE user_id = ?', [userId]);
    ov.forEach((o) => {
      if (!o.allowed) delete out[o.module];
      else if (!out[o.module]) out[o.module] = fromLegacy({ can_create: 1, can_edit: 1, can_delete: 0, can_approve: 0 });
    });
  }
  return { explicit: false, permissions: out };
}

// replace the user's permissions. permissions = { module: { create: true, start: false, ... } }. Empty = back to the role's rules.
async function save(userId, permissions) {
  const mods = Object.keys(permissions || {}).filter((m) => /^[a-z_]{2,50}$/.test(m) && !NEVER.includes(m));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
    if (mods.length) {
      const vals = mods.map((m) => [userId, m, ...ACTIONS.map((a) => (a === 'view' ? 1 : (permissions[m] && permissions[m][a] ? 1 : 0)))]);
      await conn.query(`INSERT INTO user_permissions (user_id, module, ${ACTIONS.map((a) => `can_${a}`).join(', ')}) VALUES ?`, [vals]);
    }
    await conn.query('DELETE FROM user_menu_access WHERE user_id = ?', [userId]);   // the older menu-only choice is replaced by this
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
const clear = async (userId) => { await pool.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]); };
const countsFor = async (ids) => {
  if (!ids.length) return {};
  const [r] = await pool.query('SELECT user_id, COUNT(*) n FROM user_permissions WHERE user_id IN (?) GROUP BY user_id', [ids]);
  return Object.fromEntries(r.map((x) => [x.user_id, x.n]));
};

module.exports = { ACTIONS, LEGACY, ensure, check, forProfile, effective, save, clear, countsFor };