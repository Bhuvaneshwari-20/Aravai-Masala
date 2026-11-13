const router = require('express').Router();
router.use('/auth', require('./auth'));
router.use('/accounts', require('./accounts'));
router.use('/material-categories', require('./materialCategories'));
router.use('/materials', require('./materials'));
router.use('/vendors', require('./vendors'));
router.use('/stock', require('./stock'));
router.use('/grams', require('./grams'));
router.use('/products', require('./products'));
router.use('/recipes', require('./recipes'));
router.use('/batches', require('./batches'));
router.use('/machines', require('./machines'));
router.use('/blending', require('./blending'));
router.use('/packing', require('./packing')); 

module.exports = router;
