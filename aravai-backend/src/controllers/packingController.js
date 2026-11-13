const svc = require('../services/packingService');
const wrap = require('../utils/asyncWrap');

exports.lookups = wrap(() => svc.lookups());
exports.list = wrap((req) => svc.list(req.query));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);