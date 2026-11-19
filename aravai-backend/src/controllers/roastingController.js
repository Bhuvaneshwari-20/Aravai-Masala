const svc = require('../services/roastingService');
const ps = require('../services/processService');
const wrap = require('../utils/asyncWrap');

const T = 'ROASTING';
exports.list = wrap((req) => svc.list(req.query));
exports.options = wrap(() => svc.options());
exports.recipeMaterials = wrap((req) => svc.recipeMaterials(req.query));
exports.batches = wrap((req) => svc.batchesFor(req.query));
exports.batchOptions = wrap((req) => svc.batchOptions(req.query));
exports.batchMaterials = wrap((req) => svc.batchMaterials(req.query));
exports.create = wrap((req) => svc.create(req.body, req.user, req.ip), 201);
exports.finishBatch = wrap((req) => svc.finishBatch(req.body, req.user, req.ip));
exports.update = wrap((req) => svc.update(req.params.id, req.body, req.user, req.ip));
// material cards (Start / Stop)
exports.queue = wrap((req) => ps.queue(T, req.query));
exports.history = wrap((req) => ps.history(T, req.query));
exports.start = wrap((req) => ps.start(T, req.body, req.user, req.ip), 201);
exports.stop = wrap((req) => ps.stop(T, req.body, req.user, req.ip));
exports.alert = wrap((req) => ps.alertDue(T, req.body));