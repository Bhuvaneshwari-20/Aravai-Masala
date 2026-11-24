const router = require('express').Router();
const c = require('../controllers/trackingController');
const { authenticate, authorize } = require('../middleware/auth');

// Read-only. Anyone who may view Batching may view Tracking (no new permission row is needed).
router.use(authenticate);
router.get('/board', authorize('batching', 'view'), c.board);
router.get('/process-weights', authorize('batching', 'view'), c.processWeights);
router.get('/batches/:id', authorize('batching', 'view'), c.detail);
module.exports = router;