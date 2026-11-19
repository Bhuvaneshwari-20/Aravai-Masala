// Creates the material_units table (the list shown in Add Material > Unit) if it is missing.
// Runs at server start-up and is safe to run any number of times.
//  - no fixed units are added; the list is only what you add with "Add unit"
//  - adds any unit already used by an existing material (so old materials keep working)
//  - if materials.unit is an ENUM, changes it to VARCHAR(30) so new units can be saved
module.exports = async function ensureMaterialUnits(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_units (
      id         INT         NOT NULL AUTO_INCREMENT,
      unit_name  VARCHAR(30) NOT NULL,
      created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_material_units_name (unit_name)
    ) ENGINE=InnoDB`);

  const [col] = await pool.query(
    "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'unit'", [db]);
  if (col.length && String(col[0].DATA_TYPE).toLowerCase() === 'enum') {
    await pool.query('ALTER TABLE materials MODIFY unit VARCHAR(30) NOT NULL');
    log.log('Material units: materials.unit changed from ENUM to VARCHAR(30)');
  }

  // Material code may be the same for two materials, so drop any UNIQUE index that is only on sku or material_code.
  const [idx] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'materials' AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
     GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME IN ('sku', 'material_code')) = 1`, [db]);
  for (const { INDEX_NAME } of idx) {
    if (!/^[A-Za-z0-9_]+$/.test(INDEX_NAME)) continue;
    try { await pool.query(`ALTER TABLE materials DROP INDEX \`${INDEX_NAME}\``); log.log(`Material code: removed unique index ${INDEX_NAME} on materials`); }
    catch (e) { log.warn(`Material code: could not remove unique index ${INDEX_NAME} (${e.message})`); }
  }

  // One-time style sync (safe to repeat): materials made with the Add Material form (MAT-xxxx) that have a typed code now show that code.
  try {
    await pool.query("UPDATE materials SET material_code = sku WHERE sku IS NOT NULL AND TRIM(sku) <> '' AND material_code LIKE 'MAT-%' AND material_code <> sku");
  } catch (e) { log.warn(`Material code: could not copy typed codes (${e.message})`); }

  await pool.query(
    "INSERT IGNORE INTO material_units (unit_name) SELECT DISTINCT UPPER(TRIM(unit)) FROM materials WHERE unit IS NOT NULL AND TRIM(unit) <> ''");
};