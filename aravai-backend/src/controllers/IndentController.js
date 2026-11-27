const svc = require('../services/indentService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.get = wrap((req) => svc.getById(req.params.id));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.approve = wrap((req) => svc.decide(req.params.id, 'APPROVED', req.body, req.user, req.ip));
exports.reject = wrap((req) => svc.decide(req.params.id, 'REJECTED', req.body, req.user, req.ip));
exports.cancel = wrap((req) => svc.cancel(req.params.id, req.user, req.ip));
exports.update = wrap((req) => svc.update(req.params.id, req.body, req.user, req.ip));
exports.remove = wrap((req) => svc.remove(req.params.id, req.user, req.ip));