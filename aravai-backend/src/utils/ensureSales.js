// Sales module: makes sure its tables and number series exist. Runs at server start-up, safe to run any number of times.
// New tables (everything else - products, pack sizes/SKUs, finished goods stock - is REUSED, not duplicated):
//   sales_customers       Customer / Agency master
//   sales_invoices        one row per sales invoice (header)
//   sales_invoice_items   invoice lines (one product + SKU per line, many lines per invoice)
//   sales_returns         return header (refund / replacement + settlement status)
//   sales_return_items    returned lines
//   sales_stock_ledger    the "material card" of finished goods: every pack that leaves / re-enters stock because of a
//                         sale, return, replacement or cancellation, with the batch it came from and its cost at that time
// Stock itself is still kept in finished_goods_stock (+ finished_goods_transactions), exactly as Packing writes it.
module.exports = async function ensureSales(pool, log = console) {
  const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  const addColumn = async (table, col, ddl) => {
    const [[r]] = await pool.query('SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, col]);
    if (!Number(r.c)) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_customers (
      id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      customer_code  VARCHAR(20)  NOT NULL,
      customer_name  VARCHAR(150) NOT NULL,
      customer_type  ENUM('CUSTOMER','AGENCY') NOT NULL DEFAULT 'CUSTOMER',
      contact_person VARCHAR(100) DEFAULT NULL,
      mobile         VARCHAR(15)  DEFAULT NULL,
      email          VARCHAR(100) DEFAULT NULL,
      gst_number     VARCHAR(15)  DEFAULT NULL,
      address        VARCHAR(500) DEFAULT NULL,
      is_active      TINYINT(1)   NOT NULL DEFAULT 1,
      created_by     INT UNSIGNED DEFAULT NULL,
      created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sales_customer_code (customer_code),
      KEY idx_sales_customer_name (customer_name)
    ) ${T}`);

  // customer types (Wholesale / Distributor / Retail added) + city, for databases created before this change
  await pool.query("ALTER TABLE sales_customers MODIFY customer_type ENUM('CUSTOMER','AGENCY','WHOLESALE','DISTRIBUTOR','RETAIL') NOT NULL DEFAULT 'CUSTOMER'");
  await addColumn('sales_customers', 'city', 'VARCHAR(80) DEFAULT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_invoices (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      invoice_no    VARCHAR(30)  NOT NULL,
      invoice_date  DATE         NOT NULL,
      customer_id   INT UNSIGNED NOT NULL,
      total_qty     INT UNSIGNED NOT NULL DEFAULT 0,
      total_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      payment_mode  VARCHAR(20)  DEFAULT NULL,
      remarks       VARCHAR(255) DEFAULT NULL,
      status        ENUM('ACTIVE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
      cancelled_at  DATETIME     DEFAULT NULL,
      cancelled_by  INT UNSIGNED DEFAULT NULL,
      cancel_reason VARCHAR(255) DEFAULT NULL,
      created_by    INT UNSIGNED NOT NULL,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sales_invoice_no (invoice_no),
      KEY idx_sales_inv_date (invoice_date, status),
      KEY idx_sales_inv_customer (customer_id),
      CONSTRAINT fk_sales_inv_customer FOREIGN KEY (customer_id) REFERENCES sales_customers (id)
    ) ${T}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_invoice_items (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      invoice_id       INT UNSIGNED NOT NULL,
      product_id       INT UNSIGNED NOT NULL,
      packing_rate_id  INT UNSIGNED NOT NULL,
      qty              INT UNSIGNED NOT NULL,
      rate             DECIMAL(12,2) NOT NULL,
      amount           DECIMAL(14,2) NOT NULL,
      mrp_snapshot     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      cost_amount      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      returned_qty     INT UNSIGNED NOT NULL DEFAULT 0,
      refunded_amount  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      KEY idx_sii_invoice (invoice_id),
      KEY idx_sii_product (product_id),
      KEY idx_sii_rate (packing_rate_id),
      CONSTRAINT fk_sii_invoice FOREIGN KEY (invoice_id) REFERENCES sales_invoices (id),
      CONSTRAINT fk_sii_product FOREIGN KEY (product_id) REFERENCES product_master (id),
      CONSTRAINT fk_sii_rate FOREIGN KEY (packing_rate_id) REFERENCES product_packing_rates (id)
    ) ${T}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_returns (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      return_no     VARCHAR(30)  NOT NULL,
      return_date   DATE         NOT NULL,
      invoice_id    INT UNSIGNED NOT NULL,
      customer_id   INT UNSIGNED NOT NULL,
      resolution    ENUM('REFUND','REPLACEMENT') NOT NULL,
      settlement_status ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
      settled_at    DATETIME     DEFAULT NULL,
      total_qty     INT UNSIGNED NOT NULL DEFAULT 0,
      refund_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      remarks       VARCHAR(255) DEFAULT NULL,
      created_by    INT UNSIGNED NOT NULL,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sales_return_no (return_no),
      KEY idx_sales_ret_date (return_date),
      KEY idx_sales_ret_invoice (invoice_id),
      CONSTRAINT fk_sret_invoice FOREIGN KEY (invoice_id) REFERENCES sales_invoices (id),
      CONSTRAINT fk_sret_customer FOREIGN KEY (customer_id) REFERENCES sales_customers (id)
    ) ${T}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_return_items (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      return_id        INT UNSIGNED NOT NULL,
      invoice_item_id  INT UNSIGNED NOT NULL,
      product_id       INT UNSIGNED NOT NULL,
      packing_rate_id  INT UNSIGNED NOT NULL,
      qty              INT UNSIGNED NOT NULL,
      rate             DECIMAL(12,2) NOT NULL,
      amount           DECIMAL(14,2) NOT NULL,
      item_condition   ENUM('RESALEABLE','DAMAGED') NOT NULL DEFAULT 'RESALEABLE',
      reason           VARCHAR(150) NOT NULL,
      KEY idx_sri_return (return_id),
      KEY idx_sri_item (invoice_item_id),
      CONSTRAINT fk_sri_return FOREIGN KEY (return_id) REFERENCES sales_returns (id),
      CONSTRAINT fk_sri_item FOREIGN KEY (invoice_item_id) REFERENCES sales_invoice_items (id)
    ) ${T}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_stock_ledger (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      txn_date           DATE         NOT NULL,
      source_type        ENUM('SALE','RETURN','REPLACEMENT','CANCEL') NOT NULL,
      direction          ENUM('OUT','IN') NOT NULL,
      invoice_id         INT UNSIGNED DEFAULT NULL,
      invoice_item_id    INT UNSIGNED DEFAULT NULL,
      return_id          INT UNSIGNED DEFAULT NULL,
      return_item_id     INT UNSIGNED DEFAULT NULL,
      product_id         INT UNSIGNED NOT NULL,
      packing_rate_id    INT UNSIGNED NOT NULL,
      fg_stock_id        INT UNSIGNED NOT NULL,
      batch_id           INT UNSIGNED NOT NULL,
      qty                INT UNSIGNED NOT NULL,
      unit_material_cost DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
      unit_packing_cost  DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
      reference_no       VARCHAR(30)  DEFAULT NULL,
      entered_by         INT UNSIGNED NOT NULL,
      created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ssl_date (txn_date),
      KEY idx_ssl_invoice_item (invoice_item_id),
      KEY idx_ssl_return (return_id),
      KEY idx_ssl_rate (packing_rate_id, txn_date),
      KEY idx_ssl_fg (fg_stock_id)
    ) ${T}`);


  // Delivery / dispatch of a sales invoice. Stock is already issued when the invoice is saved, so a delivery only records
  // WHAT left (per invoice line), HOW (vehicle / courier) and WHEN it reached the customer. A line can be delivered in parts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_deliveries (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      delivery_no      VARCHAR(30)  NOT NULL,
      delivery_date    DATE         NOT NULL,
      invoice_id       INT UNSIGNED NOT NULL,
      customer_id      INT UNSIGNED NOT NULL,
      transport_mode   ENUM('OWN_VEHICLE','TRANSPORT','COURIER','CUSTOMER_PICKUP') NOT NULL DEFAULT 'OWN_VEHICLE',
      vehicle_no       VARCHAR(20)  DEFAULT NULL,
      driver_name      VARCHAR(100) DEFAULT NULL,
      driver_mobile    VARCHAR(15)  DEFAULT NULL,
      lr_no            VARCHAR(50)  DEFAULT NULL,
      delivery_address VARCHAR(500) DEFAULT NULL,
      total_qty        INT UNSIGNED NOT NULL DEFAULT 0,
      status           ENUM('DISPATCHED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'DISPATCHED',
      delivered_at     DATETIME     DEFAULT NULL,
      received_by      VARCHAR(100) DEFAULT NULL,
      remarks          VARCHAR(255) DEFAULT NULL,
      cancelled_at     DATETIME     DEFAULT NULL,
      cancel_reason    VARCHAR(255) DEFAULT NULL,
      created_by       INT UNSIGNED NOT NULL,
      created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sales_delivery_no (delivery_no),
      KEY idx_sdel_date (delivery_date, status),
      KEY idx_sdel_invoice (invoice_id),
      CONSTRAINT fk_sdel_invoice FOREIGN KEY (invoice_id) REFERENCES sales_invoices (id),
      CONSTRAINT fk_sdel_customer FOREIGN KEY (customer_id) REFERENCES sales_customers (id)
    ) ${T}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_delivery_items (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      delivery_id      INT UNSIGNED NOT NULL,
      invoice_item_id  INT UNSIGNED NOT NULL,
      packing_rate_id  INT UNSIGNED NOT NULL,
      qty              INT UNSIGNED NOT NULL,
      KEY idx_sdi_delivery (delivery_id),
      KEY idx_sdi_item (invoice_item_id),
      CONSTRAINT fk_sdi_delivery FOREIGN KEY (delivery_id) REFERENCES sales_deliveries (id),
      CONSTRAINT fk_sdi_item FOREIGN KEY (invoice_item_id) REFERENCES sales_invoice_items (id)
    ) ${T}`);

  // payment is collected when the goods are delivered (cash / UPI / bank / credit), so it is stored on the delivery
  await addColumn('sales_deliveries', 'payment_mode', 'VARCHAR(20) DEFAULT NULL');
  await addColumn('sales_deliveries', 'amount_collected', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00');
  await addColumn('sales_deliveries', 'payment_ref', 'VARCHAR(60) DEFAULT NULL');

  // number series (document_sequences: series_code, prefix, year_scope, last_number, pad_length)
  const year = new Date().getFullYear();
  const series = [['SALES_CUSTOMER', 'CUS-', null, 4], ['SALES_INVOICE', 'INV-', year, 4], ['SALES_RETURN', 'SRT-', year, 4], ['SALES_DELIVERY', 'DEL-', year, 4]];
  for (const [code, prefix, scope, pad] of series) {
    await pool.query(
      'INSERT INTO document_sequences (series_code, prefix, year_scope, last_number, pad_length) VALUES (?,?,?,0,?) ON DUPLICATE KEY UPDATE series_code = series_code',
      [code, prefix, scope, pad]);
  }
  log.log('Sales module: tables ready');
};
