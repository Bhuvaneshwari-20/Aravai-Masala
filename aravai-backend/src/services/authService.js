
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');
const { FULL_ACCESS, SUPER } = require('../utils/roles');
const userPerms = require('../utils/userPermissions');
const menuAccess = require('../utils/userMenuAccess');
const bcrypt = require('bcryptjs');

async function login(username, password, ip) {
  if (!username || !password) {
    throw new AppError('Username and password required');
  }

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE username = ?',
    [username]
  );

  const u = rows[0];

   // bcrypt hash ($2a$/$2b$...) for accounts made in Users; plain text for the old accounts
  const isHash = !!u && /^\$2[aby]\$/.test(u.password_hash || '');
  const okPw = !!u && (isHash ? await bcrypt.compare(password, u.password_hash) : password === u.password_hash);
  if (!okPw) {
    throw new AppError('Invalid username or password', 401);
  }
  if (!u.is_active) {
    throw new AppError('This account is deactivated. Contact your admin.', 403);
  }

  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = ?',
    [u.id]
  );

  await audit({
    userId: u.id,
    action: 'LOGIN',
    table: 'users',
    recordId: u.id,
    ip
  });

  const token = jwt.sign(
    { id: u.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );

  return { token, user: await profile(u.id) };
}

async function profile(userId) {
  const [[u]] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.role_id, r.role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [userId]
  );

  if (!u) throw new AppError('User not found', 404);

  const [perms] = await pool.query(
    `SELECT module, can_view, can_create, can_edit,
            can_delete, can_approve
     FROM role_permissions
     WHERE role_id = ?`,
    [u.role_id]
  );

   const explicit = u.role_name === SUPER
  ? null
  : await userPerms.forProfile(u.id);

if (explicit) {
  return {
    ...u,
    explicit: true,
    permissions: explicit
  };
}

return {
  ...u,
  explicit: false,
  permissions: FULL_ACCESS.includes(u.role_name)
    ? 'ALL'
    : await menuAccess.apply(u.id, perms)
};
}

async function createUser(data, actorId, ip) {
  const { full_name, username, password, role_id, mobile, email } = data;

  if (!full_name || !username || !password || !role_id) {
    throw new AppError(
      'full_name, username, password, role_id are required'
    );
  }

  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters');
  }

  const [r] = await pool.query(
    `INSERT INTO users
     (full_name, username, password_hash, role_id, mobile, email)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [full_name, username, password, role_id, mobile || null, email || null]
  );

  await audit({
    userId: actorId,
    action: 'CREATE',
    table: 'users',
    recordId: r.insertId,
    newValues: { username, role_id },
    ip
  });

  return { id: r.insertId };
}

async function changePassword(userId, oldPw, newPw) {
  const [[u]] = await pool.query(
    'SELECT password_hash FROM users WHERE id = ?',
    [userId]
  );

   const isHash = !!u && /^\$2[aby]\$/.test(u.password_hash || '');
  const okOld = !!u && (isHash ? await bcrypt.compare(oldPw, u.password_hash) : oldPw === u.password_hash);
  if (!okOld) {
    throw new AppError('Old password is incorrect', 401);
  }

  if (!newPw || newPw.length < 6) {
    throw new AppError('New password must be at least 6 characters');
  }

  await pool.query(
    'UPDATE users SET password_hash = ? WHERE id = ?',
        [await bcrypt.hash(newPw, 10), userId]
  );
}

async function listUsers() {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.mobile,
            u.email, u.is_active, r.role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     ORDER BY u.id`
  );

  return rows;
}

module.exports = {
  login,
  profile,
  createUser,
  changePassword,
  listUsers
};
