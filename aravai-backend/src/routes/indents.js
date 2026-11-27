const router = require('express').Router();
const c = require('../controllers/indentController');
const { authenticate, authorize } = require('../middleware/auth');

// module 'purchase' = the Purchase menu: Admin view + create + edit (cancel), Manager view + approve
router.use(authenticate);
router.get('/', authorize('purchase', 'view'), c.list);
router.post('/', authorize('purchase', 'create'), c.create);
router.put('/:id', authorize('purchase', 'edit'), c.update);
router.delete('/:id', authorize('purchase', 'edit'), c.remove);
router.get('/:id', authorize('purchase', 'view'), c.get);
router.patch('/:id/approve', authorize('purchase', 'approve'), c.approve);
router.patch('/:id/reject', authorize('purchase', 'approve'), c.reject);
router.patch('/:id/cancel', authorize('purchase', 'edit'), c.cancel);
module.exports = router;
