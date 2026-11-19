// Low-stock rule (same for every material):
//   a material is LOW when current stock <= 10 KG
//   GRAM materials use the same 10 KG (= 10000 GRAM). Any other unit (NOS, LITRE, BAGS, ...) uses 10 of that unit.
// To change the limit, change LOW_STOCK_KG only.
const LOW_STOCK_KG = 10;

// SQL for the level. alias = the alias of the materials table in the query (default m).
const lowLevelSql = (alias = 'm') =>
  `(CASE UPPER(${alias}.unit) WHEN 'GRAM' THEN ${LOW_STOCK_KG * 1000} ELSE ${LOW_STOCK_KG} END)`;

// Level of one material.
async function lowLevelOf(db, materialId) {
  const [rows] = await db.query(`SELECT ${lowLevelSql('m')} AS lvl FROM materials m WHERE m.id = ?`, [materialId]);
  return rows.length ? Number(rows[0].lvl) : 0;
}

module.exports = { LOW_STOCK_KG, lowLevelSql, lowLevelOf };