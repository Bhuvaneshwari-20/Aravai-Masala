const router = require('express').Router();
const c = require('../controllers/batchController');
const rc = require('../controllers/recipeController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
// fixed paths first, then /:id
router.get('/', authorize('batching', 'view'), c.list);
router.get('/active', authorize('batching', 'view'), c.active);
router.get('/staff', authorize('batching', 'view'), c.staff);
router.get('/recipe-materials', authorize('batching', 'view'), rc.addableMaterials);   // New Batch > Add Material: materials that can still be added
router.post('/recipe-materials', authorize('batching', 'create'), rc.addMaterial);        // adds one to the product recipe (new recipe version)
router.get('/weighing-machines', authorize('batching', 'view'), c.weighingMachines);
router.post('/verify-machine', authorize('batching', 'create'), c.verifyMachine); // scanned machine QR -> machine id / name / tare
router.post('/', authorize('batching', 'create'), c.start);
router.get('/:id', authorize('batching', 'view'), c.get);
router.post('/:id/batching', authorize('batching', 'create'), c.addBatching);
router.post('/:id/extra-material', authorize('batching', 'edit'), c.addExtraMaterial);
router.put('/:id/materials/:materialId', authorize('batching', 'edit'), c.updateMaterial);       // edit one weighed material (bags, weight, qty, Filter tick)
router.delete('/:id/materials/:materialId', authorize('batching', 'edit'), c.removeMaterial);   // delete one material (stock goes back)
router.post('/:id/batching/complete', authorize('batching', 'edit'), c.completeBatching);
router.patch('/:id/hold', authorize('batching', 'approve'), c.hold);
router.patch('/:id/resume', authorize('batching', 'approve'), c.resume);
module.exports = router;