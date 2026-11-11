const { pool } = require('../config/db');
// Pass `conn` to log inside the caller's transaction.
async function audit({ userId, action, table, recordId, oldValues, newValues, ip }, conn = pool) {
  await conn.query(
    'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address) VALUES (?,?,?,?,?,?,?)',
    [userId || null, action, table, String(recordId ?? ''), oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, ip || null]
  );
}
module.exports = { audit };
