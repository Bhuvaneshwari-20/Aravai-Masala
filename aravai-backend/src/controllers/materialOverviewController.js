const svc = require('../services/materialOverviewService');
const wrap = require('../utils/asyncWrap');

exports.summary = wrap((req) => svc.summary(req.query));
exports.materialTrace = wrap((req) => svc.materialTrace(req.params.id));
exports.batches = wrap((req) => svc.batches(req.query));
exports.batchTrace = wrap((req) => svc.batchTrace(req.params.id));
exports.transactions = wrap((req) => svc.transactions(req.query));