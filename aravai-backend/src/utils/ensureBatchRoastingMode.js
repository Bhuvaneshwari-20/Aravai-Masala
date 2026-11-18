// Material-wise Filtering -> Roasting workflow: makes sure batch_master has the roasting_mode column.
// Runs once at server start-up and is safe to run any number of times.
// Same SQL as migrations/2026_11_batch_roasting_mode.sql, so running that file by hand is not required.
//   roasting_mode  DIRECT          nothing is filtered, the batch goes straight to Roasting
//                  AFTER_FILTERING some materials are filtered: Roasting starts only after Filtering is completed
//                  PARALLEL        unfiltered materials roast now, filtered ones join Roasting after their Filtering
//                  NULL            old batches (they keep working exactly as before)
module.exports = async function ensureBatchRoastingMode(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const [[{ n }]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'batch_master' AND COLUMN_NAME = 'roasting_mode'", [db]);
  if (!Number(n)) {
    await pool.query('ALTER TABLE batch_master ADD COLUMN roasting_mode VARCHAR(20) NULL');
    log.log('Roasting mode: added batch_master.roasting_mode');
  }
};
