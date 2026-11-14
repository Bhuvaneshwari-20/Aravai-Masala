const router = require('express').Router();
const c = require('../controllers/grindingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('grinding', 'view'), c.list);
router.get('/batches', authorize('grinding', 'view'), c.batches);
router.get('/machines', authorize('grinding', 'view'), c.machines);
router.post('/', authorize('grinding', 'create'), c.create);
module.exports = router;