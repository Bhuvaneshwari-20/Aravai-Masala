const router = require('express').Router();
const c = require('../controllers/materialController');
const { authenticate, authorize } = require('../middleware/auth');
const AppError = require('../utils/AppError');

const adminOnly = (req, res, next) =>
  req.user.role_name === 'Admin' ? next() : next(new AppError('Only Admin can create categories', 403));

router.use(authenticate);
router.get('/', authorize('material', 'view'), c.listCategories);
router.post('/', adminOnly, c.createCategory);
module.exports = router;
