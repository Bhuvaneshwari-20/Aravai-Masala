const router = require('express').Router();
const c = require('../controllers/recipeController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('recipe', 'view'), c.list);
router.post('/', authorize('recipe', 'create'), c.create);
router.get('/:id', authorize('recipe', 'view'), c.get);
router.patch('/:id/status', authorize('recipe', 'edit'), c.setStatus);
module.exports = router;
