const { pool } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const label = (g) => (g >= 1000 ? `${Number((g / 1000).toFixed(3))} KG` : `${Number(g)} GM`);

async function list() {
  const [rows] = await pool.query(
    `SELECT g.id, g.weight_grams, g.is_active,
            (SELECT COUNT(*) FROM product_packing_rates p WHERE p.weight_grams = g.weight_grams) AS used_count
     FROM pack_sizes g ORDER BY g.weight_grams`);
  return rows.map((r) => ({ ...r, is_active: !!r.is_active, label: label(r.weight_grams) }));
}

async function create(body, userId, ip) {
  const weight = v.positive(body.weight_grams, 'Gram', { max: 1000000, decimals: 2 });
  const [dup] = await pool.query('SELECT id FROM pack_sizes WHERE weight_grams = ?', [weight]);
  if (dup.length) throw new AppError('This gram already exists', 409);
  const [r] = await pool.query('INSERT INTO pack_sizes (weight_grams) VALUES (?)', [weight]);
  const row = { id: r.insertId, weight_grams: weight, is_active: true, used_count: 0, label: label(weight) };
  await audit({ userId, action: 'CREATE', table: 'pack_sizes', recordId: r.insertId, newValues: row, ip });
  return row;
}

async function remove(idRaw, userId, ip) {
  const id = v.toId(idRaw, 'gram id');
  const [rows] = await pool.query('SELECT id, weight_grams FROM pack_sizes WHERE id = ?', [id]);
  if (!rows.length) throw new AppError('Gram not found', 404);
  const [[{ used }]] = await pool.query('SELECT COUNT(*) AS used FROM product_packing_rates WHERE weight_grams = ?', [rows[0].weight_grams]);
  if (used > 0) throw new AppError(`${label(rows[0].weight_grams)} is used by ${used} product(s) and cannot be deleted`, 409);
  await pool.query('DELETE FROM pack_sizes WHERE id = ?', [id]);
  await audit({ userId, action: 'DELETE', table: 'pack_sizes', recordId: id, oldValues: rows[0], ip });
  return { id };
}

module.exports = { list, create, remove, label };
