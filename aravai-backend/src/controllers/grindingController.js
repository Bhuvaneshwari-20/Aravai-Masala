const svc = require('../services/grindingService');
const ps = require('../services/processService');
const wrap = require('../utils/asyncWrap');

const T = 'GRINDING';
exports.list = wrap((req) => svc.list(req.query));
exports.create = wrap((req) => svc.create(req.body, req.user.id, req.ip), 201);
exports.batches = wrap((req) => svc.batchOptions());
exports.machines = wrap((req) => svc.machineOptions());
exports.meshes = wrap(() => svc.meshOptions());
exports.createMesh = wrap((req) => svc.createMesh(req.body, req.user.id, req.ip), 201);
// material cards (Start / Stop)
exports.queue = wrap((req) => ps.queue(T, req.query));
exports.history = wrap((req) => ps.history(T, req.query));
exports.start = wrap((req) => ps.start(T, req.body, req.user, req.ip), 201);
exports.stop = wrap((req) => ps.stop(T, req.body, req.user, req.ip));
exports.alert = wrap((req) => ps.alertDue(T, req.body));