// Filtering / Roasting / Grinding material cards: makes sure the database objects they need exist.
// Runs once at server start-up and is safe to run any number of times (it only adds what is missing):
//   batch_master.process_mode        SEQUENTIAL | SIMULTANEOUS   (chosen per batch in the New Batch popup)
//   process_sessions                 one row per material per process (Filtering / Roasting / Grinding)
//   filtering_materials.start_time / end_time
// Duplicate processing is blocked by the database itself:
//   uq_ps_material : one live (not cancelled) session per batch + material + process
//   uq_ps_machine  : one RUNNING session per machine
module.exports = async function ensureProcessWorkflow(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const hasCol = async (table, col) => {
    const [[{ n }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [db, table, col]);
    return Number(n) > 0;
  };
  const hasTable = async (table) => {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [db, table]);
    return Number(n) > 0;
  };

  if (!(await hasCol('batch_master', 'process_mode'))) {
    await pool.query('ALTER TABLE batch_master ADD COLUMN process_mode VARCHAR(20) NULL');
    log.log('Process workflow: added batch_master.process_mode');
  }

  if (!(await hasTable('process_sessions'))) {
    await pool.query(`
      CREATE TABLE process_sessions (
        id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        batch_id          INT UNSIGNED NOT NULL,
        material_id       INT UNSIGNED NOT NULL,
        process_type      ENUM('FILTERING','ROASTING','GRINDING') NOT NULL,
        machine_id        INT UNSIGNED NOT NULL,
        input_weight      DECIMAL(12,3) NOT NULL,
        output_weight     DECIMAL(12,3) DEFAULT NULL,
        start_time        DATETIME NOT NULL,
        expected_minutes  INT UNSIGNED NOT NULL,
        expected_end      DATETIME NOT NULL,
        actual_end        DATETIME DEFAULT NULL,
        actual_minutes    DECIMAL(8,2) DEFAULT NULL,
        status            ENUM('RUNNING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'RUNNING',
        alert_sent        TINYINT(1) NOT NULL DEFAULT 0,
        alert_sent_at     DATETIME DEFAULT NULL,
        proceeded_at      DATETIME DEFAULT NULL,
        proceeded_by      INT UNSIGNED DEFAULT NULL,
        remarks           VARCHAR(255) DEFAULT NULL,
        started_by        INT UNSIGNED NOT NULL,
        completed_by      INT UNSIGNED DEFAULT NULL,
        created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        live_key          TINYINT AS (IF(status = 'CANCELLED', NULL, 1)) STORED,
        run_key           TINYINT AS (IF(status = 'RUNNING', 1, NULL)) STORED,
        UNIQUE KEY uq_ps_material (batch_id, material_id, process_type, live_key),
        UNIQUE KEY uq_ps_machine (machine_id, run_key),
        KEY idx_ps_batch (batch_id, process_type, status),
        CONSTRAINT process_sessions_fk_batch    FOREIGN KEY (batch_id)    REFERENCES batch_master (id),
        CONSTRAINT process_sessions_fk_material FOREIGN KEY (material_id) REFERENCES materials (id),
        CONSTRAINT process_sessions_fk_machine  FOREIGN KEY (machine_id)  REFERENCES machine_master (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    log.log('Process workflow: created process_sessions');
  }

  if (await hasTable('filtering_materials')) {
    for (const col of ['start_time', 'end_time']) {
      if (!(await hasCol('filtering_materials', col))) {
        await pool.query(`ALTER TABLE filtering_materials ADD COLUMN ${col} DATETIME NULL`);
        log.log(`Process workflow: added filtering_materials.${col}`);
      }
    }
  }
};