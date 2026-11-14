// Weighing machine photo for batching.  Mounted under /api/v1 (see routes/index.js).
//   POST /batches/weight-image  (+ /:imageId/manual-verify)           same, for the New Batch form (draft photo, no batch yet)
//   POST /batches/:id/batching/weight-image                          photo + material_id + entered_weight -> OCR check
//   POST /batches/:id/batching/weight-image/:imageId/manual-verify   supervisor, UNREADABLE only
//   GET  /batches/:id/weight-images/:imageId/file                    the stored photo (accepts ?token= so <Image> can load it)
const router = require('express').Router();
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth');
const { authorizeAny, authenticateImage } = require('../middleware/weighingAuth');
const asyncWrap = require('../utils/asyncWrap');
const AppError = require('../utils/AppError');
const svc = require('../services/batchWeightImageService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const takeImage = (req, res, next) => upload.single('image')(req, res, (err) => {
  if (!err) return next();
  next(err.code === 'LIMIT_FILE_SIZE' ? new AppError('The photo is too large (max 10 MB)') : new AppError('Could not read the uploaded photo'));
});

// New Batch form: the batch does not exist yet, so the photo is stored as a draft and attached when the batch is saved
router.post('/batches/weight-image', authenticate, authorize('batching', 'create'), takeImage,
  asyncWrap((req) => svc.upload(null, req.file, req.body, req.user, req.ip), 201));
router.post('/batches/weight-image/:imageId/manual-verify', authenticate, authorize('batching', 'approve'),
  asyncWrap((req) => svc.manualVerify(null, req.params.imageId, req.body, req.user, req.ip)));

router.post('/batches/:id/batching/weight-image', authenticate, authorize('batching', 'create'), takeImage,
  asyncWrap((req) => svc.upload(req.params.id, req.file, req.body, req.user, req.ip), 201));

router.post('/batches/:id/batching/weight-image/:imageId/manual-verify', authenticate, authorize('batching', 'approve'),
  asyncWrap((req) => svc.manualVerify(req.params.id, req.params.imageId, req.body, req.user, req.ip)));

router.get('/batches/:id/weight-images/:imageId/file', authenticateImage, authorizeAny(['batching', 'view'], ['batching', 'create'], ['weighing_review', 'view']),
  (req, res, next) => {
    svc.file(req.params.id, req.params.imageId).then(({ file, mime }) => {
      res.set('Cross-Origin-Resource-Policy', 'cross-origin'); // helmet default would block the web build (other port) from showing it
      res.set('Cache-Control', 'private, max-age=86400');
      res.type(mime).sendFile(file, (e) => { if (e && !res.headersSent) next(new AppError('Image file not found', 404)); });
    }).catch(next);
  });

module.exports = router;
