const router = require('express').Router();
const c = require('../controllers/accountController');
const { authenticate } = require('../middleware/auth');
const allowRoles = require('../middleware/roles');
const { SUPER, ADMIN } = require('../utils/roles');

// Super Admin manages Admins. Admin manages staff. Nobody else.
router.use(authenticate, allowRoles(SUPER, ADMIN));
router.get('/', c.list);
router.get('/summary', c.summary);
router.get('/roles', c.roles);
router.post('/', c.create);
router.put('/:id', c.update);
router.patch('/:id/active', c.setActive);
module.exports = router;
