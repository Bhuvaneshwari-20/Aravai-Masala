const svc = require('../services/accountService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.user));
exports.summary = wrap((req) => svc.summary(req.user));
exports.roles = wrap(() => svc.staffRoles());
exports.create = wrap((req) => svc.create(req.user, req.body, req.ip), 201);
exports.update = wrap((req) => svc.update(req.user, req.params.id, req.body, req.ip));
exports.setActive = wrap((req) => svc.setActive(req.user, req.params.id, req.body.is_active, req.ip));
