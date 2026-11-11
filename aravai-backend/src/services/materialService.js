const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const UNITS = ['KG', 'GRAM', 'NOS', 'LITRE', 'BAGS'];

const BASE_SELECT = `
  SELECT m.*, c.category_name, (m.current_stock <= m.minimum_stock) AS is_low_stock
  FROM materials m JOIN material_categories c ON c.id = m.category_id`;

const shape = (r) => ({ ...r, is_active: !!r.is_active, is_low_stock: !!r.is_low_stock });

/* ---------- specifications (one material -> many specs) ---------- */
const MAX_SPECS = 50;

// undefined -> not sent (leave existing specs alone). Otherwise a clean, de-duplicated list of strings.
function cleanSpecs(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError('Specifications must be a list');
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const s = v.optStr(item, 'Specification', 255);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  if (out.length > MAX_SPECS) throw new AppError(`A material can have at most ${MAX_SPECS} specifications`);
  return out;
}

async function loadSpecs(db, ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const [rows] = await db.query(
    'SELECT material_id, spec_value FROM material_specifications WHERE material_id IN (?) ORDER BY sort_order, id', [ids]);
  rows.forEach((r) => map.get(r.material_id).push(r.spec_value));
  return map;
}

async function saveSpecs(conn, materialId, specs) {
  if (specs === undefined) return;
  await conn.query('DELETE FROM material_specifications WHERE material_id = ?', [materialId]);
  if (!specs.length) return;
  await conn.query('INSERT INTO material_specifications (material_id, spec_value, sort_order) VALUES ?',
    [specs.map((sv, i) => [materialId, sv, i])]);
}

/* ---------- categories ---------- */
async function listCategories() {
  const [rows] = await pool.query('SELECT id, category_name FROM material_categories ORDER BY category_name');
  return rows;
}

async function createCategory(body, userId, ip) {
  const name = v.reqStr(body.category_name, 'Category name', 80);
  return withTransaction(async (conn) => {
    const [dup] = await conn.query('SELECT id FROM material_categories WHERE category_name = ?', [name]);
    if (dup.length) throw new AppError('Category already exists', 409);
    const [r] = await conn.query('INSERT INTO material_categories (category_name) VALUES (?)', [name]);
    const row = { id: r.insertId, category_name: name };
    await audit({ userId, action: 'CREATE', table: 'material_categories', recordId: r.insertId, newValues: row, ip }, conn);
    return row;
  });
}

/* ---------- materials ---------- */
function cleanInput(body) {
  const d = {
    material_name: v.reqStr(body.material_name, 'Material name', 150),
    category_id: v.toId(body.category_id, 'category'),
    unit: String(body.unit || '').toUpperCase(),
    sku: v.optStr(body.sku, 'SKU', 50),
    place: v.optStr(body.place, 'Place', 100),
    minimum_stock: v.num(body.minimum_stock, 'Minimum stock'),
    purchase_rate: v.num(body.purchase_rate, 'Purchase rate', { max: 999999999, decimals: 2 }),
  };
  if (!UNITS.includes(d.unit)) throw new AppError(`Unit must be one of ${UNITS.join(', ')}`);
  d.specifications = cleanSpecs(body.specifications);
  if (body.is_active !== undefined) d.is_active = v.toBool(body.is_active, 'is_active');
  return d;
}

async function checkRefs(conn, d, selfId = null) {
  const [cat] = await conn.query('SELECT id FROM material_categories WHERE id = ?', [d.category_id]);
  if (!cat.length) throw new AppError('Selected category does not exist');
  const [dup] = await conn.query('SELECT id FROM materials WHERE material_name = ? AND id <> ?', [d.material_name, selfId || 0]);
  if (dup.length) throw new AppError('A material with this name already exists', 409);
  if (d.sku) {
    const [s] = await conn.query('SELECT id FROM materials WHERE sku = ? AND id <> ?', [d.sku, selfId || 0]);
    if (s.length) throw new AppError('This SKU is already used by another material', 409);
  }
}

async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'material id');
  const [rows] = await db.query(`${BASE_SELECT} WHERE m.id = ?`, [id]);
  if (!rows.length) throw new AppError('Material not found', 404);
  const specs = await loadSpecs(db, [rows[0].id]);
  return { ...shape(rows[0]), specifications: specs.get(rows[0].id) };
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  const search = v.clean(q.search);
  if (search) {
    where.push(`(m.material_name LIKE ? OR m.material_code LIKE ? OR m.sku LIKE ?
      OR EXISTS (SELECT 1 FROM material_specifications ms WHERE ms.material_id = m.id AND ms.spec_value LIKE ?))`);
    const like = `%${search}%`;
    args.push(like, like, like, like);
  }
  if (q.category_id) { where.push('m.category_id = ?'); args.push(v.toId(q.category_id, 'category')); }
  if (q.active === 'true') where.push('m.is_active = 1');
  else if (q.active === 'false') where.push('m.is_active = 0');
  if (q.low_stock === 'true') where.push('m.current_stock <= m.minimum_stock');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM materials m ${w}`, args);
  const [rows] = await pool.query(`${BASE_SELECT} ${w} ORDER BY m.material_name ASC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const specs = await loadSpecs(pool, rows.map((r) => r.id));
  const items = rows.map((r) => ({ ...shape(r), specifications: specs.get(r.id) }));
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

async function create(body, userId, ip) {
  const d = cleanInput(body);
  const opening = v.num(body.opening_stock, 'Opening stock');
  return withTransaction(async (conn) => {
    await checkRefs(conn, d);
    const code = await nextNumber(conn, 'MATERIAL');
    const [r] = await conn.query(
      `INSERT INTO materials (material_code, material_name, sku, place, category_id, unit, opening_stock,
         minimum_stock, purchase_rate, current_stock, is_active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, d.material_name, d.sku, d.place, d.category_id, d.unit, opening, d.minimum_stock, d.purchase_rate,
        opening, d.is_active === undefined ? 1 : d.is_active, userId]);
    await saveSpecs(conn, r.insertId, d.specifications);

    if (opening > 0) {
      await conn.query(
        `INSERT INTO material_stock_transactions (material_id, txn_date, txn_type, opening_stock, inward_qty, total_qty,
           despatch_qty, closing_stock, purpose, reference_type, reference_no, entered_by, remarks)
         VALUES (?, CURDATE(), 'OPENING', ?, 0, ?, 0, ?, 'Opening stock', 'MANUAL', ?, ?, 'Created with material')`,
        [r.insertId, opening, opening, opening, code, userId]);
    }
    const created = await getById(r.insertId, conn);
    await audit({ userId, action: 'CREATE', table: 'materials', recordId: r.insertId, newValues: created, ip }, conn);
    return created;
  });
}

// opening_stock / current_stock are NOT editable here - stock moves only via stock transactions.
async function update(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'material id');
  const d = cleanInput(body);
  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id FROM materials WHERE id = ? FOR UPDATE', [id]);
    if (!cur.length) throw new AppError('Material not found', 404);
    const before = await getById(id, conn);
    await checkRefs(conn, d, id);
    await conn.query(
      `UPDATE materials SET material_name=?, sku=?, place=?, category_id=?, unit=?, minimum_stock=?, purchase_rate=?,
         is_active=? WHERE id=?`,
      [d.material_name, d.sku, d.place, d.category_id, d.unit, d.minimum_stock, d.purchase_rate,
        d.is_active === undefined ? before.is_active : d.is_active, id]);
    await saveSpecs(conn, id, d.specifications);
    const after = await getById(id, conn);
    await audit({ userId, action: 'UPDATE', table: 'materials', recordId: id, oldValues: before, newValues: after, ip }, conn);
    return after;
  });
}

async function setStatus(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'material id');
  const active = v.toBool(body.is_active, 'is_active');
  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id, is_active FROM materials WHERE id = ? FOR UPDATE', [id]);
    if (!cur.length) throw new AppError('Material not found', 404);
    await conn.query('UPDATE materials SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'materials', recordId: id,
      oldValues: { is_active: !!cur[0].is_active }, newValues: { is_active: active }, ip }, conn);
    return getById(id, conn);
  });
}

module.exports = { listCategories, createCategory, list, getById, create, update, setStatus };
