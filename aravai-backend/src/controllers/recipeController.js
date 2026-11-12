const svc = require('../services/recipeService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.get = wrap((req) => svc.getById(req.params.id));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.setStatus = wrap((req) => svc.setStatus(req.params.id, req.body, req.user.id, req.ip));
