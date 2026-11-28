// Roasting groups of a batch (one row per physical roasting operation). Runs at start-up, safe to run any number of times. It only ADDS tables.
//   batch_roast_groups         one PAIRED or INDIVIDUAL roasting group of a batch (status, machine, session reference, timestamps)
//   batch_roast_group_members  the materials of a group. UNIQUE (batch_id, material_id) = a material is in only ONE group per batch
// Old batches have no rows here and keep using the legacy behaviour (batching_details.roast_partner_of NULL).
module.exports = async function ensureRoastGroups(pool, log = console) {
  await pool.query(`CREATE TABLE IF NOT EXISTS batch_roast_groups (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id         INT UNSIGNED NOT NULL,
    group_type       ENUM('PAIRED','INDIVIDUAL') NOT NULL,
    status           ENUM('PLANNED','RUNNING','COMPLETED') NOT NULL DEFAULT 'PLANNED',
    machine_id       INT UNSIGNED NULL,
    session_group_id INT UNSIGNED NULL,
    started_at       DATETIME NULL,
    completed_at     DATETIME NULL,
    created_by       INT UNSIGNED NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_brg_batch (batch_id)
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS batch_roast_group_members (
    group_id    INT UNSIGNED NOT NULL,
    batch_id    INT UNSIGNED NOT NULL,
    material_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (group_id, material_id),
    UNIQUE KEY uq_brgm_batch_material (batch_id, material_id),
    CONSTRAINT fk_brgm_group FOREIGN KEY (group_id) REFERENCES batch_roast_groups(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  log.log('Roasting groups: batch_roast_groups / batch_roast_group_members ready');
};