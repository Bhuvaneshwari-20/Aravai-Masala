const svc = require('../services/notificationService');
const hub = require('../services/notificationHub');
const wrap = require('../utils/asyncWrap');

exports.list = wrap((req) => svc.list(req.user.id, req.query));
exports.unreadCount = wrap((req) => svc.unreadCount(req.user.id));
exports.read = wrap((req) => svc.markRead(req.user.id, req.params.id));
exports.readAll = wrap((req) => svc.markAllRead(req.user.id));

// the user is always req.user (from the login token) - nothing about "who" is read from the request body
exports.settings = wrap((req) => svc.getSettings(req.user.id));
exports.saveSettings = wrap((req) => svc.saveSettings(req.user.id, req.body || {}));
exports.deviceRegister = wrap((req) => svc.registerDevice(req.user.id, req.body || {}));
exports.deviceUnregister = wrap((req) => svc.unregisterDevice(req.user.id, req.body || {}));
exports.pushTest = wrap((req) => svc.sendTestPush(req.user.id));

exports.phoneStatus = wrap((req) => svc.phoneStatus(req.user.id));
exports.phoneLink = wrap((req) => svc.createLinkCode(req.user.id));
exports.phoneTest = wrap((req) => svc.sendTest(req.user.id));
exports.phoneDisconnect = wrap((req) => svc.disconnectPhone(req.user.id));

// Website live channel (Server-Sent Events). Not wrapped: the response stays open.
exports.stream = (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  hub.add(req.user.id, res);
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(beat); hub.remove(req.user.id, res); });
};

exports.remove = wrap((req) => svc.remove(req.user.id, req.params.id));
exports.clearAll = wrap((req) => svc.clearAll(req.user.id));