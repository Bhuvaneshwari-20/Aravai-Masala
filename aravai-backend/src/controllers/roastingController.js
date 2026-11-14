const svc = require('../services/roastingService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.options = wrap(() => svc.options());
exports.recipeMaterials = wrap((req) => svc.recipeMaterials(req.query));
exports.batches = wrap((req) => svc.batchesFor(req.query));
exports.create = wrap((req) => svc.create(req.body, req.user, req.ip), 201);
exports.update = wrap((req) => svc.update(req.params.id, req.body, req.user, req.ip));