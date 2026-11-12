const svc = require('../services/stockService');
const wrap = require('../utils/asyncWrap');

exports.receipt = wrap((req) => svc.receipt(req.body, req.user.id, req.ip), 201);
exports.issue = wrap((req) => svc.issue(req.body, req.user.id, req.ip), 201);
exports.adjustment = wrap((req) => svc.adjustment(req.body, req.user.id, req.ip), 201);
exports.card = wrap((req) => svc.card(req.params.materialId, req.query));
exports.lowStock = wrap(() => svc.lowStock());
