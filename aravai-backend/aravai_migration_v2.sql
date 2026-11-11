-- Migration v2: align with Aravai's actual paper forms. Run ONLY on a DB created from schema v1.
-- WARNING: drops and recreates 4 tables (batching/roasting/grinding/blending_ingredients).
USE aravai_masala;
ALTER TABLE materials ADD COLUMN place VARCHAR(100) NULL AFTER sku;
DROP TABLE IF EXISTS blending_ingredients;
DROP TABLE IF EXISTS batching_details;
DROP TABLE IF EXISTS roasting_details;
DROP TABLE IF EXISTS grinding_details;

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
