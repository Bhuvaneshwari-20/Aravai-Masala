const router = require('express').Router();
const c = require('../controllers/grindingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
// material cards
router.get('/queue', authorize('grinding', 'view'), c.queue);
router.get('/history', authorize('grinding', 'view'), c.history);
router.post('/start', authorize('grinding', 'create'), c.start);
router.post('/stop', authorize('grinding', 'create'), c.stop);
router.post('/alert', authorize('grinding', 'view'), c.alert);
// old form endpoints (kept)
router.get('/', authorize('grinding', 'view'), c.list);
router.get('/batches', authorize('grinding', 'view'), c.batches);
router.get('/machines', authorize('grinding', 'view'), c.machines);
router.get('/meshes', authorize('grinding', 'view'), c.meshes);
router.post('/meshes', authorize('grinding', 'create'), c.createMesh);
router.post('/', authorize('grinding', 'create'), c.create);
module.exports = router;