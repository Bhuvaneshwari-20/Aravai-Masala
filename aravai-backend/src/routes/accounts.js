const router = require('express').Router();
const c = require('../controllers/accountController');
const { authenticate } = require('../middleware/auth');
const allowRoles = require('../middleware/allowRoles');
const { SUPER, ADMIN } = require('../utils/roles');

// Super Admin manages every account and its permissions. Admin manages the staff he created. Nobody else.
router.use(authenticate, allowRoles(SUPER, ADMIN));
router.get('/', c.list);
router.get('/summary', c.summary);
router.get('/roles', c.roles);
router.post('/', c.create);

router.get('/roles/permissions', allowRoles(SUPER), c.rolePermissions);   // must stay BEFORE /:id/permissions
router.get('/:id/permissions', allowRoles(SUPER), c.permissions);          // saved (or role-default) permissions of one user
router.put('/:id', c.update);
router.patch('/:id/active', c.setActive);
router.delete('/:id', allowRoles(SUPER), c.remove);                        // Super Admin only
module.exports = router;