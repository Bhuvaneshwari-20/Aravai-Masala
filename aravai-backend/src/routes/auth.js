const router = require('express').Router();
const c = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
// user creation/listing moved to /accounts (Super Admin -> Admin -> User rules)

router.post('/login', c.login);
router.get('/me', authenticate, c.me);
router.post('/change-password', authenticate, c.changePassword);
module.exports = router;
