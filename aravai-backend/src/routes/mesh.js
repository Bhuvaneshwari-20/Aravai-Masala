const router = require('express').Router();
const c = require('../controllers/meshController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('mesh', 'view'), c.list);
router.post('/', authorize('mesh', 'create'), c.create);
router.delete('/:id', authorize('mesh', 'delete'), c.remove);
module.exports = router;