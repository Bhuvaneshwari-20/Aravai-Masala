# Aravai Backend - Phase 1
1. `mysql -u root -p < aravai_schema.sql`
2. `mysql -u root -p < aravai_migration_v2.sql`   (only on a DB created from schema v1)
3. `mysql -u root -p < aravai_migration_v3.sql`   (adds the Material / Vendor / Indent / Quotation / PO / Stock columns; safe to re-run)
4. `cp .env.example .env` and edit DB + JWT_SECRET
5. `npm install && npm run seed && npm run dev`
6. Test: POST /api/v1/auth/login {"username":"admin","password":"Admin@123"}
Change the admin password after first login.

## What migration v3 adds
- Material: `material_specifications` table (many specs per material)
- Vendor: ref_no, account_name, opening_balance, account_group, md_name, landline, sms, place, street, city, state, pin_code, pan_no, bank_name, bank_branch, bank_account_no, ifsc_code + `vendor_materials` (materials supplied)
- Indent: account_type, order_type (master); category_id, specification, specification_remarks, material_units, issued_qty, available_qty (auto), items_to_purchase (auto)
- Quotation: is_best_vendor, pdf_path (master); unit, required_qty, disc_percent, disc_amount, remark, is_best_price, is_chosen (details)
- Purchase Order: account_type, subject, po_type, purchase_type, advance_amount, payment_days, standard_terms, additional_terms (master); category_id, unit, gross_amount, discount_percent, discount_amount (details)
- Stock (material_stock_transactions): specification, functional_qty, non_functional_qty, indent_id, grn_no, issue_type
