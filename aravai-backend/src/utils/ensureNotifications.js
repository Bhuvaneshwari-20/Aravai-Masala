// Notifications: makes sure the tables exist. Runs at server start-up, safe to run any number of times.
//   notifications   one row per user per alert (bell icon list). UNIQUE (user_id, dedupe_key) = the same alert is never created twice.
//   user_presence   last time the user's browser / phone asked for notifications (= "is the user inside the website right now?")
//   phone_channels  the phone (Telegram chat) a user connected for alerts
//   phone_link_codes  one-time codes used while connecting a phone (15 minutes)
module.exports = async function ensureNotifications(pool, log = console) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT UNSIGNED NOT NULL,
      type           VARCHAR(40)  NOT NULL,
      severity       ENUM('info','success','warning','danger') NOT NULL DEFAULT 'info',
      title          VARCHAR(120) NOT NULL,
      message        VARCHAR(500) NOT NULL,
      screen         VARCHAR(60)  DEFAULT NULL,
      params         VARCHAR(255) DEFAULT NULL,
      dedupe_key     VARCHAR(120) DEFAULT NULL,
      is_read        TINYINT(1)   NOT NULL DEFAULT 0,
      read_at        DATETIME     DEFAULT NULL,
      phone_sent_at  DATETIME     DEFAULT NULL,
      created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_notif_user_key (user_id, dedupe_key),
      KEY idx_notif_user (user_id, is_read, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id    INT UNSIGNED NOT NULL PRIMARY KEY,
      last_seen  DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_channels (
      user_id    INT UNSIGNED NOT NULL PRIMARY KEY,
      kind       VARCHAR(20)  NOT NULL DEFAULT 'TELEGRAM',
      address    VARCHAR(60)  NOT NULL,
      linked_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_link_codes (
      code        VARCHAR(16)  NOT NULL PRIMARY KEY,
      user_id     INT UNSIGNED NOT NULL,
      expires_at  DATETIME     NOT NULL,
      KEY idx_plc_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
       // ---- new: FCM push + per-channel settings ----
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id       INT UNSIGNED NOT NULL,
      device_token  VARCHAR(512) NOT NULL,
      token_hash    CHAR(64)     NOT NULL,
      device_type   VARCHAR(10)  NOT NULL DEFAULT 'android',
      device_id     VARCHAR(80)  DEFAULT NULL,
      app_version   VARCHAR(20)  DEFAULT NULL,
      is_active     TINYINT(1)   NOT NULL DEFAULT 1,
      last_error    VARCHAR(80)  DEFAULT NULL,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_device_token_hash (token_hash),
      KEY idx_device_user (user_id, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_settings (
      user_id       INT UNSIGNED NOT NULL PRIMARY KEY,
      web_enabled   TINYINT(1) NOT NULL DEFAULT 1,
      push_enabled  TINYINT(1) NOT NULL DEFAULT 1,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  const [cols] = await pool.query('SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [db, 'notifications']);
  const have = new Set(cols.map((x) => x.c));
  const add = [
    ['process_type', 'VARCHAR(20) NULL'], ['process_id', 'INT UNSIGNED NULL'], ['batch_id', 'INT UNSIGNED NULL'],
    ['reminder_stage', 'VARCHAR(20) NULL'], ['push_sent_at', 'DATETIME NULL'], ['hidden', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  for (const [c, ddl] of add) {
    if (!have.has(c)) { await pool.query(`ALTER TABLE notifications ADD COLUMN ${c} ${ddl}`); log.log(`Notifications: added notifications.${c}`); }
  }
  try { await pool.query('ALTER TABLE notifications ADD INDEX idx_notif_process (process_type, process_id)'); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
};