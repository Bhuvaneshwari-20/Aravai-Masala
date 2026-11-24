const svc = require('../services/dashboardService');
const wrap = require('../utils/asyncWrap');

exports.today = wrap(() => svc.today());