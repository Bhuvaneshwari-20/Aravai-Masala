const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const label = (g) => (g >= 1000 ? `${Number((g / 1000).toFixed(3))} KG` : `${Number(g)} GM`);
const shapeProduct = (r) => ({ ...r, is_active: !!r.is_active });
const shapePack = (r) => ({ ...r, is_active: !!r.is_active });

/* ---------- MRP with "from date" (table product_mrp) ---------- */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (str, n) => {
  const d = new Date(`${str}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function loadMrp(db, packIds) {
  const map = new Map(packIds.map((id) => [id, []]));
  if (!packIds.length) return map;
  const [rows] = await db.query(
    'SELECT id, packing_rate_id, mrp, effective_from FROM product_mrp WHERE packing_rate_id IN (?) ORDER BY effective_from, id', [packIds]);
  rows.forEach((r) => map.get(r.packing_rate_id).push(r));
  return map;
}

// Current MRP = the latest entry whose from-date has arrived. "To date" = day before the next entry starts.
function withMrp(pack, rows) {
  const today = todayStr();
  const hist = (rows || []).map((x, i, a) => ({
    id: x.id, mrp: Number(x.mrp), effective_from: x.effective_from,
    effective_to: a[i + 1] ? addDays(a[i + 1].effective_from, -1) : null,
  }));
  let cur = null;
  hist.forEach((h) => { if (h.effective_from <= today) cur = h; });
  hist.forEach((h) => { h.status = h === cur ? 'CURRENT' : h.effective_from > today ? 'UPCOMING' : 'PAST'; });
  return { ...pack, mrp: cur ? cur.mrp : pack.mrp, mrp_from: cur ? cur.effective_from : null,
    next_mrp: hist.find((h) => h.effective_from > today) || null, mrp_history: hist };
}

// add / replace the MRP that starts on `from`, then keep the pack's own mrp column equal to today's MRP
async function setMrp(conn, packId, mrp, from, userId) {
  await conn.query(
    `INSERT INTO product_mrp (packing_rate_id, mrp, effective_from, created_by) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE mrp = VALUES(mrp), created_by = VALUES(created_by)`, [packId, mrp, from, userId || null]);
  const [cur] = await conn.query(
    'SELECT mrp FROM product_mrp WHERE packing_rate_id = ? AND effective_from <= CURDATE() ORDER BY effective_from DESC, id DESC LIMIT 1', [packId]);
  if (cur.length) await conn.query('UPDATE product_packing_rates SET mrp = ? WHERE id = ?', [cur[0].mrp, packId]);
}

// the gram must exist in the Grams master
async function assertGram(conn, weight) {
  const [g] = await conn.query('SELECT id FROM pack_sizes WHERE weight_grams = ? AND is_active = 1', [weight]);
  if (!g.length) throw new AppError(`${label(weight)} is not in the Grams master. Add it there first`);
}

async function loadPacks(db, ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const [rows] = await db.query(
    'SELECT * FROM product_packing_rates WHERE product_id IN (?) ORDER BY weight_grams', [ids]);
  const sched = await loadMrp(db, rows.map((r) => r.id));
  rows.forEach((r) => map.get(r.product_id).push(withMrp(shapePack(r), sched.get(r.id))));
  return map;
}

function cleanPack(p, productCode) {
  const weight = v.positive(p.weight_grams, 'Pack weight (grams)', { max: 1000000, decimals: 2 });
  const mrp = v.positive(p.mrp, 'MRP', { max: 99999999, decimals: 2 });
  return {
    weight_grams: weight,
    packing_size_label: v.optStr(p.packing_size_label, 'Pack size label', 20) || label(weight),
    sku_code: v.optStr(p.sku_code, 'SKU code', 30) || `${productCode}-${Number(weight)}G`,
    mrp,
    effective_from: v.date(p.effective_from, 'MRP from date', { allowFuture: true }),
    bag_rate: v.num(p.bag_rate, 'Bag rate', { max: 99999999, decimals: 2 }),
    production_rate: v.num(p.production_rate, 'Production rate', { max: 99999999, decimals: 2 }),
    bag_material_cost: v.num(p.bag_material_cost, 'Bag material cost', { max: 999999, decimals: 4 }),
  };
}

async function insertPack(conn, productId, p, userId) {
  const [dup] = await conn.query('SELECT id FROM product_packing_rates WHERE sku_code = ?', [p.sku_code]);
  if (dup.length) throw new AppError(`SKU code ${p.sku_code} is already used`, 409);
  const [r] = await conn.query(
    `INSERT INTO product_packing_rates (product_id, sku_code, packing_size_label, weight_grams, mrp, bag_rate, production_rate, bag_material_cost)
     VALUES (?,?,?,?,?,?,?,?)`,
    [productId, p.sku_code, p.packing_size_label, p.weight_grams, p.mrp, p.bag_rate, p.production_rate, p.bag_material_cost]);
  await setMrp(conn, r.insertId, p.mrp, p.effective_from, userId);
  return r.insertId;
}

async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'product id');
  const [rows] = await db.query('SELECT * FROM product_master WHERE id = ?', [id]);
  if (!rows.length) throw new AppError('Product not found', 404);
  const packs = await loadPacks(db, [id]);
  return { ...shapeProduct(rows[0]), packs: packs.get(id) };
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  const search = v.clean(q.search);
  if (search) { where.push('(p.product_name LIKE ? OR p.product_code LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  if (q.active === 'true') where.push('p.is_active = 1');
  else if (q.active === 'false') where.push('p.is_active = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM product_master p ${w}`, args);
  const [rows] = await pool.query(`SELECT p.* FROM product_master p ${w} ORDER BY p.product_name LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const packs = await loadPacks(pool, rows.map((r) => r.id));
  const items = rows.map((r) => ({ ...shapeProduct(r), packs: packs.get(r.id) }));
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

// Product + at least one pack size with MRP (flow step 4)
async function create(body, userId, ip) {
  const name = v.reqStr(body.product_name, 'Product name', 120);
  const category = v.optStr(body.category, 'Category', 80);
  if (!Array.isArray(body.packs) || !body.packs.length) throw new AppError('Add at least one pack size with MRP');
  if (body.packs.length > 20) throw new AppError('Too many pack sizes');

  return withTransaction(async (conn) => {
    const [dup] = await conn.query('SELECT id FROM product_master WHERE product_name = ?', [name]);
    if (dup.length) throw new AppError('A product with this name already exists', 409);
    const code = await nextNumber(conn, 'PRODUCT');
    const packs = body.packs.map((p) => cleanPack(p, code));
    const weights = new Set();
    for (const p of packs) {
      await assertGram(conn, p.weight_grams);
      if (weights.has(p.weight_grams)) throw new AppError(`Pack size ${p.packing_size_label} is repeated`);
      weights.add(p.weight_grams);
    }
    const [r] = await conn.query('INSERT INTO product_master (product_code, product_name, category) VALUES (?,?,?)', [code, name, category]);
    for (const p of packs) await insertPack(conn, r.insertId, p, userId);
    const created = await getById(r.insertId, conn);
    await audit({ userId, action: 'CREATE', table: 'product_master', recordId: r.insertId, newValues: created, ip }, conn);
    return created;
  });
}

async function update(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'product id');
  const name = v.reqStr(body.product_name, 'Product name', 120);
  const category = v.optStr(body.category, 'Category', 80);
  return withTransaction(async (conn) => {
    const [cur] = await conn.query('SELECT id FROM product_master WHERE id = ? FOR UPDATE', [id]);
    if (!cur.length) throw new AppError('Product not found', 404);
    const before = await getById(id, conn);
    const [dup] = await conn.query('SELECT id FROM product_master WHERE product_name = ? AND id <> ?', [name, id]);
    if (dup.length) throw new AppError('A product with this name already exists', 409);
    const active = body.is_active === undefined ? before.is_active : v.toBool(body.is_active, 'is_active');
    await conn.query('UPDATE product_master SET product_name=?, category=?, is_active=? WHERE id=?', [name, category, active ? 1 : 0, id]);
    const after = await getById(id, conn);
    await audit({ userId, action: 'UPDATE', table: 'product_master', recordId: id, oldValues: before, newValues: after, ip }, conn);
    return after;
  });
}

async function addPack(productIdRaw, body, userId, ip) {
  const productId = v.toId(productIdRaw, 'product id');
  return withTransaction(async (conn) => {
    const [prod] = await conn.query('SELECT id, product_code FROM product_master WHERE id = ? FOR UPDATE', [productId]);
    if (!prod.length) throw new AppError('Product not found', 404);
    const p = cleanPack(body, prod[0].product_code);
    await assertGram(conn, p.weight_grams);
    const [same] = await conn.query('SELECT id FROM product_packing_rates WHERE product_id = ? AND weight_grams = ?', [productId, p.weight_grams]);
    if (same.length) throw new AppError('This pack size already exists for the product', 409);
    const packId = await insertPack(conn, productId, p, userId);
    await audit({ userId, action: 'CREATE', table: 'product_packing_rates', recordId: packId, newValues: p, ip }, conn);
    return getById(productId, conn);
  });
}

// Pack weight is fixed (it is part of the SKU). MRP is saved with a "from date" (new entry in product_mrp);
// the earlier MRP automatically ends the day before. Other rates can change too and every change is kept in history.
async function updatePack(productIdRaw, packIdRaw, body, userId, ip) {
  const productId = v.toId(productIdRaw, 'product id');
  const packId = v.toId(packIdRaw, 'pack id');
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM product_packing_rates WHERE id = ? AND product_id = ? FOR UPDATE', [packId, productId]);
    if (!rows.length) throw new AppError('Pack size not found', 404);
    const old = rows[0];
    const mrp = body.mrp === undefined ? Number(old.mrp) : v.positive(body.mrp, 'MRP', { max: 99999999, decimals: 2 });
    const bagRate = body.bag_rate === undefined ? Number(old.bag_rate) : v.num(body.bag_rate, 'Bag rate', { max: 99999999, decimals: 2 });
    const prodRate = body.production_rate === undefined ? Number(old.production_rate) : v.num(body.production_rate, 'Production rate', { max: 99999999, decimals: 2 });
    const bagCost = body.bag_material_cost === undefined ? Number(old.bag_material_cost) : v.num(body.bag_material_cost, 'Bag material cost', { max: 999999, decimals: 4 });
    const lbl = body.packing_size_label === undefined ? old.packing_size_label : v.reqStr(body.packing_size_label, 'Pack size label', 20);
    const active = body.is_active === undefined ? !!old.is_active : v.toBool(body.is_active, 'is_active');
    const from = v.date(body.effective_from, 'MRP from date', { allowFuture: true });

    // is this a new MRP (different amount, or same amount starting on another date)?
    let mrpChanged = false;
    if (body.mrp !== undefined) {
      const [same] = await conn.query('SELECT mrp FROM product_mrp WHERE packing_rate_id = ? AND effective_from = ?', [packId, from]);
      mrpChanged = same.length ? Number(same[0].mrp) !== mrp : true;
      if (mrpChanged) {
        const [cur] = await conn.query(
          'SELECT mrp FROM product_mrp WHERE packing_rate_id = ? AND effective_from <= CURDATE() ORDER BY effective_from DESC, id DESC LIMIT 1', [packId]);
        // same amount as the running MRP and no explicit date -> nothing to record
        if (cur.length && Number(cur[0].mrp) === mrp && !body.effective_from) mrpChanged = false;
      }
    }

    if (mrpChanged || bagRate !== Number(old.bag_rate) || prodRate !== Number(old.production_rate)) {
      await conn.query(
        `INSERT INTO product_rate_history (packing_rate_id, old_mrp, new_mrp, old_bag_rate, new_bag_rate, old_production_rate, new_production_rate, effective_from, changed_by)
         VALUES (?,?,?,?,?,?,?,?,?)`, [packId, old.mrp, mrpChanged ? mrp : old.mrp, old.bag_rate, bagRate, old.production_rate, prodRate, from, userId]);
    }
    await conn.query(
      `UPDATE product_packing_rates SET packing_size_label=?, bag_rate=?, production_rate=?, bag_material_cost=?, is_active=? WHERE id=?`,
      [lbl, bagRate, prodRate, bagCost, active ? 1 : 0, packId]);
    if (mrpChanged) await setMrp(conn, packId, mrp, from, userId);
    await audit({ userId, action: 'UPDATE', table: 'product_packing_rates', recordId: packId,
      oldValues: old, newValues: { mrp, mrp_from: from, bagRate, prodRate, bagCost, lbl, active }, ip }, conn);
    return getById(productId, conn);
  });
}

module.exports = { list, getById, create, update, addPack, updatePack };
