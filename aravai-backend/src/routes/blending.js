const router = require('express').Router();
const c = require('../controllers/blendingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/lookups', authorize('blending', 'view'), c.lookups);
router.get('/', authorize('blending', 'view'), c.list);
router.post('/', authorize('blending', 'create'), c.create);
module.exports = router;