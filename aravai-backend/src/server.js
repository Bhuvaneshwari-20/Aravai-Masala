const app = require('./app');
const { pool } = require('./config/db');
const port = process.env.PORT || 4000;
(async () => {
  await pool.query('SELECT 1'); // fail fast if DB is unreachable
  app.listen(port, () => console.log(`Aravai API running on :${port}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
