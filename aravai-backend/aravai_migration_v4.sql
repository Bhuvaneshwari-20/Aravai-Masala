-- Migration v4: Super Admin -> Admin -> User account hierarchy.
-- Run after schema v1 + v2 + v3. Safe to re-run.  (Change the USE line if your DB name differs, e.g. aravai_schema.)
USE aravai_masala;

-- who created this account (Super Admin creates Admins, Admin creates staff)
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INT UNSIGNED NULL AFTER is_active;
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_created_by (created_by);

-- two new roles: top-level owner, and a generic staff role
INSERT IGNORE INTO roles (role_name, description) VALUES
  ('Super Admin', 'Owner. Creates Admin accounts. Full access.'),
  ('User',        'Generic factory staff created by an Admin.');

-- generic staff can open the dashboard only (Admin can give other roles when creating a user)
INSERT INTO role_permissions (role_id, module, can_view)
  SELECT id, 'dashboard', TRUE FROM roles WHERE role_name = 'User'
  ON DUPLICATE KEY UPDATE can_view = TRUE;
