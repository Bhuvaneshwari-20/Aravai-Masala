const router = require('express').Router();
const c = require('../controllers/blendingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/lookups', authorize('blending', 'view'), c.lookups);
router.get('/queue', authorize('blending', 'view'), c.queue);          // must stay above '/:id'
router.get('/', authorize('blending', 'view'), c.list);
router.get('/:id', authorize('blending', 'view'), c.get);
router.post('/start', authorize('blending', 'create'), c.start);
router.post('/stop', authorize('blending', 'create'), c.stop);
router.post('/', authorize('blending', 'create'), c.create);
module.exports = router;