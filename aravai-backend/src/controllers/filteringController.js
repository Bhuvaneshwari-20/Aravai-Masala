const svc = require('../services/filteringService');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.query));
exports.staff = wrap(() => svc.staff());
exports.create = wrap((req) => svc.create(req.body, req.user, req.ip), 201);