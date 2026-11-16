const svc = require('../services/trackingService');
const wrap = require('../utils/asyncWrap');

exports.board = wrap((req) => svc.board(req.query));
exports.detail = wrap((req) => svc.detail(req.params.id));