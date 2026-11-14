const svc = require('../services/machineService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.get = wrap((req) => svc.getById(req.params.id));

exports.qrInfo = wrap((req) => svc.qrInfo(req.params.id));
exports.byToken = wrap((req) => svc.getByToken(req.params.code));

exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.update = wrap((req) => svc.update(req.params.id, req.body, req.user.id, req.ip));
exports.remove = wrap((req) => svc.remove(req.params.id, req.user.id, req.ip));
