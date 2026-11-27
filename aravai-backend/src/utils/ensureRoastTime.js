// Roasting time per material: adds materials.roast_seconds (set in Material Master) and
// batching_details.roast_seconds (the time used for that material in a batch). Safe to run any number of times.
async function addCol(pool, table, col, ddl, log) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [db, table, col]);
  if (!Number(n)) { await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); log.log(`Roast time: added ${table}.${col}`); }
}
module.exports = async function ensureRoastTime(pool, log = console) {
  await addCol(pool, 'materials', 'roast_seconds', 'INT NULL', log);
    await addCol(pool, 'batching_details', 'roast_seconds', 'INT NULL', log);
  await addCol(pool, 'materials', 'filter_seconds', 'INT NULL', log);   // Filtering time set in Material Master
  await addCol(pool, 'materials', 'grind_seconds', 'INT NULL', log);    // Grinding time set in Material Master
    await addCol(pool, 'materials', 'blending_seconds', 'INT NULL', log);            // Blending time set in Material Master
  await addCol(pool, 'blending_sessions', 'configured_seconds', 'INT NULL', log);   // snapshot of Material Master at Start
  await addCol(pool, 'blending_sessions', 'selected_seconds', 'INT NULL', log);     // what the worker chose at Start
  await addCol(pool, 'blending_sessions', 'duration_reason', 'VARCHAR(255) NULL', log);
  await addCol(pool, 'blending_sessions', 'actual_seconds', 'INT NULL', log);       // used in B2
  await addCol(pool, 'blending_sessions', 'duration_diff_seconds', 'INT NULL', log); // used in B2
};
