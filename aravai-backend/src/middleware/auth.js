const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { roleDecision } = require('../utils/roles');
const menuAccess = require('../utils/userMenuAccess');

// 1) Verify JWT and load the user
async function authenticate(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new AppError('Authentication required', 401);
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); }
    catch { throw new AppError('Invalid or expired token', 401); }
    const [rows] = await pool.query(
      'SELECT u.id, u.full_name, u.username, u.role_id, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.is_active = TRUE', [payload.id]);
    if (!rows.length) throw new AppError('User inactive or not found', 401);
    req.user = rows[0];
    next();
  } catch (e) { next(e); }
}

// 2) Module permission check: authorize('indent', 'create')
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];
function authorize(module, action = 'view') {
  if (!ACTIONS.includes(action)) throw new Error(`Bad action ${action}`);
  return async (req, res, next) => {
    try {
      const d = roleDecision(req.user.role_name, module, action);   // Super Admin / Admin decided by role
      if (d === true) return next();
      if (d === false) throw new AppError('You do not have permission for this action', 403);
      if (!(await menuAccess.allows(req.user, module, action))) throw new AppError('You do not have permission for this action', 403);
      next();
    } catch (e) { next(e); }
  };
}
module.exports = { authenticate, authorize };