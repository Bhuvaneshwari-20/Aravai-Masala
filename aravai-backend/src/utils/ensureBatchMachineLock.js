// Batch-wise weighing machine lock: makes sure batch_master has the two columns the lock needs.
// Runs once at server start-up and is safe to run any number of times (every step first checks what already exists).
// Same SQL as migrations/2026_11_batch_machine_lock.sql, so running that file by hand is no longer required.
//   weighing_machine_id  the machine chosen in New Batch (kept forever, also after the batch is completed)
//   machine_locked_at    when the first weight was recorded = when the machine was locked to the batch
module.exports = async function ensureBatchMachineLock(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const count = async (sql, args) => Number((await pool.query(sql, args))[0][0].n);
  const hasCol = (c) => count(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'batch_master' AND COLUMN_NAME = ?", [db, c]);

  let addedMachineCol = false;
  if (!(await hasCol('weighing_machine_id'))) {
    // same type as machine_master.id (INT / BIGINT / UNSIGNED ...), otherwise the foreign key would be rejected
    const [t] = await pool.query(
      "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'machine_master' AND COLUMN_NAME = 'id'", [db]);
    const type = /^[a-z]+(\(\d+\))?( unsigned)?$/i.test(t[0]?.COLUMN_TYPE || '') ? t[0].COLUMN_TYPE : 'INT';
    await pool.query(`ALTER TABLE batch_master ADD COLUMN weighing_machine_id ${type} NULL`);
    addedMachineCol = true;
    log.log('Batch machine lock: added batch_master.weighing_machine_id');
  }
  if (!(await hasCol('machine_locked_at'))) {
    await pool.query('ALTER TABLE batch_master ADD COLUMN machine_locked_at DATETIME NULL');
    log.log('Batch machine lock: added batch_master.machine_locked_at');
  }

  if (!(await count("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'batch_master' AND INDEX_NAME = 'idx_batch_weighing_machine'", [db]))) {
    await pool.query('CREATE INDEX idx_batch_weighing_machine ON batch_master (weighing_machine_id, status)');
  }
  if (!(await count("SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'batch_master' AND CONSTRAINT_NAME = 'fk_batch_weighing_machine'", [db]))) {
    try { await pool.query('ALTER TABLE batch_master ADD CONSTRAINT fk_batch_weighing_machine FOREIGN KEY (weighing_machine_id) REFERENCES machine_master (id)'); }
    catch (e) { log.warn(`Batch machine lock: foreign key not added (${e.message}). The lock still works without it.`); }
  }

  // Only on the first run: old batches take the machine already stored on their first batching row (history; no machine = no lock).
  if (addedMachineCol) {
    const [r] = await pool.query(
      `UPDATE batch_master b
       JOIN (SELECT batch_id, SUBSTRING_INDEX(GROUP_CONCAT(weighing_machine_id ORDER BY id), ',', 1) AS mid
             FROM batching_details WHERE weighing_machine_id IS NOT NULL GROUP BY batch_id) x ON x.batch_id = b.id
       SET b.weighing_machine_id = x.mid, b.machine_locked_at = COALESCE(b.batching_completed_at, NOW())
       WHERE b.weighing_machine_id IS NULL`);
    log.log(`Batch machine lock: ${r.affectedRows || 0} existing batch(es) linked to their machine`);
  }
};
