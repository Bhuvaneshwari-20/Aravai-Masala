// Creates material_units (the Unit dropdown list) if it is missing, and seeds a few common units.
// Runs at server start-up, safe to run any number of times.
module.exports = async function ensureMaterialUnits(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const [[{ n }]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'material_units'", [db]);
  if (Number(n)) return; // table already exists -> leave the data alone

  await pool.query(`
    CREATE TABLE material_units (
      id        INT          NOT NULL AUTO_INCREMENT,
      unit_name VARCHAR(20)  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_material_units_name (unit_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query("INSERT INTO material_units (unit_name) VALUES ('KG'), ('G'), ('L'), ('ML'), ('PCS')");
  log.log('Material units: created material_units with default units');
};