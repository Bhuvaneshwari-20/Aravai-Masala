const router = require('express').Router();
const c = require('../controllers/packingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/lookups', authorize('packing', 'view'), c.lookups);
router.get('/queue', authorize('packing', 'view'), c.queue);
router.post('/batches/:id/close', authorize('packing', 'create'), c.closeBatch);
router.get('/', authorize('packing', 'view'), c.list);
router.get('/:id', authorize('packing', 'view'), c.get);
router.post('/', authorize('packing', 'create'), c.create);
module.exports = router;