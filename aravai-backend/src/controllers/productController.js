const svc = require('../services/productService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.get = wrap((req) => svc.getById(req.params.id));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.update = wrap((req) => svc.update(req.params.id, req.body, req.user.id, req.ip));
exports.addPack = wrap((req) => svc.addPack(req.params.id, req.body, req.user.id, req.ip), 201);
exports.updatePack = wrap((req) => svc.updatePack(req.params.id, req.params.packId, req.body, req.user.id, req.ip));
