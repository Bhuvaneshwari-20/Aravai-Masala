const svc = require('../services/batchService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.active = wrap(() => svc.active());
exports.staff = wrap(() => svc.staff());
exports.weighingMachines = wrap(() => svc.weighingMachines());
exports.get = wrap((req) => svc.getById(req.params.id));
exports.start = wrap((req) => svc.start(req.body, req.user.id, req.ip), 201);
exports.addBatching = wrap((req) => svc.addBatching(req.params.id, req.body, req.user, req.ip), 201);
exports.completeBatching = wrap((req) => svc.completeBatching(req.params.id, req.user.id, req.ip));
exports.hold = wrap((req) => svc.hold(req.params.id, req.body, req.user.id, req.ip));
exports.resume = wrap((req) => svc.resume(req.params.id, req.user.id, req.ip));
