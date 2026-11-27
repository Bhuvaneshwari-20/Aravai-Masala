const AppError = require('../utils/AppError');
const { authenticate } = require('./auth');
const perms = require('../utils/userPermissions');

// Same checks as authorize(), but passes when ANY of the (module, action) pairs is allowed.
function authorizeAny(...pairs) {
  for (const [, a] of pairs) if (!perms.ACTIONS.includes(a)) throw new Error(`Bad action ${a}`);
  return async (req, res, next) => {
    try {
      for (const [module, action] of pairs) {
        if (await perms.check(req.user, module, action)) return next();
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