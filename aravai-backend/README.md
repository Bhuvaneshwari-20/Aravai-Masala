# Aravai Backend - Phase 1
1. `mysql -u root -p < aravai_schema.sql`
2. `mysql -u root -p < aravai_migration_v2.sql`   (only on a DB created from schema v1)
3. `mysql -u root -p < aravai_migration_v3.sql`   (adds the Material / Vendor / Indent / Quotation / PO / Stock columns; safe to re-run)
3b. `mysql -u root -p < aravai_migration_v4.sql` then `mysql -u root -p < aravai_migration_v5.sql`   (v5 = receipt / product / recipe / batch start / batching; safe to re-run)
4. `cp .env.example .env` and edit DB + JWT_SECRET
5. `npm install && npm run seed && npm run dev`   (run `npm run seed` again after v5: it adds the new role permissions)
6. Test: POST /api/v1/auth/login {"username":"admin","password":"Admin@123"}
Change the admin password after first login.

## What migration v3 adds
- Material: `material_specifications` table (many specs per material)
- Vendor: ref_no, account_name, opening_balance, account_group, md_name, landline, sms, place, street, city, state, pin_code, pan_no, bank_name, bank_branch, bank_account_no, ifsc_code + `vendor_materials` (materials supplied)
- Indent: account_type, order_type (master); category_id, specification, specification_remarks, material_units, issued_qty, available_qty (auto), items_to_purchase (auto)
- Quotation: is_best_vendor, pdf_path (master); unit, required_qty, disc_percent, disc_amount, remark, is_best_price, is_chosen (details)
- Purchase Order: account_type, subject, po_type, purchase_type, advance_amount, payment_days, standard_terms, additional_terms (master); category_id, unit, gross_amount, discount_percent, discount_amount (details)
- Stock (material_stock_transactions): specification, functional_qty, non_functional_qty, indent_id, grn_no, issue_type

## Migration v5 + APIs: Material receipt -> Batching
- Material: `default_filter_stages` (Coriander = 3). Recipe: `default_filter_stages` (overrides the material default when > 0)
- Batch: `FILTERING` stage, `ON_HOLD` status, `active_lock` (UNIQUE) = only one active batch; hold keeps the lock
- `batching_details` unique (batch, material) = a material is weighed once per batch

| Step | Endpoint | Permission |
|---|---|---|
| A1 Material receipt | `POST /stock/receipts` {material_id, vendor_id, reference_no, quantity, txn_date} | stock:create |
| A3 Issue / correction | `POST /stock/issues`, `POST /stock/adjustments` | stock:create / edit |
| A2 Material Card | `GET /stock/card/:materialId?from&to&order` | stock:view |
| A3 Low stock | `GET /stock/low-stock` (receipt / issue / batching responses also carry `low_stock_alert`) | stock:view |
| B4 Product + packs + MRP | `POST /products`, `PUT /products/:id`, `POST /products/:id/packs`, `PUT /products/:id/packs/:packId` | product:* |
| B4/B5 Recipe | `POST /recipes` (new version; ingredients must add up to base qty), `GET /recipes`, `PATCH /recipes/:id/status` | recipe:* |
| C6 Start batch | `POST /batches` {product_id, recipe_id, planned_qty_kg}; `GET /batches/active` | batching:create / view |
| C7 Batching | `POST /batches/:id/batching` {material_id, no_of_bags, weight_per_bag, weighed_qty, done_by?, checked_by}; `POST /batches/:id/batching/complete` | batching:create / edit |
| Hold / resume | `PATCH /batches/:id/hold` {reason}, `PATCH /batches/:id/resume` | batching:approve |
| History | `GET /batches/:id` (header + recipe plan + what was weighed, by whom) | batching:view |

Rules enforced: stock never below 0; receipt/issue/batching change stock only through one transaction function; duplicate invoice (vendor + invoice + material) and double weighing are rejected;
batching only while batch is IN_PROGRESS and in BATCHING stage; "Checked by" must differ from "Done by"; complete batching only after every recipe ingredient is weighed;
after completion the batch moves to FILTERING with `current_output_kg` = total weighed (the input of the next stage) and keeps the lock.
