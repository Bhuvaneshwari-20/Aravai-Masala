const router = require('express').Router();
const c = require('../controllers/productController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
// GET /products?include=recipe also returns each product's current recipe -> needs recipe view permission
const recipeIfAsked = (req, res, next) => (req.query.include === 'recipe' ? authorize('recipe', 'view')(req, res, next) : next());
// DELETE /products/:id?with_recipe=true also deletes the product's recipe -> needs recipe delete permission too
const recipeToo = (req, res, next) => (req.query.with_recipe === 'true' ? authorize('recipe', 'delete')(req, res, next) : next());
router.get('/', authorize('product', 'view'), recipeIfAsked, c.list);
router.post('/', authorize('product', 'create'), c.create);
router.get('/:id', authorize('product', 'view'), c.get);
router.put('/:id', authorize('product', 'edit'), c.update);
router.post('/:id/packs', authorize('product', 'create'), c.addPack);
router.put('/:id/packs/:packId', authorize('product', 'edit'), c.updatePack);
router.delete('/:id/packs/:packId', authorize('product', 'delete'), c.removePack);
router.delete('/:id', authorize('product', 'delete'), recipeToo, c.remove);
module.exports = router;