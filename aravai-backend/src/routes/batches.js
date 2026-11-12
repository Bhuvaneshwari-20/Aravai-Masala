const router = require('express').Router();
const c = require('../controllers/batchController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
// fixed paths first, then /:id
router.get('/', authorize('batching', 'view'), c.list);
router.get('/active', authorize('batching', 'view'), c.active);
router.get('/staff', authorize('batching', 'view'), c.staff);
router.get('/weighing-machines', authorize('batching', 'view'), c.weighingMachines);
router.post('/', authorize('batching', 'create'), c.start);
router.get('/:id', authorize('batching', 'view'), c.get);
router.post('/:id/batching', authorize('batching', 'create'), c.addBatching);
router.post('/:id/batching/complete', authorize('batching', 'edit'), c.completeBatching);
router.patch('/:id/hold', authorize('batching', 'approve'), c.hold);
router.patch('/:id/resume', authorize('batching', 'approve'), c.resume);
module.exports = router;
