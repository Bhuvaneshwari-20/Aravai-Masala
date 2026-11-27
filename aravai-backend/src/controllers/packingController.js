const svc = require('../services/packingService');
const wrap = require('../utils/asyncWrap');
exports.queue = wrap((req) => svc.queue(req.query));
exports.lookups = wrap(() => svc.lookups());
exports.closeBatch = wrap((req) => svc.closeBatch(req.params.id, req.user.id, req.ip));
exports.list = wrap((req) => svc.list(req.query));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.get = wrap((req) => svc.get(req.params.id));