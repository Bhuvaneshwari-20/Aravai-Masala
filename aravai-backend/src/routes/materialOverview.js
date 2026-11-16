const router = require('express').Router();
const c = require('../controllers/materialOverviewController');
const { authenticate, authorize } = require('../middleware/auth');

// Read-only. Anyone who may view Material Master may view Material Overview (no new permission row is needed).
router.use(authenticate);
router.get('/summary', authorize('material', 'view'), c.summary);
router.get('/materials/:id', authorize('material', 'view'), c.materialTrace);
router.get('/batches', authorize('material', 'view'), c.batches);
router.get('/batches/:id', authorize('material', 'view'), c.batchTrace);
module.exports = router;