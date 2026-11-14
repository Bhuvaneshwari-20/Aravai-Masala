const router = require('express').Router();
const c = require('../controllers/roastingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/options', authorize('roasting', 'view'), c.options);
router.get('/recipe-materials', authorize('roasting', 'view'), c.recipeMaterials);
router.get('/batches', authorize('roasting', 'view'), c.batches);
router.get('/', authorize('roasting', 'view'), c.list);
router.post('/', authorize('roasting', 'create'), c.create);
router.put('/:id', authorize('roasting', 'edit'), c.update);
module.exports = router;