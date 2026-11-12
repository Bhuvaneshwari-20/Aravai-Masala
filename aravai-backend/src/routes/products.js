const router = require('express').Router();
const c = require('../controllers/productController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('product', 'view'), c.list);
router.post('/', authorize('product', 'create'), c.create);
router.get('/:id', authorize('product', 'view'), c.get);
router.put('/:id', authorize('product', 'edit'), c.update);
router.post('/:id/packs', authorize('product', 'create'), c.addPack);
router.put('/:id/packs/:packId', authorize('product', 'edit'), c.updatePack);
module.exports = router;
