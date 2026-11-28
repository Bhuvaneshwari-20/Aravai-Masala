const router = require('express').Router();
const c = require('../controllers/roastingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
// material cards (Start / Stop) - used by the Roasting screen (ProcessBoard)
router.get('/queue', authorize('roasting', 'view'), c.queue);
router.get('/history', authorize('roasting', 'view'), c.history);
router.post('/start', authorize('roasting', 'create'), c.start);
router.post('/stop', authorize('roasting', 'create'), c.stop);
router.post('/start-group', authorize('roasting', 'create'), c.startGroup);   // saved pair (or old combined roast) on one machine
router.post('/stop-group', authorize('roasting', 'create'), c.stopGroup);
router.post('/alert', authorize('roasting', 'view'), c.alert);
// old form endpoints (kept)
router.get('/options', authorize('roasting', 'view'), c.options);
router.get('/recipe-materials', authorize('roasting', 'view'), c.recipeMaterials);
router.get('/batches', authorize('roasting', 'view'), c.batches);
router.get('/batch-options', authorize('roasting', 'view'), c.batchOptions);
router.get('/batch-materials', authorize('roasting', 'view'), c.batchMaterials);
router.get('/', authorize('roasting', 'view'), c.list);
router.post('/finish', authorize('roasting', 'create'), c.finishBatch);
router.post('/', authorize('roasting', 'create'), c.create);
router.put('/:id', authorize('roasting', 'edit'), c.update);
router.get('/session/:id', authorize('roasting', 'view'), c.detail);
module.exports = router;