const router = require('express').Router();
const c = require('../controllers/dashboardController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/today', authorize('batching', 'view'), c.today);
module.exports = router;