// Per-material processing configuration + combined roasting. Runs once at server start-up, safe to run any number of times.
//   recipe_details.process_type    FILTER_ONLY | FILTER_ROAST | ROAST_ONLY   (chosen in Recipe Management; old rows: needs_filtering 1 -> FILTER_ROAST, 0 -> ROAST_ONLY)
//   batching_details.process_type  copy of the recipe setting taken when the batch is created (NULL on old batches = worked out from needs_filtering)
//   process_sessions.group_id      materials roasted TOGETHER on one machine share the id of the first (lead) session
//   process_sessions.group_lead    1 = the row that holds the machine, 0 = the other materials of the group
//                                  (uq_ps_machine is rebuilt so that only lead rows count: one RUNNING group per machine, as before)
//   recipe_details.roast_type      ROAST_ONLY | ROAST_PARTNER | NULL   (Roasting option, chosen in Recipe Management, independent of Filtering)
// needs_filtering is kept (= process_type <> ROAST_ONLY) so every existing query keeps working.
module.exports = async function ensureRecipeProcessType(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const hasCol = async (table, col) => {
    const [[{ n }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [db, table, col]);
    return Number(n) > 0;
  };

  if (!(await hasCol('recipe_details', 'process_type'))) {
    await pool.query("ALTER TABLE recipe_details ADD COLUMN process_type ENUM('FILTER_ONLY','FILTER_ROAST','ROAST_ONLY') NOT NULL DEFAULT 'ROAST_ONLY' AFTER needs_filtering");
    await pool.query("UPDATE recipe_details SET process_type = IF(needs_filtering = 1, 'FILTER_ROAST', 'ROAST_ONLY')");
    log.log('Recipe processing: added recipe_details.process_type');
  }
  // Roasting option of a recipe material (independent of Filtering): ROAST_ONLY = Only Roasting, ROAST_PARTNER = Roasting with Partner,
  // NULL = old rows / Filtering Only (they keep the old behaviour: the operator may roast alone or combine, as before).
  if (!(await hasCol('recipe_details', 'roast_type'))) {
    await pool.query("ALTER TABLE recipe_details ADD COLUMN roast_type VARCHAR(20) NULL AFTER process_type");
    log.log('Recipe roasting: added recipe_details.roast_type');
  }
  if (!(await hasCol('batching_details', 'process_type'))) {
    await pool.query('ALTER TABLE batching_details ADD COLUMN process_type VARCHAR(20) NULL AFTER needs_filtering');
    await pool.query("UPDATE batching_details SET process_type = IF(needs_filtering = 1, 'FILTER_ROAST', 'ROAST_ONLY')");
    log.log('Recipe processing: added batching_details.process_type');
  }
  if (!(await hasCol('process_sessions', 'group_lead'))) {
    await pool.query('ALTER TABLE process_sessions ADD COLUMN group_id INT UNSIGNED NULL, ADD COLUMN group_lead TINYINT NOT NULL DEFAULT 1, ADD KEY idx_ps_group (group_id)');
    await pool.query('ALTER TABLE process_sessions DROP INDEX uq_ps_machine, DROP COLUMN run_key');
    await pool.query("ALTER TABLE process_sessions ADD COLUMN run_key TINYINT AS (IF(status = 'RUNNING' AND group_lead = 1, 1, NULL)) STORED, ADD UNIQUE KEY uq_ps_machine (machine_id, run_key)");
    log.log('Combined roasting: added process_sessions.group_id / group_lead');
  }
};