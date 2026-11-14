const AppError = require('../utils/AppError');
const { pool } = require('../config/db');
const { authenticate } = require('./auth');
const { FULL_ACCESS } = require('../utils/roles');

// Same checks as authorize(), but passes when ANY of the (module, action) pairs is allowed.
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];
function authorizeAny(...pairs) {
  for (const [, a] of pairs) if (!ACTIONS.includes(a)) throw new Error(`Bad action ${a}`);
  return async (req, res, next) => {
    try {
      if (FULL_ACCESS.includes(req.user.role_name)) return next();
      for (const [module, action] of pairs) {
        const [rows] = await pool.query(`SELECT can_${action} AS ok FROM role_permissions WHERE role_id = ? AND module = ?`, [req.user.role_id, module]);
        if (rows.length && rows[0].ok) return next();
      }
      throw new AppError('You do not have permission for this action', 403);
    } catch (e) { next(e); }
  };
}

// <Image source={{ uri }}> cannot send headers, so the image route also accepts ?token=<jwt>.
// Only used on that one GET route. The token is removed from req.originalUrl so morgan does not log it.
function authenticateImage(req, res, next) {
  if (!req.headers.authorization && typeof req.query.token === 'string' && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
    req.originalUrl = req.originalUrl.replace(/([?&])token=[^&]*/, '$1token=redacted');
  }
  return authenticate(req, res, next);
}

module.exports = { authorizeAny, authenticateImage };
