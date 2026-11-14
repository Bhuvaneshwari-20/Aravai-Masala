const { pool } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

async function list() {
  const [rows] = await pool.query(
    `SELECT m.id, m.mesh_size,
            (SELECT COUNT(*) FROM grinding_details g WHERE g.mesh_size = m.mesh_size) AS used_count
     FROM mesh_master m ORDER BY CAST(m.mesh_size AS DECIMAL(10,2))`);
  return rows;
}

async function create(body, userId, ip) {
  const size = String(v.positive(body.mesh_size, 'Mesh size', { max: 100000, decimals: 2 }));
  const [dup] = await pool.query('SELECT id FROM mesh_master WHERE mesh_size = ?', [size]);
  if (dup.length) throw new AppError('This mesh size already exists', 409);
  const [r] = await pool.query('INSERT INTO mesh_master (mesh_size) VALUES (?)', [size]);
  const row = { id: r.insertId, mesh_size: size, used_count: 0 };
  await audit({ userId, action: 'CREATE', table: 'mesh_master', recordId: r.insertId, newValues: row, ip });
  return row;
}

async function remove(idRaw, userId, ip) {
  const id = v.toId(idRaw, 'mesh id');
  const [rows] = await pool.query('SELECT id, mesh_size FROM mesh_master WHERE id = ?', [id]);
  if (!rows.length) throw new AppError('Mesh size not found', 404);
  const [[{ used }]] = await pool.query('SELECT COUNT(*) AS used FROM grinding_details WHERE mesh_size = ?', [rows[0].mesh_size]);
  if (used > 0) throw new AppError(`Mesh ${rows[0].mesh_size} is used in ${used} grinding entr${used > 1 ? 'ies' : 'y'} and cannot be deleted`, 409);
  await pool.query('DELETE FROM mesh_master WHERE id = ?', [id]);
  await audit({ userId, action: 'DELETE', table: 'mesh_master', recordId: id, oldValues: rows[0], ip });
  return { id };
}

module.exports = { list, create, remove };