const svc = require('../services/filteringService');
const ps = require('../services/processService');
const wrap = require('../utils/asyncWrap');

const T = 'FILTERING';
exports.list = wrap((req) => svc.list(req.query));
exports.staff = wrap(() => svc.staff());
exports.create = wrap((req) => svc.create(req.body, req.user, req.ip), 201);
// material cards (Start / Stop / Proceed to Roasting)
exports.queue = wrap((req) => ps.queue(T, req.query));
exports.history = wrap((req) => ps.history(T, req.query));
exports.start = wrap((req) => ps.start(T, req.body, req.user, req.ip), 201);
exports.stop = wrap((req) => ps.stop(T, req.body, req.user, req.ip));
exports.proceed = wrap((req) => ps.proceed(req.body, req.user, req.ip));
exports.alert = wrap((req) => ps.alertDue(T, req.body));