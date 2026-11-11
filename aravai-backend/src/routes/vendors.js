const router = require('express').Router();
const c = require('../controllers/vendorController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('vendor', 'view'), c.list);
router.post('/', authorize('vendor', 'create'), c.create);
router.get('/:id', authorize('vendor', 'view'), c.get);
router.put('/:id', authorize('vendor', 'edit'), c.update);
router.patch('/:id/status', authorize('vendor', 'edit'), c.setStatus);
module.exports = router;
