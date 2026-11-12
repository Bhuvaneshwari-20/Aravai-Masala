const router = require('express').Router();
const c = require('../controllers/stockController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/low-stock', authorize('stock', 'view'), c.lowStock);
router.get('/card/:materialId', authorize('stock', 'view'), c.card);
router.post('/receipts', authorize('stock', 'create'), c.receipt);
router.post('/issues', authorize('stock', 'create'), c.issue);
router.post('/adjustments', authorize('stock', 'edit'), c.adjustment);
module.exports = router;
