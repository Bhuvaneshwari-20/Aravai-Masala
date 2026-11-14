const svc = require('../services/meshService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap(() => svc.list());
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.remove = wrap((req) => svc.remove(req.params.id, req.user.id, req.ip));