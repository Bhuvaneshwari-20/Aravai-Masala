const router = require('express').Router();
const c = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

// Every user sees only his / her own notifications, so no module permission is needed (login only).
router.use(authenticate);

router.get('/stream', c.stream);                 // website live channel (SSE)
router.get('/unread-count', c.unreadCount);
router.get('/settings', c.settings);             // { web_enabled, push_enabled, push_available, devices }
router.put('/settings', c.saveSettings);

router.post('/devices', c.deviceRegister);       // register / refresh this phone's FCM token
router.delete('/devices', c.deviceUnregister);   // logout: body { token }
router.post('/push/test', c.pushTest);

router.get('/phone', c.phoneStatus);             // Telegram (unchanged)
router.post('/phone/link', c.phoneLink);
router.post('/phone/test', c.phoneTest);
router.delete('/phone', c.phoneDisconnect);

router.get('/', c.list);                         // also marks the user as "inside the website" (presence)
router.post('/read-all', c.readAll);
router.post('/:id/read', c.read);

router.delete('/', c.clearAll);                  // hide all of my alerts (must stay AFTER /phone and /devices)
router.delete('/:id', c.remove);                 // hide one alert
module.exports = router;