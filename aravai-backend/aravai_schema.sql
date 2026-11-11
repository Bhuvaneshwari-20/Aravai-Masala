-- ============================================================
-- ARAVAI MASALA MANUFACTURING MANAGEMENT SYSTEM - MySQL 8 schema
-- No GRN tables by design. Stock changes only via material_stock_transactions
-- and finished_goods_stock, always inside DB transactions (app layer).
-- ============================================================
CREATE DATABASE IF NOT EXISTS aravai_masala CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aravai_masala;

-- ---------- 0. Utility: automatic numbering ----------
-- One row per series (MAT, VEN, IND, QUO, PO, BATCH ...). Incremented with
-- SELECT ... FOR UPDATE inside the creating transaction.
CREATE TABLE document_sequences (
  series_code   VARCHAR(20) PRIMARY KEY,
  prefix        VARCHAR(20) NOT NULL,
  year_scope    SMALLINT NULL,              -- NULL = never resets
  last_number   INT UNSIGNED NOT NULL DEFAULT 0,
  pad_length    TINYINT NOT NULL DEFAULT 4
) ENGINE=InnoDB;

-- ---------- 1. Users & roles ----------
CREATE TABLE roles (
  id          TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_name   VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(200)
) ENGINE=InnoDB;

-- Module-level permissions per role (RBAC enforced by middleware)
CREATE TABLE role_permissions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id    TINYINT UNSIGNED NOT NULL,
  module     VARCHAR(50) NOT NULL,          -- e.g. 'indent','batching','packing'
  can_view   BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit   BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY uq_role_module (role_id, module),
  FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  mobile        VARCHAR(15),
  email         VARCHAR(100),
  role_id       TINYINT UNSIGNED NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

-- ---------- 2. Masters ----------
CREATE TABLE material_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE materials (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  material_code  VARCHAR(20) NOT NULL UNIQUE,         -- auto: MAT-0001
  material_name  VARCHAR(150) NOT NULL,
  sku            VARCHAR(50) UNIQUE,
  place          VARCHAR(100) NULL,                   -- Material Card: PLACE (rack / godown location)
  category_id    INT UNSIGNED NOT NULL,
  unit           ENUM('KG','GRAM','NOS','LITRE','BAGS') NOT NULL,
  opening_stock  DECIMAL(14,3) NOT NULL DEFAULT 0,
  minimum_stock  DECIMAL(14,3) NOT NULL DEFAULT 0,
  purchase_rate  DECIMAL(12,2) NOT NULL DEFAULT 0,
  current_stock  DECIMAL(14,3) NOT NULL DEFAULT 0,    -- maintained by transactions
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     INT UNSIGNED, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_mat_stock CHECK (current_stock >= 0),
  FOREIGN KEY (category_id) REFERENCES material_categories(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_mat_name (material_name)
) ENGINE=InnoDB;

CREATE TABLE vendors (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vendor_code    VARCHAR(20) NOT NULL UNIQUE,         -- auto: VEN-0001
  vendor_name    VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100),
  mobile         VARCHAR(15),
  email          VARCHAR(100),
  address        TEXT,
  gst_number     VARCHAR(15),
  payment_terms  VARCHAR(100),
  status         ENUM('ACTIVE','INACTIVE','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- 3. Indent ----------
CREATE TABLE indent_master (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  indent_no     VARCHAR(25) NOT NULL UNIQUE,          -- IND-2026-0001
  indent_date   DATE NOT NULL,
  department    VARCHAR(80) NOT NULL,
  purpose       VARCHAR(255),
  requested_by  INT UNSIGNED NOT NULL,
  approved_by   INT UNSIGNED NULL,
  approved_at   DATETIME NULL,
  status        ENUM('DRAFT','PENDING','APPROVED','REJECTED','QUOTATION_RECEIVED','PO_CREATED','CLOSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  remarks       VARCHAR(255),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_indent_status (status, indent_date)
) ENGINE=InnoDB;

CREATE TABLE indent_details (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  indent_id            INT UNSIGNED NOT NULL,
  material_id          INT UNSIGNED NULL,             -- NULL allowed for new/unlisted item
  material_description VARCHAR(255) NOT NULL,
  preferred_vendor_id  INT UNSIGNED NULL,
  preferred_source     VARCHAR(150),                  -- manufacturer / distributor text
  existing_functional_qty     DECIMAL(14,3) NOT NULL DEFAULT 0,
  existing_non_functional_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  required_qty         DECIMAL(14,3) NOT NULL,
  required_delivery_date DATE,
  purpose              VARCHAR(255),
  FOREIGN KEY (indent_id) REFERENCES indent_master(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (preferred_vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB;

-- ---------- 4. Quotation ----------
CREATE TABLE quotation_master (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_no   VARCHAR(25) NOT NULL UNIQUE,
  indent_id      INT UNSIGNED NOT NULL,
  vendor_id      INT UNSIGNED NOT NULL,
  quotation_date DATE NOT NULL,
  vendor_ref_no  VARCHAR(50),
  valid_until    DATE,
  additional_charges DECIMAL(12,2) NOT NULL DEFAULT 0,  -- freight, loading, etc.
  charges_note   VARCHAR(150),
  sub_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  gst_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  status         ENUM('SUBMITTED','APPROVED','REJECTED','PO_CREATED','CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
  approved_by    INT UNSIGNED NULL,
  approved_at    DATETIME NULL,
  remarks        VARCHAR(255),
  created_by     INT UNSIGNED NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (indent_id) REFERENCES indent_master(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_quo_indent (indent_id, status)
) ENGINE=InnoDB;
-- Business rule (service layer): only ONE quotation per indent may be APPROVED.

CREATE TABLE quotation_details (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id    INT UNSIGNED NOT NULL,
  indent_detail_id INT UNSIGNED NOT NULL,
  material_id     INT UNSIGNED NULL,
  material_description VARCHAR(255) NOT NULL,
  quantity        DECIMAL(14,3) NOT NULL,
  rate            DECIMAL(12,2) NOT NULL,
  gst_percent     DECIMAL(5,2) NOT NULL DEFAULT 0,
  line_amount     DECIMAL(14,2) NOT NULL,             -- qty * rate
  gst_amount      DECIMAL(14,2) NOT NULL,
  line_total      DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (quotation_id) REFERENCES quotation_master(id) ON DELETE CASCADE,
  FOREIGN KEY (indent_detail_id) REFERENCES indent_details(id),
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB;

-- ---------- 5. Purchase Order ----------
CREATE TABLE purchase_order_master (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_number      VARCHAR(25) NOT NULL UNIQUE,
  po_date        DATE NOT NULL,
  indent_id      INT UNSIGNED NOT NULL,
  quotation_id   INT UNSIGNED NOT NULL UNIQUE,        -- one PO per approved quotation
  vendor_id      INT UNSIGNED NOT NULL,
  delivery_date  DATE,
  payment_terms  VARCHAR(100),
  delivery_address TEXT,
  sub_total      DECIMAL(14,2) NOT NULL,
  gst_total      DECIMAL(14,2) NOT NULL,
  additional_charges DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount   DECIMAL(14,2) NOT NULL,
  status         ENUM('DRAFT','ISSUED','PARTIALLY_RECEIVED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ISSUED',
  notes          VARCHAR(255),
  created_by     INT UNSIGNED NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (indent_id) REFERENCES indent_master(id),
  FOREIGN KEY (quotation_id) REFERENCES quotation_master(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE purchase_order_details (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_id         INT UNSIGNED NOT NULL,
  material_id   INT UNSIGNED NULL,
  material_description VARCHAR(255) NOT NULL,
  ordered_qty   DECIMAL(14,3) NOT NULL,
  rate          DECIMAL(12,2) NOT NULL,
  gst_percent   DECIMAL(5,2) NOT NULL DEFAULT 0,
  gst_amount    DECIMAL(14,2) NOT NULL,
  line_total    DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (po_id) REFERENCES purchase_order_master(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB;

-- ---------- 6. Raw material stock card (ledger) ----------
-- This table IS the digital Material Card. Manual inward / issue entries only (no GRN).
CREATE TABLE material_stock_transactions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  material_id     INT UNSIGNED NOT NULL,
  txn_date        DATE NOT NULL,
  txn_type        ENUM('OPENING','INWARD','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT') NOT NULL,
  opening_stock   DECIMAL(14,3) NOT NULL,             -- balance before this txn
  inward_qty      DECIMAL(14,3) NOT NULL DEFAULT 0,
  total_qty       DECIMAL(14,3) NOT NULL,             -- opening + inward
  despatch_qty    DECIMAL(14,3) NOT NULL DEFAULT 0,   -- issue
  closing_stock   DECIMAL(14,3) NOT NULL,             -- total - despatch
  agency_supplier VARCHAR(150),
  vendor_id       INT UNSIGNED NULL,
  purpose         VARCHAR(255),
  reference_type  ENUM('MANUAL','PO','BATCH','ADJUSTMENT') NOT NULL DEFAULT 'MANUAL',
  reference_no    VARCHAR(50),                        -- invoice / challan / PO / batch no
  po_id           INT UNSIGNED NULL,
  batch_id        INT UNSIGNED NULL,
  entered_by      INT UNSIGNED NOT NULL,
  remarks         VARCHAR(255),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_txn_closing CHECK (closing_stock >= 0),
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (po_id) REFERENCES purchase_order_master(id),
  FOREIGN KEY (entered_by) REFERENCES users(id),
  INDEX idx_mst_mat_date (material_id, txn_date, id),
  INDEX idx_mst_date (txn_date)
) ENGINE=InnoDB;

-- ---------- 7. Machines ----------
CREATE TABLE machine_master (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_code     VARCHAR(20) NOT NULL UNIQUE,
  machine_name     VARCHAR(100) NOT NULL,
  machine_type     ENUM('ROASTING','GRINDING','BLENDING','PACKING','WEIGHING') NOT NULL,
  manufacturer     VARCHAR(100),
  capacity         DECIMAL(12,2),
  capacity_unit    VARCHAR(20) DEFAULT 'KG/HR',
  status           ENUM('ACTIVE','IDLE','UNDER_MAINTENANCE','BREAKDOWN','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  installation_date DATE,
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  operator_id      INT UNSIGNED NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES users(id),
  INDEX idx_machine_type (machine_type, status)
) ENGINE=InnoDB;

CREATE TABLE machine_maintenance (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_id      INT UNSIGNED NOT NULL,
  record_type     ENUM('PREVENTIVE','BREAKDOWN','CALIBRATION','DOWNTIME') NOT NULL,
  start_time      DATETIME NOT NULL,
  end_time        DATETIME NULL,
  downtime_minutes INT UNSIGNED NULL,
  description     VARCHAR(255),
  cost            DECIMAL(12,2) DEFAULT 0,
  performed_by    VARCHAR(100),
  next_due_date   DATE,
  created_by      INT UNSIGNED NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Manual machine counter readings. Source column keeps room for future hardware feeds.
CREATE TABLE machine_counter_readings (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_id     INT UNSIGNED NOT NULL,
  batch_id       INT UNSIGNED NULL,
  reading_time   DATETIME NOT NULL,
  production_count INT UNSIGNED,
  auger_count    INT UNSIGNED,
  puller_count   INT UNSIGNED,
  source         ENUM('MANUAL','DEVICE') NOT NULL DEFAULT 'MANUAL',
  entered_by     INT UNSIGNED NOT NULL,
  FOREIGN KEY (machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (entered_by) REFERENCES users(id),
  INDEX idx_mcr_machine (machine_id, reading_time)
) ENGINE=InnoDB;

-- ---------- 8. Products, MRP and bag rates ----------
CREATE TABLE product_master (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_code  VARCHAR(20) NOT NULL UNIQUE,
  product_name  VARCHAR(120) NOT NULL,
  category      VARCHAR(80),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- One row per product + pack size. Current prices live here.
CREATE TABLE product_packing_rates (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id      INT UNSIGNED NOT NULL,
  sku_code        VARCHAR(30) NOT NULL UNIQUE,        -- e.g. TUR-100G
  packing_size_label VARCHAR(20) NOT NULL,            -- '13 GM','1 KG'
  weight_grams    DECIMAL(10,2) NOT NULL,
  mrp             DECIMAL(10,2) NOT NULL,
  bag_rate        DECIMAL(10,2) NOT NULL,
  production_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  bag_material_cost DECIMAL(10,4) NOT NULL DEFAULT 0, -- cost of one empty pouch
  price_per_kg    DECIMAL(10,2) GENERATED ALWAYS AS (ROUND(mrp * 1000 / weight_grams, 2)) STORED,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_product_size (product_id, weight_grams),
  FOREIGN KEY (product_id) REFERENCES product_master(id)
) ENGINE=InnoDB;

-- Every change to MRP / bag rate is archived here; production rows also store snapshots.
CREATE TABLE product_rate_history (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  packing_rate_id INT UNSIGNED NOT NULL,
  old_mrp DECIMAL(10,2), new_mrp DECIMAL(10,2),
  old_bag_rate DECIMAL(10,2), new_bag_rate DECIMAL(10,2),
  old_production_rate DECIMAL(10,2), new_production_rate DECIMAL(10,2),
  effective_from DATE NOT NULL,
  changed_by    INT UNSIGNED NOT NULL,
  changed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (packing_rate_id) REFERENCES product_packing_rates(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------- 9. Recipes ----------
CREATE TABLE recipe_master (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipe_no     VARCHAR(25) NOT NULL UNIQUE,
  product_id    INT UNSIGNED NOT NULL,
  version_no    SMALLINT NOT NULL DEFAULT 1,
  base_quantity_kg DECIMAL(12,3) NOT NULL,            -- batch size this recipe is defined for
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    INT UNSIGNED NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES product_master(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE recipe_details (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipe_id     INT UNSIGNED NOT NULL,
  material_id   INT UNSIGNED NOT NULL,
  quantity_kg   DECIMAL(12,3) NOT NULL,
  percentage    DECIMAL(6,3),
  FOREIGN KEY (recipe_id) REFERENCES recipe_master(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB;

-- ---------- 10. Production: batch backbone ----------
CREATE TABLE batch_master (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_no      VARCHAR(25) NOT NULL UNIQUE,          -- BAT-20261106-001
  production_date DATE NOT NULL,
  product_id    INT UNSIGNED NOT NULL,
  recipe_id     INT UNSIGNED NULL,
  planned_qty_kg DECIMAL(12,3) NOT NULL,
  current_stage ENUM('BATCHING','ROASTING','GRINDING','BLENDING','PACKING','COMPLETED') NOT NULL DEFAULT 'BATCHING',
  status        ENUM('OPEN','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  current_output_kg DECIMAL(12,3) NOT NULL DEFAULT 0, -- weight handed to next stage
  total_wastage_kg  DECIMAL(12,3) NOT NULL DEFAULT 0,
  created_by    INT UNSIGNED NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME NULL,
  FOREIGN KEY (product_id) REFERENCES product_master(id),
  FOREIGN KEY (recipe_id) REFERENCES recipe_master(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_batch_date (production_date, current_stage)
) ENGINE=InnoDB;

-- Batching: header + multiple raw materials
CREATE TABLE batching_details (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id      INT UNSIGNED NOT NULL,
  entry_date    DATE NOT NULL,                        -- form: DATE
  material_id   INT UNSIGNED NOT NULL,                -- form: MATERIAL CODE / MATERIAL NAME
  no_of_bags    INT UNSIGNED NOT NULL,                -- form: NO OF BAGS
  weight_per_bag DECIMAL(12,3) NOT NULL,              -- form: WEIGHT (kg per bag)
  required_qty  DECIMAL(12,3) GENERATED ALWAYS AS (no_of_bags * weight_per_bag) STORED,
  weighed_qty   DECIMAL(12,3) NOT NULL,               -- form: WEIGHED QTY (actual scale reading)
  weighing_machine_id INT UNSIGNED NULL,
  stock_txn_id  BIGINT UNSIGNED NULL,                 -- ledger row that reduced raw stock
  done_by       INT UNSIGNED NOT NULL,                -- form: DONE BY
  checked_by    INT UNSIGNED NULL,                    -- form: CHECKED BY
  start_time    DATETIME NULL,
  end_time      DATETIME NULL,
  status        ENUM('PENDING','IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'COMPLETED',
  FOREIGN KEY (batch_id) REFERENCES batch_master(id),
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (weighing_machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (stock_txn_id) REFERENCES material_stock_transactions(id),
  FOREIGN KEY (done_by) REFERENCES users(id),
  FOREIGN KEY (checked_by) REFERENCES users(id),
  INDEX idx_batching_batch (batch_id)
) ENGINE=InnoDB;

CREATE TABLE roasting_details (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id      INT UNSIGNED NOT NULL,
  roast_date    DATE NOT NULL,                        -- form: DATE
  machine_id    INT UNSIGNED NOT NULL,                -- form: MACHINE
  code_no       VARCHAR(30) NULL,                     -- form: CODE NO
  input_weight  DECIMAL(12,3) NOT NULL,               -- form: I/P (Kg)
  output_weight DECIMAL(12,3) NULL,                   -- form: O/P (Kg)
  temp_before   DECIMAL(6,1) NULL,                    -- form: Before Roasting TEMP
  std_temp      DECIMAL(6,1) NULL,                    -- form: STD TEMP
  temp_after    DECIMAL(6,1) NULL,                    -- form: After Roasting TEMP
  start_time    DATETIME NOT NULL,                    -- form: Start Time
  end_time      DATETIME NULL,                        -- form: End Time
  running_hours DECIMAL(6,2) NULL,                    -- form: Running Hours (end - start)
  wastage_weight DECIMAL(12,3) NULL,                  -- input - output
  loss_percent  DECIMAL(6,2) NULL,                    -- form: Loss % = wastage / input * 100
  operator_id   INT UNSIGNED NOT NULL,
  incharge_id   INT UNSIGNED NULL,                    -- form: Incharge
  remarks       VARCHAR(255),
  status        ENUM('IN_PROGRESS','COMPLETED','REJECTED') NOT NULL DEFAULT 'IN_PROGRESS',
  FOREIGN KEY (batch_id) REFERENCES batch_master(id),
  FOREIGN KEY (machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (operator_id) REFERENCES users(id),
  FOREIGN KEY (incharge_id) REFERENCES users(id),
  INDEX idx_roast_machine (machine_id, start_time)
) ENGINE=InnoDB;

CREATE TABLE grinding_details (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id      INT UNSIGNED NOT NULL,                -- form: BATCH CODE + PRODUCT (via batch_master)
  grind_date    DATE NOT NULL,                        -- form: DATE
  machine_id    INT UNSIGNED NOT NULL,
  mesh_size     VARCHAR(20) NULL,                     -- form: MESH SIZE
  input_weight  DECIMAL(12,3) NOT NULL,               -- form: I/P WT
  output_weight DECIMAL(12,3) NULL,                   -- form: O/P WT
  siever        VARCHAR(50) NULL,                     -- form: SIEVER
  input_time    DATETIME NOT NULL,                    -- form: I/P TIME
  output_time   DATETIME NULL,                        -- form: O/P TIME
  wastage_weight DECIMAL(12,3) NULL,
  loss_percent  DECIMAL(6,2) NULL,                    -- form: LOSS%
  operator_id   INT UNSIGNED NOT NULL,                -- form: SIGN (digital sign = logged-in user)
  remarks       VARCHAR(255),
  status        ENUM('IN_PROGRESS','COMPLETED','REJECTED') NOT NULL DEFAULT 'IN_PROGRESS',
  FOREIGN KEY (batch_id) REFERENCES batch_master(id),
  FOREIGN KEY (machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (operator_id) REFERENCES users(id),
  INDEX idx_grind_machine (machine_id, input_time)
) ENGINE=InnoDB;

-- Blending header-level row; ingredient lines in blending_ingredients
CREATE TABLE blending_details (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id      INT UNSIGNED NOT NULL,
  recipe_id     INT UNSIGNED NOT NULL,
  machine_id    INT UNSIGNED NOT NULL,
  operator_id   INT UNSIGNED NOT NULL,
  total_input_weight DECIMAL(12,3) NOT NULL,
  mixing_duration_min INT UNSIGNED,
  start_time    DATETIME NOT NULL,
  end_time      DATETIME NULL,
  output_weight DECIMAL(12,3) NULL,
  wastage_weight DECIMAL(12,3) NULL,
  status        ENUM('IN_PROGRESS','COMPLETED','REJECTED') NOT NULL DEFAULT 'IN_PROGRESS',
  remarks       VARCHAR(255),
  FOREIGN KEY (batch_id) REFERENCES batch_master(id),
  FOREIGN KEY (recipe_id) REFERENCES recipe_master(id),
  FOREIGN KEY (machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE blending_ingredients (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  blending_id   INT UNSIGNED NOT NULL,
  entry_date    DATE NOT NULL,                        -- form: DATE
  material_id   INT UNSIGNED NULL,                    -- form: MATERIAL CODE (NULL if ingredient is the ground batch)
  ingredient_name VARCHAR(150) NOT NULL,              -- form: MATERIAL NAME
  no_of_bags    INT UNSIGNED NOT NULL DEFAULT 0,      -- form: NO OF BAGS
  weight_per_bag DECIMAL(12,3) NULL,                  -- form: WEIGHT
  ingredient_weight DECIMAL(12,3) NOT NULL,           -- form: WEIGHED QTY
  done_by       INT UNSIGNED NOT NULL,                -- form: DONE BY
  checked_by    INT UNSIGNED NULL,                    -- form: CHECKED BY
  stock_txn_id  BIGINT UNSIGNED NULL,
  FOREIGN KEY (blending_id) REFERENCES blending_details(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (stock_txn_id) REFERENCES material_stock_transactions(id),
  FOREIGN KEY (done_by) REFERENCES users(id),
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------- 11. Packing ----------
-- Rates are SNAPSHOTS so later MRP/bag-rate edits never alter history.
CREATE TABLE packing_details (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  packing_date   DATE NOT NULL,
  batch_id       INT UNSIGNED NOT NULL,
  product_id     INT UNSIGNED NOT NULL,
  packing_rate_id INT UNSIGNED NOT NULL,              -- pack size used
  machine_id     INT UNSIGNED NOT NULL,
  bag_size_grams DECIMAL(10,2) NOT NULL,
  mrp_snapshot   DECIMAL(10,2) NOT NULL,
  bag_rate_snapshot DECIMAL(10,2) NOT NULL,
  bag_material_cost_snapshot DECIMAL(10,4) NOT NULL DEFAULT 0,
  production_rate_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0,
  target_weight  DECIMAL(10,2) NOT NULL,
  actual_weight  DECIMAL(10,2) NOT NULL,              -- avg/sample scale reading
  total_bag_count INT UNSIGNED NOT NULL,
  rejected_bag_count INT UNSIGNED NOT NULL DEFAULT 0,
  accepted_bag_count INT UNSIGNED NOT NULL,           -- total - rejected
  total_packing_weight DECIMAL(12,3) NOT NULL,
  rejected_weight DECIMAL(12,3) NOT NULL DEFAULT 0,
  accepted_weight DECIMAL(12,3) NOT NULL,
  total_bag_material_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  production_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  auger_count    INT UNSIGNED,
  puller_count   INT UNSIGNED,
  production_count INT UNSIGNED,
  operator_id    INT UNSIGNED NOT NULL,
  status         ENUM('IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
  remarks        VARCHAR(255),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batch_master(id),
  FOREIGN KEY (product_id) REFERENCES product_master(id),
  FOREIGN KEY (packing_rate_id) REFERENCES product_packing_rates(id),
  FOREIGN KEY (machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (operator_id) REFERENCES users(id),
  INDEX idx_pack_date (packing_date),
  INDEX idx_pack_batch (batch_id)
) ENGINE=InnoDB;

-- Manual scale readings (sample checks during a packing run)
CREATE TABLE weighing_records (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  packing_id     INT UNSIGNED NOT NULL,
  weighing_machine_id INT UNSIGNED NULL,
  reading_time   DATETIME NOT NULL,
  target_weight  DECIMAL(10,2) NOT NULL,
  actual_weight  DECIMAL(10,2) NOT NULL,
  deviation      DECIMAL(10,2) GENERATED ALWAYS AS (actual_weight - target_weight) STORED,
  source         ENUM('MANUAL','DEVICE') NOT NULL DEFAULT 'MANUAL',
  entered_by     INT UNSIGNED NOT NULL,
  FOREIGN KEY (packing_id) REFERENCES packing_details(id) ON DELETE CASCADE,
  FOREIGN KEY (weighing_machine_id) REFERENCES machine_master(id),
  FOREIGN KEY (entered_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------- 12. Finished goods ----------
CREATE TABLE finished_goods_stock (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id     INT UNSIGNED NOT NULL,
  packing_rate_id INT UNSIGNED NOT NULL,
  batch_id       INT UNSIGNED NOT NULL,
  produced_qty   INT UNSIGNED NOT NULL DEFAULT 0,     -- bags
  stock_inward   INT UNSIGNED NOT NULL DEFAULT 0,
  stock_outward  INT UNSIGNED NOT NULL DEFAULT 0,
  available_qty  INT UNSIGNED NOT NULL DEFAULT 0,
  closing_stock  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fg (batch_id, packing_rate_id),
  FOREIGN KEY (product_id) REFERENCES product_master(id),
  FOREIGN KEY (packing_rate_id) REFERENCES product_packing_rates(id),
  FOREIGN KEY (batch_id) REFERENCES batch_master(id)
) ENGINE=InnoDB;

-- Ledger for finished goods movements (inward from packing, outward on dispatch/adjustment)
CREATE TABLE finished_goods_transactions (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fg_stock_id    INT UNSIGNED NOT NULL,
  txn_date       DATE NOT NULL,
  txn_type       ENUM('INWARD','OUTWARD','ADJUSTMENT') NOT NULL,
  quantity       INT NOT NULL,
  reference_no   VARCHAR(50),
  packing_id     INT UNSIGNED NULL,
  entered_by     INT UNSIGNED NOT NULL,
  remarks        VARCHAR(255),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fg_stock_id) REFERENCES finished_goods_stock(id),
  FOREIGN KEY (packing_id) REFERENCES packing_details(id),
  FOREIGN KEY (entered_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------- 13. Audit ----------
CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NULL,
  action       ENUM('CREATE','UPDATE','DELETE','APPROVE','LOGIN','STATUS_CHANGE') NOT NULL,
  table_name   VARCHAR(60) NOT NULL,
  record_id    VARCHAR(40),
  old_values   JSON NULL,
  new_values   JSON NULL,
  ip_address   VARCHAR(45),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_table (table_name, record_id),
  INDEX idx_audit_user (user_id, created_at)
) ENGINE=InnoDB;

-- ---------- Material Card view (matches the paper MATERIAL CARD) ----------
-- Header: MATERIAL NAME, PLACE. Columns: S.NO, DATE, CODE, PURPOSE, ISSUE, RECEIVED, BALANCE, SIGN
CREATE OR REPLACE VIEW v_material_card AS
SELECT t.material_id, m.material_name, m.place,
       ROW_NUMBER() OVER (PARTITION BY t.material_id ORDER BY t.txn_date, t.id) AS s_no,
       t.txn_date AS `date`, m.material_code AS code, t.purpose,
       t.despatch_qty AS issue, t.inward_qty AS received, t.closing_stock AS balance,
       u.full_name AS sign
FROM material_stock_transactions t
JOIN materials m ON m.id = t.material_id
JOIN users u ON u.id = t.entered_by;

-- ---------- Seed data ----------
INSERT INTO roles (role_name) VALUES
 ('Admin'),('Purchase Department'),('Store Incharge'),('Production Incharge'),
 ('Batching Operator'),('Roasting Operator'),('Grinding Operator'),
 ('Blending Operator'),('Packing Operator');

INSERT INTO document_sequences (series_code, prefix, year_scope, pad_length) VALUES
 ('MATERIAL','MAT-',NULL,4),('VENDOR','VEN-',NULL,4),('PRODUCT','PRD-',NULL,4),
 ('MACHINE','MCH-',NULL,3),('INDENT','IND-',YEAR(CURDATE()),4),
 ('QUOTATION','QUO-',YEAR(CURDATE()),4),('PO','PO-',YEAR(CURDATE()),4),
 ('BATCH','BAT-',YEAR(CURDATE()),5),('RECIPE','RCP-',NULL,4);
