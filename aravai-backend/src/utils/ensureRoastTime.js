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
    await addCol(pool, 'materials', 'blending_seconds', 'INT NULL', log);   
      await addCol(pool, 'batching_details', 'process_type', 'VARCHAR(20) NULL', log);   // Filtering Only / Filtering + Roasting / Roasting Only of each batch material
    // Blending time set in Material Master
  await addCol(pool, 'blending_sessions', 'configured_seconds', 'INT NULL', log);   // snapshot of Material Master at Start
  await addCol(pool, 'blending_sessions', 'selected_seconds', 'INT NULL', log);     // what the worker chose at Start
  await addCol(pool, 'blending_sessions', 'duration_reason', 'VARCHAR(255) NULL', log);
  await addCol(pool, 'blending_sessions', 'actual_seconds', 'INT NULL', log);       // used in B2
  await addCol(pool, 'blending_sessions', 'duration_diff_seconds', 'INT NULL', log); // used in B2


    for (const t of ['process_sessions', 'blending_sessions']) {
    await addCol(pool, t, 'configured_seconds', 'INT NULL', log);
    await addCol(pool, t, 'manual_seconds', 'INT NULL', log);
    await addCol(pool, t, 'effective_seconds', 'INT NULL', log);
    await addCol(pool, t, 'duration_change_reason', 'VARCHAR(255) NULL', log);
    await addCol(pool, t, 'actual_seconds', 'INT NULL', log);
  }
  // old rows: fill what is known (configured stays NULL = it was not saved back then)
  await pool.query("UPDATE process_sessions SET effective_seconds = TIMESTAMPDIFF(SECOND, start_time, expected_end) WHERE effective_seconds IS NULL");
  await pool.query("UPDATE process_sessions SET actual_seconds = ROUND(actual_minutes * 60) WHERE actual_seconds IS NULL AND actual_minutes IS NOT NULL");
  await pool.query(`UPDATE blending_sessions SET effective_seconds = COALESCE(selected_seconds, expected_minutes * 60),
      manual_seconds = IF(selected_seconds IS NOT NULL AND configured_seconds IS NOT NULL AND selected_seconds <> configured_seconds, selected_seconds, NULL),
      duration_change_reason = COALESCE(duration_change_reason, duration_reason) WHERE effective_seconds IS NULL`);
  await pool.query("UPDATE blending_sessions SET actual_seconds = ROUND(actual_minutes * 60) WHERE actual_seconds IS NULL AND actual_minutes IS NOT NULL");
};
