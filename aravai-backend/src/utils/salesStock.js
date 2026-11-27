// Finished-goods movements for the Sales module. Every function must be called INSIDE a transaction (pass its conn).
//
// How stock is kept (same as Packing): finished_goods_stock has one row per batch + pack size (SKU).
//   Packing  : stock_inward / available_qty / closing_stock go UP.
//   Sale     : stock_outward goes UP, available_qty / closing_stock go DOWN  (oldest batch first = FIFO).
//   Return   : the same rows are given back (stock_outward goes DOWN), only for RESALEABLE packs, to the batch they were sold from.
// Every movement is also written to finished_goods_transactions (existing table) and to sales_stock_ledger
// (batch + cost snapshot), so a pack can always be traced from batch -> invoice -> return.
const AppError = require('./AppError');

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

// Actual cost of ONE pack of this SKU made in this batch.
//   packing cost  = (pouch cost + packing labour) actually booked on the batch's packing runs / good packs
//   material cost = raw material issued to the batch (weighed qty x purchase rate) / blended output kg x pack weight (kg)
async function unitCost(conn, batchId, packingRateId) {
  const [[pk]] = await conn.query(
    `SELECT COALESCE(SUM(total_bag_material_cost + production_cost), 0) AS cost, COALESCE(SUM(accepted_bag_count), 0) AS packs
       FROM packing_details WHERE batch_id = ? AND packing_rate_id = ? AND status <> 'CANCELLED'`, [batchId, packingRateId]);
  const packing = Number(pk.packs) > 0 ? Number(pk.cost) / Number(pk.packs) : 0;

  const [[b]] = await conn.query('SELECT current_output_kg FROM batch_master WHERE id = ?', [batchId]);
  const [[r]] = await conn.query('SELECT weight_grams FROM product_packing_rates WHERE id = ?', [packingRateId]);
  const [[rm]] = await conn.query(
    `SELECT COALESCE(SUM(bd.weighed_qty * m.purchase_rate), 0) AS cost
       FROM batching_details bd JOIN materials m ON m.id = bd.material_id WHERE bd.batch_id = ?`, [batchId]);
  const outKg = Number(b && b.current_output_kg) || 0;
  const material = outKg > 0 ? (Number(rm.cost) / outKg) * (Number(r.weight_grams) / 1000) : 0;
  return { material: r4(material), packing: r4(packing) };
}

async function fgTxn(conn, { fgId, date, type, qty, ref, userId, remarks }) {
  await conn.query(
    `INSERT INTO finished_goods_transactions (fg_stock_id, txn_date, txn_type, quantity, reference_no, entered_by, remarks)
     VALUES (?,?,?,?,?,?,?)`, [fgId, date, type, qty, ref, userId, remarks]);
}

async function ledger(conn, x) {
  await conn.query(
    `INSERT INTO sales_stock_ledger (txn_date, source_type, direction, invoice_id, invoice_item_id, return_id, return_item_id, product_id,
       packing_rate_id, fg_stock_id, batch_id, qty, unit_material_cost, unit_packing_cost, reference_no, entered_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [x.date, x.source, x.direction, x.invoiceId || null, x.invoiceItemId || null, x.returnId || null, x.returnItemId || null, x.productId,
      x.rateId, x.fgId, x.batchId, x.qty, x.material, x.packing, x.ref, x.userId]);
}

// Take `qty` packs of a SKU out of stock, oldest batch first. Throws if there is not enough.
// Returns { cost, allocations:[{fg_stock_id, batch_id, batch_no, qty, unit_cost}] }
async function issueFifo(conn, { packingRateId, productId, qty, date, source, invoiceId, invoiceItemId, returnId, returnItemId, ref, userId, label }) {
  const [rows] = await conn.query(
    `SELECT fg.id, fg.batch_id, fg.available_qty, b.batch_no
       FROM finished_goods_stock fg JOIN batch_master b ON b.id = fg.batch_id
      WHERE fg.packing_rate_id = ? AND fg.available_qty > 0
      ORDER BY b.production_date, fg.batch_id FOR UPDATE`, [packingRateId]);
  const have = rows.reduce((a, r) => a + r.available_qty, 0);
  if (have < qty) {
    const [[s]] = await conn.query('SELECT sku_code FROM product_packing_rates WHERE id = ?', [packingRateId]);
    throw new AppError(`Not enough stock for ${s ? s.sku_code : 'this SKU'}: ${have} pack(s) available, ${qty} requested`);
  }
  let left = qty; let cost = 0; const allocations = [];
  for (const row of rows) {
    if (left <= 0) break;
    const take = Math.min(left, row.available_qty);
    await conn.query(
      'UPDATE finished_goods_stock SET stock_outward = stock_outward + ?, available_qty = available_qty - ?, closing_stock = closing_stock - ? WHERE id = ?',
      [take, take, take, row.id]);
    const c = await unitCost(conn, row.batch_id, packingRateId);
    await fgTxn(conn, { fgId: row.id, date, type: 'OUTWARD', qty: take, ref, userId, remarks: `${label} (batch ${row.batch_no})` });
    await ledger(conn, { date, source, direction: 'OUT', invoiceId, invoiceItemId, returnId, returnItemId, productId, rateId: packingRateId,
      fgId: row.id, batchId: row.batch_id, qty: take, material: c.material, packing: c.packing, ref, userId });
    cost += take * (c.material + c.packing);
    allocations.push({ fg_stock_id: row.id, batch_id: row.batch_id, batch_no: row.batch_no, qty: take, unit_cost: r4(c.material + c.packing) });
    left -= take;
  }
  return { cost: r2(cost), allocations };
}

// Give `qty` packs of an invoice line back to stock, to the batch(es) they were sold from (latest allocation first).
// Cost is reversed at the SAME unit cost the sale used, so profit stays exact.
async function restoreToStock(conn, { invoiceItemId, qty, date, source, invoiceId, returnId, returnItemId, ref, userId, label }) {
  const [alloc] = await conn.query(
    `SELECT l.fg_stock_id, l.batch_id, l.product_id, l.packing_rate_id,
            MAX(CASE WHEN l.direction = 'OUT' THEN l.unit_material_cost END) AS m, MAX(CASE WHEN l.direction = 'OUT' THEN l.unit_packing_cost END) AS p,
            SUM(CASE WHEN l.direction = 'OUT' THEN l.qty ELSE -CAST(l.qty AS SIGNED) END) AS remaining
       FROM sales_stock_ledger l
      WHERE l.invoice_item_id = ? AND l.source_type IN ('SALE','RETURN','CANCEL')
      GROUP BY l.fg_stock_id, l.batch_id, l.product_id, l.packing_rate_id
     HAVING remaining > 0 ORDER BY l.fg_stock_id DESC`, [invoiceItemId]);
  let left = qty; let cost = 0;
  for (const a of alloc) {
    if (left <= 0) break;
    const put = Math.min(left, Number(a.remaining));
    await conn.query('SELECT id FROM finished_goods_stock WHERE id = ? FOR UPDATE', [a.fg_stock_id]);
    await conn.query(
      'UPDATE finished_goods_stock SET stock_outward = stock_outward - ?, available_qty = available_qty + ?, closing_stock = closing_stock + ? WHERE id = ?',
      [put, put, put, a.fg_stock_id]);
    await fgTxn(conn, { fgId: a.fg_stock_id, date, type: 'INWARD', qty: put, ref, userId, remarks: label });
    await ledger(conn, { date, source, direction: 'IN', invoiceId, invoiceItemId, returnId, returnItemId, productId: a.product_id, rateId: a.packing_rate_id,
      fgId: a.fg_stock_id, batchId: a.batch_id, qty: put, material: Number(a.m), packing: Number(a.p), ref, userId });
    cost += put * (Number(a.m) + Number(a.p));
    left -= put;
  }
  if (left > 0) throw new AppError('Stock trace for this invoice line is incomplete, so the packs cannot be put back', 409);
  return { cost: r2(cost) };
}

module.exports = { r2, r4, unitCost, issueFifo, restoreToStock };
