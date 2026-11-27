// Low-stock rule (set by the user, material by material):
//   When a material is added / edited, the user types its "Low stock level" (e.g. Pepper = 5 kg).
//   A material is LOW when its current stock <= that level.
//   The level is typed in the material's own unit (KG, GRAM, ...), so no conversion is done.
//   A level of 0 (not set) means the material is low only when its stock is 0.

// SQL for the level. alias = the alias of the materials table in the query (default m).
const lowLevelSql = (alias = 'm') => `COALESCE(${alias}.minimum_stock, 0)`;

// Level of one material.
async function lowLevelOf(db, materialId) {
  const [rows] = await db.query(`SELECT ${lowLevelSql('m')} AS lvl FROM materials m WHERE m.id = ?`, [materialId]);
  return rows.length ? Number(rows[0].lvl) : 0;
}

module.exports = { lowLevelSql, lowLevelOf };