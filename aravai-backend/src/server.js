const app = require('./app');
const { pool } = require('./config/db');
const port = process.env.PORT || 4000;
(async () => {
  await pool.query('SELECT 1'); // fail fast if DB is unreachable
  await require('./utils/ensureBatchMachineLock')(pool); // adds batch_master.weighing_machine_id / machine_locked_at if missing
  await require('./utils/ensureProcessWorkflow')(pool); // adds batch_master.process_mode + process_sessions (material cards) if missing
  await require('./utils/ensureBatchRoastingMode')(pool); // adds batch_master.roasting_mode (DIRECT / AFTER_FILTERING / PARALLEL) if missing
  try { await require('./utils/ensureBatchWeightImages')(pool); } // creates batch_weight_images (weighing machine photos) if missing
  catch (e) { console.error(`WARNING: batch weight photo table could not be created: ${e.message}`); }
  try { console.log(`Machine QR links will open: ${require('./utils/qrToken').qrUrl('<token>')}`); } // catches a missing / localhost APP_URL at start-up
  catch (e) { console.warn(`WARNING: ${e.message}`); }
  app.listen(port, () => console.log(`Aravai API running on :${port}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });