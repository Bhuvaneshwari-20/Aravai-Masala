const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const shape = (r) => ({ ...r, is_active: !!r.is_active });

async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'recipe id');
  const [rows] = await db.query(
    `SELECT r.*, p.product_code, p.product_name, u.full_name AS created_by_name
     FROM recipe_master r JOIN product_master p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?`, [id]);
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
    `SELECT r.*, p.product_code, p.product_name, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM recipe_details d WHERE d.recipe_id = r.id) AS ingredient_count
     FROM recipe_master r JOIN product_master p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.created_by ${w}
     ORDER BY p.product_name, r.version_no DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows.map(shape), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

/*
 * Recipe versions
 * A recipe is the product + the list of materials used. A recipe row is NEVER edited after it is saved.
 * Every change (material added / removed / quantity changed) saves a NEW row in recipe_master with
 * version_no + 1 and a full copy of the materials; the older rows stay exactly as they were, switched off.
 * Batches keep the recipe_id they were created with, so an old batch always shows its own recipe version.
 * Who changed it and when = created_by / created_at of that version row. What changed is also written to `remarks`.
 */
const SCHEMA_QTY = { max: 999999999, decimals: 3 };

// RCP-2026-0001 -> RCP-2026-0001-V2, -V3 ... (recipe_no is unique, the first version keeps the plain number)
const rootNo = (no) => String(no).replace(/-V\d+$/, '');

function diffIngredients(before, after) {
  const b = new Map(before.map((i) => [i.material_id, i]));
  const a = new Map(after.map((i) => [i.material_id, i]));
  const added = []; const removed = []; const qty = [];
  a.forEach((i, id) => {
    const o = b.get(id);
    if (!o) added.push(i.material_name);
    else if (Number(o.quantity_kg || 0) !== Number(i.quantity_kg || 0)) qty.push(`${i.material_name} ${Number(o.quantity_kg || 0)} -> ${Number(i.quantity_kg || 0)} kg`);
  });
  b.forEach((i, id) => { if (!a.has(id)) removed.push(i.material_name); });
  return { added, removed, qty };
}

const summary = (d) => {
  const parts = [];
  if (d.added.length) parts.push(`Added: ${d.added.join(', ')}`);
  if (d.removed.length) parts.push(`Removed: ${d.removed.join(', ')}`);
  if (d.qty.length) parts.push(`Qty: ${d.qty.join(', ')}`);
  const t = parts.join(' | ');
  return t.length > 255 ? `${t.slice(0, 252)}...` : t;
};

// Saves `ingredients` ([{ material_id, quantity_kg, percentage }]) as the next version of the product.
// `base` = the version it is made from (full recipe from getById). Runs inside the caller's transaction.
async function saveNewVersion(conn, base, ingredients, userId, ip, extraRemark) {
  const productId = base.product_id;
  const [[{ maxV }]] = await conn.query('SELECT COALESCE(MAX(version_no), 0) AS maxV FROM recipe_master WHERE product_id = ?', [productId]);
  const [[first]] = await conn.query('SELECT recipe_no FROM recipe_master WHERE product_id = ? ORDER BY version_no ASC, id ASC LIMIT 1', [productId]);
  const versionNo = maxV + 1;
  const recipeNo = `${rootNo(first.recipe_no)}-V${versionNo}`;

  const [mats] = await conn.query('SELECT id, material_name FROM materials WHERE id IN (?)', [ingredients.map((i) => i.material_id)]);
  const nameOf = new Map(mats.map((m) => [m.id, m.material_name]));
  const after = ingredients.map((i) => ({ ...i, material_name: nameOf.get(i.material_id) }));
  const d = diffIngredients(base.ingredients, after);
  const remarks = [summary(d), extraRemark].filter(Boolean).join(' | ').slice(0, 255) || null;

  await conn.query('UPDATE recipe_master SET is_active = 0 WHERE product_id = ?', [productId]);
  const [r] = await conn.query(
    `INSERT INTO recipe_master (recipe_no, product_id, version_no, base_quantity_kg, default_filter_stages, is_active, remarks, created_by)
     VALUES (?,?,?,?,?,1,?,?)`, [recipeNo, productId, versionNo, base.base_quantity_kg || 0, base.default_filter_stages || 0, remarks, userId]);
  await conn.query('INSERT INTO recipe_details (recipe_id, material_id, quantity_kg, percentage) VALUES ?',
    [ingredients.map((i) => [r.insertId, i.material_id, i.quantity_kg || 0, i.percentage || 0])]);
  const created = await getById(r.insertId, conn);
  await audit({ userId, action: 'CREATE', table: 'recipe_master', recordId: r.insertId, oldValues: base, newValues: { ...created, changes: d }, ip }, conn);
  return created;
}

async function checkMaterials(conn, ids) {
  if (!ids.length) return;
  const [mats] = await conn.query('SELECT id, material_name, unit, is_active FROM materials WHERE id IN (?)', [ids]);
  if (mats.length !== ids.length) throw new AppError('One or more materials do not exist');
  for (const m of mats) {
    if (!m.is_active) throw new AppError(`${m.material_name} is inactive`);
    if (m.unit !== 'KG') throw new AppError(`${m.material_name} is in ${m.unit}. Only KG materials can be used in a recipe`);
  }
}

// Product has no recipe yet -> version 1.   Product already has a recipe -> the new materials are added in a NEW version
// (existing materials and quantities are copied, nothing is removed, the old version is kept).
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

    const [existing] = await conn.query(
      'SELECT id FROM recipe_master WHERE product_id = ? ORDER BY is_active DESC, version_no DESC LIMIT 1 FOR UPDATE', [productId]);

    if (existing.length) {
      const before = await getById(existing[0].id, conn);
      const have = new Set(before.ingredients.map((i) => i.material_id));
      const fresh = ids.filter((id) => !have.has(id));
      if (!fresh.length) throw new AppError('These materials are already in this product\'s recipe', 409);
      await checkMaterials(conn, fresh);
      const next = [...before.ingredients.map((i) => ({ material_id: i.material_id, quantity_kg: i.quantity_kg, percentage: i.percentage })),
        ...fresh.map((id) => ({ material_id: id, quantity_kg: 0, percentage: 0 }))];
      return saveNewVersion(conn, before, next, userId, ip, remarks);
    }

    await checkMaterials(conn, ids);
    const no = await nextNumber(conn, 'RECIPE');
    // base quantity / filtering stages / ingredient quantity are not used any more -> stored as 0
    const [r] = await conn.query(
      `INSERT INTO recipe_master (recipe_no, product_id, version_no, base_quantity_kg, default_filter_stages, remarks, created_by)
       VALUES (?,?,1,0,0,?,?)`, [no, productId, remarks, userId]);
    await conn.query('INSERT INTO recipe_details (recipe_id, material_id, quantity_kg, percentage) VALUES ?',
      [ids.map((id) => [r.insertId, id, 0, 0])]);
    const created = await getById(r.insertId, conn);
    await audit({ userId, action: 'CREATE', table: 'recipe_master', recordId: r.insertId, newValues: created, ip }, conn);
    return created;
  });
}

// Change the materials / quantities of a recipe. Body: { ingredients: [{ material_id, quantity_kg? }], remarks? } = the FULL new list.
// Only the latest version can be changed; the result is always a new version.
async function update(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'recipe id');
  const remarks = v.optStr(body.remarks, 'Remarks', 255);
  if (!Array.isArray(body.ingredients) || !body.ingredients.length) throw new AppError('A recipe needs at least one material');
  if (body.ingredients.length > 60) throw new AppError('Too many materials');
  const ids = body.ingredients.map((i) => v.toId(i && typeof i === 'object' ? i.material_id : i, 'material'));
  if (new Set(ids).size !== ids.length) throw new AppError('A material is added twice in this recipe');

  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id, product_id, version_no FROM recipe_master WHERE id = ?', [id]);
    if (!cur.length) throw new AppError('Recipe not found', 404);
    await conn.query('SELECT id FROM product_master WHERE id = ? FOR UPDATE', [cur[0].product_id]);
    const [[{ maxV }]] = await conn.query('SELECT MAX(version_no) AS maxV FROM recipe_master WHERE product_id = ?', [cur[0].product_id]);
    if (cur[0].version_no !== maxV) throw new AppError('Only the latest recipe version can be changed. Reload and try again.', 409);

    const before = await getById(id, conn);
    const old = new Map(before.ingredients.map((i) => [i.material_id, i]));
    await checkMaterials(conn, ids.filter((m) => !old.has(m)));
    const next = body.ingredients.map((i, n) => {
      const o = old.get(ids[n]);
      const q = i && typeof i === 'object' && i.quantity_kg !== undefined && i.quantity_kg !== '' ? v.num(i.quantity_kg, 'Quantity', SCHEMA_QTY) : (o ? o.quantity_kg : 0);
      return { material_id: ids[n], quantity_kg: q, percentage: o ? o.percentage : 0 };
    });
    const d = diffIngredients(before.ingredients, next.map((i) => ({ ...i, material_name: '' })));
    if (!d.added.length && !d.removed.length && !d.qty.length) throw new AppError('No changes to save', 409);
    return saveNewVersion(conn, before, next, userId, ip, remarks);
  });
}

// ---- used by New Batch (+ Add Material): needs batching permission only, not recipe permission ----
// KG materials that are active and not yet in the product's current recipe.
async function addableMaterials(q) {
  const productId = v.toId(q.product_id, 'product');
  const [rows] = await pool.query(
    `SELECT m.id, m.material_code, m.material_name, m.unit FROM materials m
     WHERE m.is_active = 1 AND m.unit = 'KG'
       AND m.id NOT IN (SELECT d.material_id FROM recipe_details d JOIN recipe_master r ON r.id = d.recipe_id
                        WHERE r.product_id = ? AND r.is_active = 1)
     ORDER BY m.material_name`, [productId]);
  return rows;
}

// Add ONE existing material to the product's recipe (saved as a new recipe version). The product must already have a recipe.
async function addMaterial(body, userId, ip) {
  const productId = v.toId(body.product_id, 'product');
  const materialId = v.toId(body.material_id, 'material');
  const [r] = await pool.query('SELECT id FROM recipe_master WHERE product_id = ? LIMIT 1', [productId]);
  if (!r.length) throw new AppError('This product has no recipe. Ask an admin to create the recipe first.');
  return create({ product_id: productId, ingredients: [{ material_id: materialId }] }, userId, ip);
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

module.exports = { list, getById, create, update, setStatus, addableMaterials, addMaterial };