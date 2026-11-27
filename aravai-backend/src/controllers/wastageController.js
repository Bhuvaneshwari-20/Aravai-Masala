const svc = require('../services/wastageService');
const wrap = require('../utils/asyncWrap');
exports.report = wrap((req) => svc.report(req.query));