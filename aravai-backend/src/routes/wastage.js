const router = require('express').Router();
const c = require('../controllers/wastageController');
const { authenticate, authorize } = require('../middleware/auth');

// Super Admin only: 'wastage' is not in ADMIN_ACCESS, so Admin is refused, and no other role has a permission row for it
router.use(authenticate);
router.get('/', authorize('wastage', 'view'), c.report);
module.exports = router;