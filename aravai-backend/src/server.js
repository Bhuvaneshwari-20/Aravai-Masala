const app = require('./app');
const { pool } = require('./config/db');
const port = process.env.PORT || 4000;
(async () => {
  await pool.query('SELECT 1'); // fail fast if DB is unreachable
  await require('./utils/ensureBatchMachineLock')(pool); // adds batch_master.weighing_machine_id / machine_locked_at if missing
  await require('./utils/ensureProcessWorkflow')(pool); // adds batch_master.process_mode + process_sessions (material cards) if missing
  await require('./utils/ensureBatchRoastingMode')(pool); // adds batch_master.roasting_mode (DIRECT / AFTER_FILTERING / PARALLEL) if missing
  
    try { await require('./utils/ensureMaterialUnits')(pool); } // creates material_units (the Unit dropdown list) if missing
  catch (e) { console.error(`WARNING: material units table could not be created: ${e.message}`); }// adds batch_master.roasting_mode (DIRECT / AFTER_FILTERING / PARALLEL) if missing

  try { await require('./utils/ensureNotifications')(pool); } // creates notifications / phone alert tables if missing
  catch (e) { console.error(`WARNING: notification tables could not be created: ${e.message}`); }
  try { await require('./utils/ensureBatchWeightImages')(pool); } // creates batch_weight_images (weighing machine photos) if missing
  catch (e) { console.error(`WARNING: batch weight photo table could not be created: ${e.message}`); }
  try { console.log(`Machine QR links will open: ${require('./utils/qrToken').qrUrl('<token>')}`); } // catches a missing / localhost APP_URL at start-up
  catch (e) { console.warn(`WARNING: ${e.message}`); }
  app.listen(port, () => {
    console.log(`Aravai API running on :${port}`);
    try { require('./jobs/processAlerts').start(); } // Filtering / Roasting / Grinding "5 minutes to go" alerts (server side)
    catch (e) { console.error(`WARNING: process alert job not started: ${e.message}`); }
    try { require('./services/notificationService').startPhoneLink(); } // lets users connect their phone (Telegram) - only when TELEGRAM_BOT_TOKEN is set
    catch (e) { console.error(`WARNING: phone alerts not started: ${e.message}`); }
  });
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });