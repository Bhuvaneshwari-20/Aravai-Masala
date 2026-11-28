const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { lowLevelSql } = require('../utils/lowStock');
const BASE_SELECT = `
  SELECT m.*, c.category_name, (m.current_stock <= ${lowLevelSql('m')}) AS is_low_stock
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

/* ---------- units (the Unit dropdown) ---------- */
async function listUnits() {
  const [rows] = await pool.query('SELECT id, unit_name FROM material_units ORDER BY id');
  return rows;
}

async function createUnit(body, userId, ip) {
  const name = v.reqStr(body.unit_name, 'Unit name', 20).toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z0-9][A-Z0-9 ./%-]*$/.test(name)) throw new AppError('Unit name can have letters, numbers, space and . / % - only');
  return withTransaction(async (conn) => {
    const [dup] = await conn.query('SELECT id FROM material_units WHERE unit_name = ?', [name]);
    if (dup.length) throw new AppError('This unit already exists', 409);
    const [r] = await conn.query('INSERT INTO material_units (unit_name) VALUES (?)', [name]);
    const row = { id: r.insertId, unit_name: name };
    await audit({ userId, action: 'CREATE', table: 'material_units', recordId: r.insertId, newValues: row, ip }, conn);
    return row;
  });
}

/* ---------- materials ---------- */
const sent = (x) => x !== undefined && x !== null && String(x).trim() !== '';

// Only name + unit (+ specifications) are required now. Any other field that is not sent stays undefined,
// so create() falls back to a default and update() keeps the value already stored.
function cleanInput(body) {
  const d = {
    material_name: v.reqStr(body.material_name, 'Material name', 150),
    unit: String(body.unit || '').toUpperCase(),
    category_id: sent(body.category_id) ? v.toId(body.category_id, 'category') : undefined,
    sku: body.sku === undefined ? undefined : v.optStr(body.sku, 'Material code', 20),
    place: body.place === undefined ? undefined : v.optStr(body.place, 'Place', 100),
    minimum_stock: sent(body.minimum_stock) ? v.num(body.minimum_stock, 'Low stock level') : undefined,
    purchase_rate: sent(body.purchase_rate) ? v.num(body.purchase_rate, 'Purchase rate', { max: 999999999, decimals: 2 }) : undefined,
    default_filter_stages: v.intRange(body.default_filter_stages, 'Filtering stages', 0, 5),
    // roasting time in seconds (hours / minutes / seconds picker). undefined = not sent (keep), null = cleared
    roast_seconds: body.roast_seconds === undefined ? undefined : (sent(body.roast_seconds) ? v.intRange(body.roast_seconds, 'Roasting time', 1, 86400) : null),
        filter_seconds: body.filter_seconds === undefined ? undefined : (sent(body.filter_seconds) ? v.intRange(body.filter_seconds, 'Filtering time', 1, 86400) : null),
    grind_seconds: body.grind_seconds === undefined ? undefined : (sent(body.grind_seconds) ? v.intRange(body.grind_seconds, 'Grinding time', 1, 86400) : null),
        blending_seconds: body.blending_seconds === undefined ? undefined : (sent(body.blending_seconds) ? v.intRange(body.blending_seconds, 'Blending time', 1, 86400) : null),
  };
  // unit may be empty: it is chosen when the first stock is received (Material Receipt). '' = not chosen yet.
  d.specifications = cleanSpecs(body.specifications);
  if (body.is_active !== undefined) d.is_active = v.toBool(body.is_active, 'is_active');
  return d;
}

// Category is no longer asked in the form. The column is still required, so new materials go under "General".
async function defaultCategoryId(conn) {
  const [rows] = await conn.query("SELECT id FROM material_categories WHERE category_name = 'General' LIMIT 1");
  if (rows.length) return rows[0].id;
  const [r] = await conn.query("INSERT INTO material_categories (category_name) VALUES ('General')");
  return r.insertId;
}

async function checkRefs(conn, d, selfId = null) {
  if (d.unit) {
    const [un] = await conn.query('SELECT id FROM material_units WHERE unit_name = ?', [d.unit]);
    if (!un.length) throw new AppError('Selected unit does not exist. Add it first using "Add unit"');
  }
  if (d.category_id !== undefined) {
    const [cat] = await conn.query('SELECT id FROM material_categories WHERE id = ?', [d.category_id]);
    if (!cat.length) throw new AppError('Selected category does not exist');
  }
  const [dup] = await conn.query('SELECT id FROM materials WHERE material_name = ? AND id <> ?', [d.material_name, selfId || 0]);
  if (dup.length) throw new AppError('A material with this name already exists', 409);
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
  if (q.low_stock === 'true') where.push(`m.current_stock <= ${lowLevelSql('m')}`);
    // Material Stock page: only materials that already have a Material Receipt (or opening stock)
  if (q.received === 'true') where.push("EXISTS (SELECT 1 FROM material_stock_transactions t WHERE t.material_id = m.id AND t.txn_type IN ('INWARD','OPENING'))");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM materials m ${w}`, args);
  const [rows] = await pool.query(`${BASE_SELECT} ${w} ORDER BY ${q.sort === 'latest' ? 'm.id DESC' : 'm.material_name ASC'} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const specs = await loadSpecs(pool, rows.map((r) => r.id));
  const items = rows.map((r) => ({ ...shape(r), specifications: specs.get(r.id) }));
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

async function create(body, userId, ip) {
  const d = cleanInput(body);
  const opening = v.num(body.opening_stock, 'Opening stock');
  if (opening > 0 && !d.unit) throw new AppError('Select a unit when opening stock is entered');
  return withTransaction(async (conn) => {
    await checkRefs(conn, d);
    const categoryId = d.category_id !== undefined ? d.category_id : await defaultCategoryId(conn);
    // the code typed in the form is the material code; only when it is left empty the system makes MAT-0001, MAT-0002...
    const code = d.sku ? d.sku : await nextNumber(conn, 'MATERIAL');
    const [r] = await conn.query(
      `INSERT INTO materials (material_code, material_name, sku, place, category_id, unit, opening_stock,
                 minimum_stock, default_filter_stages, purchase_rate, current_stock, is_active, created_by, roast_seconds, filter_seconds, grind_seconds, blending_seconds)VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, d.material_name, d.sku ?? null, d.place ?? null, categoryId, d.unit, opening, d.minimum_stock ?? 0, d.default_filter_stages ?? 0,
        d.purchase_rate ?? 0, opening, d.is_active === undefined ? 1 : d.is_active, userId, d.roast_seconds ?? null, d.filter_seconds ?? null, d.grind_seconds ?? null, d.blending_seconds ?? null]);
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
    // typed code -> material code. Typed code removed -> system makes a new MAT-xxxx. Code not touched -> unchanged.
    let newCode = before.material_code;
    if (d.sku) newCode = d.sku;
    else if (d.sku === null && before.sku) newCode = await nextNumber(conn, 'MATERIAL');
    await conn.query(
      `UPDATE materials SET material_code=?, material_name=?, sku=?, place=?, category_id=?, unit=?, minimum_stock=?, default_filter_stages=?,
                 purchase_rate=?, is_active=?, roast_seconds=?, filter_seconds=?, grind_seconds=?, blending_seconds=? WHERE id=?`,
      [newCode, d.material_name, d.sku !== undefined ? d.sku : before.sku, d.place !== undefined ? d.place : before.place,
        d.category_id ?? before.category_id, d.unit || before.unit, d.minimum_stock ?? before.minimum_stock,
        d.default_filter_stages ?? before.default_filter_stages, d.purchase_rate ?? before.purchase_rate, d.is_active === undefined ? before.is_active : d.is_active,
               d.roast_seconds === undefined ? before.roast_seconds : d.roast_seconds,
        d.filter_seconds === undefined ? before.filter_seconds : d.filter_seconds,
        d.grind_seconds === undefined ? before.grind_seconds : d.grind_seconds,         d.blending_seconds === undefined ? before.blending_seconds : d.blending_seconds, id]);
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

// Delete a material. Its stock entries are deleted together with it when they are only receipts / opening stock.
// Blocked when it was ever issued or adjusted in stock (= used in production), or is used in a recipe / other records.
async function remove(idRaw, userId, ip) {
  const id = v.toId(idRaw, 'material id');
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT id, material_code, material_name, unit, current_stock FROM materials WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw new AppError('Material not found', 404);
    const m = rows[0];

    const [[rc]] = await conn.query('SELECT COUNT(*) AS n FROM recipe_details WHERE material_id = ?', [id]);
    if (rc.n > 0) throw new AppError(`${m.material_name} is used in ${rc.n} recipe${rc.n > 1 ? 's' : ''}. Remove it from the recipe first`, 409);

    const [[mv]] = await conn.query("SELECT COUNT(*) AS n FROM material_stock_transactions WHERE material_id = ? AND txn_type NOT IN ('INWARD','OPENING')", [id]);
    if (mv.n > 0) throw new AppError(`${m.material_name} was issued / adjusted in stock (used in production) and cannot be deleted. Mark it inactive instead`, 409);

    const [gone] = await conn.query('DELETE FROM material_stock_transactions WHERE material_id = ?', [id]); // only receipts / opening stock are left here
    try {
      await conn.query('DELETE FROM materials WHERE id = ?', [id]);
    } catch (e) {
      // MySQL 1451 / 1217 = still referenced (purchase, filtering ...). The transaction is rolled back, so the stock entries stay.
      if (e && (e.errno === 1451 || e.errno === 1217 || e.code === 'ER_ROW_IS_REFERENCED_2' || e.code === 'ER_ROW_IS_REFERENCED')) {
        throw new AppError(`${m.material_name} is used in other records (purchase / batch / filtering) and cannot be deleted`, 409);
      }
      throw e;
    }
    await audit({ userId, action: 'DELETE', table: 'materials', recordId: id, oldValues: { ...m, deleted_stock_entries: gone.affectedRows }, ip }, conn);
    return { id, deleted_stock_entries: gone.affectedRows };
  });
}

module.exports = { listCategories, createCategory, listUnits, createUnit, list, getById, create, update, setStatus, remove };