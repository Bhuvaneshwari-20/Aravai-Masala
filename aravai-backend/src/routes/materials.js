const router = require('express').Router();
const c = require('../controllers/materialController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/units', authorize('material', 'view'), c.listUnits);
router.post('/units', authorize('material', 'create'), c.createUnit);
router.get('/', authorize('material', 'view'), c.list);
router.post('/', authorize('material', 'create'), c.create);
router.get('/:id', authorize('material', 'view'), c.get);
router.put('/:id', authorize('material', 'edit'), c.update);
router.patch('/:id/status', authorize('material', 'edit'), c.setStatus);
router.delete('/:id', authorize('material', 'delete'), c.remove);
module.exports = router;
