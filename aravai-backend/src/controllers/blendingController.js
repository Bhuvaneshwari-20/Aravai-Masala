const svc = require('../services/blendingService');
const wrap = require('../utils/asyncWrap');

exports.lookups = wrap(() => svc.lookups());
exports.list = wrap((req) => svc.list(req.query));
exports.queue = wrap((req) => svc.queue(req.query));
exports.start = wrap((req) => svc.start(req.body, req.user.id, req.ip), 201);
exports.stop = wrap((req) => svc.stop(req.body, req.user.id, req.ip));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.get = wrap((req) => svc.get(req.params.id));