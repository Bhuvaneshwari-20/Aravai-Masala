const router = require('express').Router();
const c = require('../controllers/machineController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Machine QR routes
router.get('/by-token/:code', authorize('machine', 'view'), c.byToken);
router.get('/:id/qr', authorize('machine', 'view'), c.qrInfo);

// Machine CRUD routes
router.get('/', authorize('machine', 'view'), c.list);
router.get('/:id', authorize('machine', 'view'), c.get);
router.post('/', authorize('machine', 'create'), c.create);
router.put('/:id', authorize('machine', 'edit'), c.update);
router.delete('/:id', authorize('machine', 'delete'), c.remove);

module.exports = router;
