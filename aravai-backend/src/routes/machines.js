const router = require('express').Router();
const c = require('../controllers/machineController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Machine type master + history.
// Keep these ABOVE '/:id', otherwise "types" would be read as a machine id.
// They reuse the existing 'machine' permissions, so no permission changes are needed.
router.get('/types', authorize('machine', 'view'), c.typeList);
router.post('/types', authorize('machine', 'create'), c.typeCreate);
router.get('/types/:id/history', authorize('machine', 'view'), c.typeHistory);
router.put('/types/:id', authorize('machine', 'edit'), c.typeUpdate);
router.delete('/types/:id', authorize('machine', 'delete'), c.typeRemove);
router.get('/pack-sizes', authorize('machine', 'view'), c.packSizes);
// Machine QR routes
router.get('/by-token/:code', authorize('machine', 'view'), c.byToken);
router.get('/:id/qr', authorize('machine', 'view'), c.qrInfo);

// Machine CRUD routes
router.get('/', authorize('machine', 'view'), c.list);
router.get('/:id', authorize('machine', 'view'), c.get);
router.post('/', authorize('machine', 'create'), c.create);
router.put('/:id', authorize('machine', 'edit'), c.update);
router.put('/:id/status', authorize('machine', 'edit'), c.setStatus); // status badge on the card
router.delete('/:id', authorize('machine', 'delete'), c.remove);

module.exports = router;