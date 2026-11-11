const AppError = require('./AppError');

// Automatic numbers: IND-2026-0001, MAT-0001 ... call inside a transaction.
async function nextNumber(conn, seriesCode) {
  const [rows] = await conn.query('SELECT * FROM document_sequences WHERE series_code = ? FOR UPDATE', [seriesCode]);
  if (!rows.length) throw new AppError(`Unknown number series: ${seriesCode}`, 500);
  const s = rows[0];
  const year = new Date().getFullYear();
  let next = s.last_number + 1;
  if (s.year_scope !== null && s.year_scope !== year) next = 1; // yearly reset
  await conn.query('UPDATE document_sequences SET last_number = ?, year_scope = IF(year_scope IS NULL, NULL, ?) WHERE series_code = ?', [next, year, seriesCode]);
  const num = String(next).padStart(s.pad_length, '0');
  return s.year_scope !== null ? `${s.prefix}${year}-${num}` : `${s.prefix}${num}`;
}
module.exports = { nextNumber };
