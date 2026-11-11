const AppError = require('../utils/AppError');
// allowRoles('Super Admin', 'Admin')  -> only these role names may pass
module.exports = (...names) => (req, res, next) =>
  names.includes(req.user.role_name) ? next() : next(new AppError('You are not allowed to do this', 403));
