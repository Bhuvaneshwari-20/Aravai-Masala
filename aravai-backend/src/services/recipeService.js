const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const shape = (r) => ({ ...r, is_active: !!r.is_active });

async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'recipe id');
  const [rows] = await db.query(
    `SELECT r.*, p.product_code, p.product_name FROM recipe_master r JOIN product_master p ON p.id = r.product_id WHERE r.id = ?`, [id]);
  if (!rows.length) throw new AppError('Recipe not found', 404);
  const [ing] = await db.query(
    `SELECT d.id, d.material_id, m.material_code, m.material_name, m.unit, d.quantity_kg, d.percentage,
            m.current_stock, m.default_filter_stages
     FROM recipe_details d JOIN materials m ON m.id = d.material_id WHERE d.recipe_id = ? ORDER BY d.id`, [id]);
  return { ...shape(rows[0]), ingredients: ing };
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  if (q.product_id) { where.push('r.product_id = ?'); args.push(v.toId(q.product_id, 'product')); }
  if (q.active === 'true') where.push('r.is_active = 1');
  else if (q.active === 'false') where.push('r.is_active = 0');
  const search = v.clean(q.search);
  if (search) { where.push('(r.recipe_no LIKE ? OR p.product_name LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM recipe_master r JOIN product_master p ON p.id = r.product_id ${w}`, args);
  const [rows] = await pool.query(
    `SELECT r.*, p.product_code, p.product_name,
            (SELECT COUNT(*) FROM recipe_details d WHERE d.recipe_id = r.id) AS ingredient_count
     FROM recipe_master r JOIN product_master p ON p.id = r.product_id ${w}
     ORDER BY p.product_name, r.version_no DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows.map(shape), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

/*
 * A recipe is just the product + the list of materials used. No quantities are stored here any more
 * (quantities are weighed in Batching). Recipes are never edited in place (batches point at them):
 * a change = a new version; creating it switches the older versions of that product off.
 */
async function create(body, userId, ip) {
  const productId = v.toId(body.product_id, 'product');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);
  if (!Array.isArray(body.ingredients) || !body.ingredients.length) throw new AppError('Add at least one material');
  if (body.ingredients.length > 60) throw new AppError('Too many materials');

  // accepts [{ material_id }] (or plain ids)
  const ids = body.ingredients.map((i) => v.toId(i && typeof i === 'object' ? i.material_id : i, 'material'));
  if (new Set(ids).size !== ids.length) throw new AppError('A material is added twice in this recipe');

  return withTransaction(async (conn) => {
    const [prod] = await conn.query('SELECT id, is_active FROM product_master WHERE id = ? FOR UPDATE', [productId]);
    if (!prod.length) throw new AppError('Product not found', 404);
    if (!prod[0].is_active) throw new AppError('Product is inactive');

    const [mats] = await conn.query('SELECT id, material_name, unit, is_active FROM materials WHERE id IN (?)', [ids]);
    if (mats.length !== ids.length) throw new AppError('One or more materials do not exist');
    for (const m of mats) {
      if (!m.is_active) throw new AppError(`${m.material_name} is inactive`);
      if (m.unit !== 'KG') throw new AppError(`${m.material_name} is in ${m.unit}. Only KG materials can be used in a recipe`);
    }

    const [[{ maxV }]] = await conn.query('SELECT COALESCE(MAX(version_no), 0) AS maxV FROM recipe_master WHERE product_id = ?', [productId]);
    const no = await nextNumber(conn, 'RECIPE');
    await conn.query('UPDATE recipe_master SET is_active = 0 WHERE product_id = ?', [productId]);
    // base quantity / filtering stages / ingredient quantity are not used any more -> stored as 0
    const [r] = await conn.query(
      `INSERT INTO recipe_master (recipe_no, product_id, version_no, base_quantity_kg, default_filter_stages, remarks, created_by)
       VALUES (?,?,?,0,0,?,?)`, [no, productId, maxV + 1, remarks, userId]);
    await conn.query('INSERT INTO recipe_details (recipe_id, material_id, quantity_kg, percentage) VALUES ?',
      [ids.map((id) => [r.insertId, id, 0, 0])]);
    const created = await getById(r.insertId, conn);
    await audit({ userId, action: 'CREATE', table: 'recipe_master', recordId: r.insertId, newValues: created, ip }, conn);
    return created;
  });
}

// Switch a version on/off. Switching one on switches the other versions of the product off.
async function setStatus(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'recipe id');
  const active = v.toBool(body.is_active, 'is_active');
  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id, product_id, is_active FROM recipe_master WHERE id = ? FOR UPDATE', [id]);
    if (!cur.length) throw new AppError('Recipe not found', 404);
    if (active) await conn.query('UPDATE recipe_master SET is_active = 0 WHERE product_id = ? AND id <> ?', [cur[0].product_id, id]);
    await conn.query('UPDATE recipe_master SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'recipe_master', recordId: id,
      oldValues: { is_active: !!cur[0].is_active }, newValues: { is_active: active }, ip }, conn);
    return getById(id, conn);
  });
}

module.exports = { list, getById, create, setStatus };
