// Saved roasting pairs + Sequential / Simultaneous mode. Runs once at server start-up, safe to run any number of times.
// It only ADDS: no data is deleted, reset or rewritten.
//   batching_details.roast_partner_of  INT UNSIGNED NULL
//        NULL = old batch / no Roasting option (old behaviour) | 0 = "Roasting with Partner" material left unpaired | >0 = partner's material_id
//   batch_master.process_mode          must accept SIMULTANEOUS (widened only if it is an ENUM / short VARCHAR that does not)
module.exports = async function ensureRoastPartner(pool, log = console) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const [cols] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND ((TABLE_NAME = 'batching_details' AND COLUMN_NAME = 'roast_partner_of') OR (TABLE_NAME = 'batch_master' AND COLUMN_NAME = 'process_mode'))`, [db]);
  const col = (t, c) => cols.find((x) => x.TABLE_NAME === t && x.COLUMN_NAME === c);

  if (!col('batching_details', 'roast_partner_of')) {
    await pool.query('ALTER TABLE batching_details ADD COLUMN roast_partner_of INT UNSIGNED NULL AFTER process_type');
    log.log('Roasting partners: added batching_details.roast_partner_of');
  }

  const pm = col('batch_master', 'process_mode');
  if (!pm) return;
  const type = String(pm.COLUMN_TYPE || '');
  const nullable = pm.IS_NULLABLE === 'YES';
  let def = pm.COLUMN_DEFAULT;                                   // MariaDB returns it quoted ('SEQUENTIAL') or the text NULL
  if (def !== null && def !== undefined) def = String(def).replace(/^'(.*)'$/, '$1');
  const defSql = def === null || def === undefined || (nullable && String(def).toUpperCase() === 'NULL') ? (nullable ? 'DEFAULT NULL' : '') : `DEFAULT '${String(def).replace(/'/g, "''")}'`;
  const nullSql = nullable ? 'NULL' : 'NOT NULL';

  const en = /^enum\((.*)\)$/i.exec(type);
  if (en) {
    const vals = en[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '').replace(/''/g, "'"));
    if (!vals.includes('SEQUENTIAL') || !vals.includes('SIMULTANEOUS')) {
      const next = [...new Set([...vals, 'SEQUENTIAL', 'SIMULTANEOUS'])];   // existing values keep their order, so stored data is untouched
      await pool.query(`ALTER TABLE batch_master MODIFY COLUMN process_mode ENUM(${next.map((x) => `'${x.replace(/'/g, "''")}'`).join(',')}) ${nullSql} ${defSql}`);
      log.log('Process mode: batch_master.process_mode now accepts SEQUENTIAL and SIMULTANEOUS');
    }
    return;
  }
  const vc = /^varchar\((\d+)\)/i.exec(type);
  if (vc && Number(vc[1]) < 12) {
    await pool.query(`ALTER TABLE batch_master MODIFY COLUMN process_mode VARCHAR(20) ${nullSql} ${defSql}`);
    log.log('Process mode: batch_master.process_mode widened to VARCHAR(20)');
  }
};