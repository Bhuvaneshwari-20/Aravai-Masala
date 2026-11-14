const svc = require('../services/grindingService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.batches = wrap((req) => svc.batchOptions());
exports.machines = wrap((req) => svc.machineOptions());