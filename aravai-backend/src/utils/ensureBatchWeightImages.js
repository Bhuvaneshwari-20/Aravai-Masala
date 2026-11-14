// Creates batch_weight_images if it is missing. Runs at server start-up, safe to run any number of times.
// Same table as migrations/2026_11_batch_weight_images.sql, with id column types copied from the tables it points to.
module.exports = async function ensureBatchWeightImages(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'batch_weight_images'", [db]);
  if (Number(n)) { // table made by an earlier version: batch_id must allow NULL (New Batch photos exist before the batch)
    const [c] = await pool.query("SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'batch_weight_images' AND COLUMN_NAME = 'batch_id'", [db]);
    if (c.length && c[0].IS_NULLABLE === 'NO') {
      await pool.query(`ALTER TABLE batch_weight_images MODIFY batch_id ${c[0].COLUMN_TYPE} NULL`);
      log.log('Batch weight images: batch_id now allows NULL');
    }
    return;
  }

  const idType = async (table) => {
    const [t] = await pool.query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'id'", [db, table]);
    return /^[a-z]+(\(\d+\))?( unsigned)?$/i.test(t[0]?.COLUMN_TYPE || '') ? t[0].COLUMN_TYPE : 'INT';
  };
  const [batchT, matT, userT, detT] = await Promise.all(['batch_master', 'materials', 'users', 'batching_details'].map(idType));

  await pool.query(`
    CREATE TABLE batch_weight_images (
      id                 BIGINT        NOT NULL AUTO_INCREMENT,
      batch_id           ${batchT}     NULL,
      material_id        ${matT}       NOT NULL,
      batching_detail_id ${detT}       NULL,
      uploaded_by        ${userT}      NOT NULL,
      entered_weight     DECIMAL(12,3) NOT NULL,
      detected_weight    DECIMAL(12,3) NULL,
      difference         DECIMAL(12,3) NULL,
      tolerance          DECIMAL(10,3) NULL,
      status             ENUM('MATCH','MISMATCH','UNREADABLE','MANUAL') NOT NULL,
      detected_text      VARCHAR(255)  NULL,
      ocr_confidence     DECIMAL(5,2)  NULL,
      ocr_engine         VARCHAR(40)   NULL,
      image_path         VARCHAR(255)  NOT NULL,
      image_mime         VARCHAR(40)   NOT NULL DEFAULT 'image/jpeg',
      image_size_bytes   INT           NULL,
      image_sha256       CHAR(64)      NULL,
      manual_reason      VARCHAR(255)  NULL,
      verified_by        ${userT}      NULL,
      verified_at        DATETIME      NULL,
      created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_bwi_batch_material (batch_id, material_id),
      KEY idx_bwi_detail (batching_detail_id),
      KEY idx_bwi_sha (image_sha256)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  log.log('Batch weight images: created table batch_weight_images');

  const fks = [['fk_bwi_batch', 'batch_id', 'batch_master'], ['fk_bwi_material', 'material_id', 'materials'], ['fk_bwi_uploader', 'uploaded_by', 'users'],
    ['fk_bwi_detail', 'batching_detail_id', 'batching_details'], ['fk_bwi_verifier', 'verified_by', 'users']];
  for (const [name, col, ref] of fks) {
    try { await pool.query(`ALTER TABLE batch_weight_images ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES ${ref} (id)`); }
    catch (e) { log.warn(`Batch weight images: foreign key ${name} not added (${e.message}). The feature still works without it.`); }
  }
};
