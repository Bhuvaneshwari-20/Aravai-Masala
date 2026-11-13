const router = require('express').Router();
const c = require('../controllers/filteringController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/staff', authorize('filtering', 'view'), c.staff);
router.get('/', authorize('filtering', 'view'), c.list);          // ?tab=pending | done
router.post('/', authorize('filtering', 'create'), c.create);
module.exports = router;