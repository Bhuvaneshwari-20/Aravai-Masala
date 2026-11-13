const router = require('express').Router();
const c = require('../controllers/packingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/lookups', authorize('packing', 'view'), c.lookups);
router.get('/', authorize('packing', 'view'), c.list);
router.post('/', authorize('packing', 'create'), c.create);
module.exports = router;