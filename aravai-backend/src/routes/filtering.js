const router = require('express').Router();
const c = require('../controllers/filteringController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/staff', authorize('filtering', 'view'), c.staff);
// material cards
router.get('/queue', authorize('filtering', 'view'), c.queue);
router.get('/history', authorize('filtering', 'view'), c.history);
router.post('/start', authorize('filtering', 'create'), c.start);
router.post('/stop', authorize('filtering', 'create'), c.stop);
router.post('/proceed', authorize('filtering', 'create'), c.proceed);   // sequential mode: "Proceed to Roasting?" -> Yes
router.post('/alert', authorize('filtering', 'view'), c.alert);
// old register (kept)
router.get('/', authorize('filtering', 'view'), c.list);          // ?tab=pending | done
router.post('/', authorize('filtering', 'create'), c.create);
module.exports = router;