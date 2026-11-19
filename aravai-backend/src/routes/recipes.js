const router = require('express').Router();
const c = require('../controllers/recipeController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('recipe', 'view'), c.list);
router.post('/', authorize('recipe', 'create'), c.create);
router.get('/product/:productId/history', authorize('recipe', 'view'), c.history);   // all versions of one product + materials (must stay above /:id)
router.delete('/product/:productId', authorize('recipe', 'delete'), c.removeForProduct);   // delete the whole recipe of a product (all versions)
router.get('/:id', authorize('recipe', 'view'), c.get);
router.put('/:id', authorize('recipe', 'edit'), c.update);
router.patch('/:id/status', authorize('recipe', 'edit'), c.setStatus);
module.exports = router;