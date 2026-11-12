const router = require('express').Router();
const c = require('../controllers/gramController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('gram', 'view'), c.list);
router.post('/', authorize('gram', 'create'), c.create);
router.delete('/:id', authorize('gram', 'delete'), c.remove);
module.exports = router;
