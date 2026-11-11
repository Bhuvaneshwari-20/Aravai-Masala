-- Migration v3: add the Material / Vendor / Indent / Quotation / Purchase Order / Stock columns.
-- Run on the DB that already has schema v1 + migration v2 (MariaDB 10.4+).  Safe to re-run: every column/table uses IF NOT EXISTS.
-- Foreign keys are added only when missing (checked via information_schema) so a second run does not fail.
USE aravai_masala;

-- =====================================================================
-- 1. MATERIAL MASTER  (no Group column: the existing "Category" is untouched)
--    Material Name = materials.material_name, Unit = materials.unit  (already exist)
--    Specifications = new child table (one material -> many specs)
-- =====================================================================
CREATE TABLE IF NOT EXISTS material_specifications (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  material_id INT UNSIGNED NOT NULL,
  spec_value  VARCHAR(255) NOT NULL,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_matspec_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  INDEX idx_matspec_material (material_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 2. VENDOR
--    already there: vendor_name, contact_person, mobile, email, gst_number, address (+ vendor_code, payment_terms, status)
-- =====================================================================
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS ref_no           VARCHAR(30)   NULL AFTER vendor_name,
  ADD COLUMN IF NOT EXISTS account_name     VARCHAR(150)  NULL AFTER ref_no,
  ADD COLUMN IF NOT EXISTS opening_balance  DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER account_name,
  ADD COLUMN IF NOT EXISTS account_group    VARCHAR(100)  NULL AFTER opening_balance,
  ADD COLUMN IF NOT EXISTS md_name          VARCHAR(100)  NULL AFTER contact_person,
  ADD COLUMN IF NOT EXISTS landline         VARCHAR(20)   NULL AFTER mobile,
  ADD COLUMN IF NOT EXISTS sms              VARCHAR(15)   NULL AFTER landline,
  ADD COLUMN IF NOT EXISTS place            VARCHAR(100)  NULL AFTER address,
  ADD COLUMN IF NOT EXISTS street           VARCHAR(150)  NULL AFTER place,
  ADD COLUMN IF NOT EXISTS city             VARCHAR(80)   NULL AFTER street,
  ADD COLUMN IF NOT EXISTS state            VARCHAR(80)   NULL AFTER city,
  ADD COLUMN IF NOT EXISTS pin_code         VARCHAR(10)   NULL AFTER state,
  ADD COLUMN IF NOT EXISTS pan_no           VARCHAR(10)   NULL AFTER gst_number,
  ADD COLUMN IF NOT EXISTS bank_name        VARCHAR(100)  NULL AFTER pan_no,
  ADD COLUMN IF NOT EXISTS bank_branch      VARCHAR(100)  NULL AFTER bank_name,
  ADD COLUMN IF NOT EXISTS bank_account_no  VARCHAR(30)   NULL AFTER bank_branch,
  ADD COLUMN IF NOT EXISTS ifsc_code        VARCHAR(11)   NULL AFTER bank_account_no;

-- Materials supplied by the vendor (Group = the material's category, so no separate group column)
CREATE TABLE IF NOT EXISTS vendor_materials (
  vendor_id   INT UNSIGNED NOT NULL,
  material_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (vendor_id, material_id),
  CONSTRAINT fk_vendmat_vendor   FOREIGN KEY (vendor_id)   REFERENCES vendors(id)   ON DELETE CASCADE,
  CONSTRAINT fk_vendmat_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  INDEX idx_vendmat_material (material_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 3. INDENT
--    already there: indent_no, department (=Dept), status, material (id/description), required_qty,
--                   required_delivery_date (=Required Date)
-- =====================================================================
ALTER TABLE indent_master
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) NULL AFTER indent_date,
  ADD COLUMN IF NOT EXISTS order_type   VARCHAR(50) NULL AFTER account_type;

ALTER TABLE indent_details
  ADD COLUMN IF NOT EXISTS category_id           INT UNSIGNED  NULL AFTER material_id,           -- "Group"
  ADD COLUMN IF NOT EXISTS specification         VARCHAR(255)  NULL AFTER material_description,
  ADD COLUMN IF NOT EXISTS specification_remarks VARCHAR(255)  NULL AFTER specification,
  ADD COLUMN IF NOT EXISTS material_units        VARCHAR(20)   NULL AFTER specification_remarks,
  ADD COLUMN IF NOT EXISTS issued_qty            DECIMAL(14,3) NOT NULL DEFAULT 0.000 AFTER required_qty;
-- Available Qty / Items to Purchase are calculated, so they can never go out of sync:
--   available_qty     = existing functional + existing non-functional
--   items_to_purchase = required - available (never below 0)
ALTER TABLE indent_details
  ADD COLUMN IF NOT EXISTS available_qty DECIMAL(14,3)
    GENERATED ALWAYS AS (existing_functional_qty + existing_non_functional_qty) STORED,
  ADD COLUMN IF NOT EXISTS items_to_purchase DECIMAL(14,3)
    GENERATED ALWAYS AS (GREATEST(required_qty - (existing_functional_qty + existing_non_functional_qty), 0)) STORED;

-- =====================================================================
-- 4. QUOTATION
--    already there: quotation_master (indent_id, vendor_id, quotation_date, total_amount = Grand Total, remarks)
--                   quotation_details (quantity = Quoted Qty, rate = Unit Price, line_amount = Total Amount,
--                                      gst_percent, gst_amount, line_total = Net Total)
-- =====================================================================
ALTER TABLE quotation_master
  ADD COLUMN IF NOT EXISTS is_best_vendor TINYINT(1)   NOT NULL DEFAULT 0 AFTER total_amount,
  ADD COLUMN IF NOT EXISTS pdf_path       VARCHAR(255) NULL AFTER is_best_vendor;

ALTER TABLE quotation_details
  ADD COLUMN IF NOT EXISTS unit          VARCHAR(20)   NULL AFTER material_description,
  ADD COLUMN IF NOT EXISTS required_qty  DECIMAL(14,3) NOT NULL DEFAULT 0.000 AFTER unit,
  ADD COLUMN IF NOT EXISTS disc_percent  DECIMAL(5,2)  NOT NULL DEFAULT 0.00 AFTER line_amount,
  ADD COLUMN IF NOT EXISTS disc_amount   DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER disc_percent,
  ADD COLUMN IF NOT EXISTS remark        VARCHAR(255)  NULL,
  ADD COLUMN IF NOT EXISTS is_best_price TINYINT(1)    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_chosen     TINYINT(1)    NOT NULL DEFAULT 0;

-- =====================================================================
-- 5. PURCHASE ORDER
--    already there: po_number (=Order ID), indent_id, vendor_id, delivery_date, status, created_at,
--                   details: ordered_qty (=Qty), rate, gst_percent, gst_amount, line_total
-- =====================================================================
ALTER TABLE purchase_order_master
  ADD COLUMN IF NOT EXISTS account_type       VARCHAR(50)   NULL AFTER po_date,
  ADD COLUMN IF NOT EXISTS subject            VARCHAR(255)  NULL AFTER account_type,
  ADD COLUMN IF NOT EXISTS po_type            VARCHAR(50)   NULL AFTER subject,          -- "Type"
  ADD COLUMN IF NOT EXISTS purchase_type      VARCHAR(50)   NULL AFTER po_type,
  ADD COLUMN IF NOT EXISTS advance_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER purchase_type,
  ADD COLUMN IF NOT EXISTS payment_days       INT UNSIGNED  NULL AFTER payment_terms,
  ADD COLUMN IF NOT EXISTS standard_terms     TEXT          NULL AFTER payment_days,
  ADD COLUMN IF NOT EXISTS additional_terms   TEXT          NULL AFTER standard_terms;

ALTER TABLE purchase_order_details
  ADD COLUMN IF NOT EXISTS category_id      INT UNSIGNED  NULL AFTER material_id,           -- "Group Name"
  ADD COLUMN IF NOT EXISTS unit             VARCHAR(20)   NULL AFTER ordered_qty,
  ADD COLUMN IF NOT EXISTS gross_amount     DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER rate,
  ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2)  NOT NULL DEFAULT 0.00 AFTER gross_amount,
  ADD COLUMN IF NOT EXISTS discount_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER discount_percent;

-- =====================================================================
-- 6. STOCK  (ledger = material_stock_transactions; Group Name comes from materials.category_id)
--    already there: material_id, vendor_id, inward_qty / closing_stock (=Quantity), despatch_qty (=Issued Qty),
--                   txn_date (=Entry Date / Issued Date), remarks, po_id (=Order No)
-- =====================================================================
ALTER TABLE material_stock_transactions
  ADD COLUMN IF NOT EXISTS specification      VARCHAR(255)  NULL AFTER material_id,
  ADD COLUMN IF NOT EXISTS functional_qty     DECIMAL(14,3) NOT NULL DEFAULT 0.000 AFTER closing_stock,
  ADD COLUMN IF NOT EXISTS non_functional_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000 AFTER functional_qty,
  ADD COLUMN IF NOT EXISTS indent_id          INT UNSIGNED  NULL AFTER po_id,
  ADD COLUMN IF NOT EXISTS grn_no             VARCHAR(30)   NULL AFTER indent_id,
  ADD COLUMN IF NOT EXISTS issue_type         VARCHAR(50)   NULL AFTER despatch_qty;

-- =====================================================================
-- Foreign keys for the new reference columns (added only if missing)
-- =====================================================================
DROP PROCEDURE IF EXISTS _aravai_add_fk;
DELIMITER $$
CREATE PROCEDURE _aravai_add_fk(IN t VARCHAR(64), IN c VARCHAR(64), IN rt VARCHAR(64), IN fk VARCHAR(64))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
                 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = t AND CONSTRAINT_NAME = fk) THEN
    SET @s = CONCAT('ALTER TABLE `', t, '` ADD CONSTRAINT `', fk, '` FOREIGN KEY (`', c, '`) REFERENCES `', rt, '`(`id`)');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$
DELIMITER ;
CALL _aravai_add_fk('indent_details', 'category_id', 'material_categories', 'fk_indent_det_category');
CALL _aravai_add_fk('purchase_order_details', 'category_id', 'material_categories', 'fk_po_det_category');
CALL _aravai_add_fk('material_stock_transactions', 'indent_id', 'indent_master', 'fk_stock_txn_indent');
DROP PROCEDURE _aravai_add_fk;
