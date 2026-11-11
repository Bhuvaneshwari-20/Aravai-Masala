const svc = require('../services/authService');
const wrap = (fn) => async (req, res, next) => {
  try { res.json({ success: true, data: await fn(req) }); } catch (e) { next(e); }
};
exports.login = wrap((req) => svc.login(req.body.username, req.body.password, req.ip));
exports.me = wrap((req) => svc.profile(req.user.id));
exports.createUser = wrap((req) => svc.createUser(req.body, req.user.id, req.ip));
exports.listUsers = wrap(() => svc.listUsers());
exports.changePassword = wrap(async (req) => {
  await svc.changePassword(req.user.id, req.body.old_password, req.body.new_password);
  return { message: 'Password updated' };
});
