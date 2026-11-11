const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/accounts', require('./accounts'));
router.use('/material-categories', require('./materialCategories'));
router.use('/materials', require('./materials'));
router.use('/vendors', require('./vendors'));
module.exports = router;
