# Merge notes – Super Admin -> Admin -> User accounts added to the team project

Your account logic is unchanged:
- Super Admin creates / edits / activates / deactivates Admins
- Admin creates / edits / activates / deactivates Users (only the ones they created)
- Deactivated accounts cannot log in (clear message), passwords hashed, min 8 characters

## NEW files
aravai-backend/aravai_migration_v4.sql           users.created_by + roles "Super Admin" and "User"
aravai-backend/scripts/seedSuperAdmin.js         npm run seed:superadmin
aravai-backend/src/utils/roles.js                role name constants
aravai-backend/src/middleware/roles.js           allowRoles(...)
aravai-backend/src/services/accountService.js    YOUR LOGIC (create/list/update/active/summary)
aravai-backend/src/controllers/accountController.js
aravai-backend/src/routes/accounts.js            /api/v1/accounts
aravai-frontend/src/components/AccountFormModal.js
aravai-frontend/src/screens/users/AccountListScreen.js

## CHANGED teammate files (small edits)
backend  middleware/auth.js      Super Admin gets full module access like Admin
backend  services/authService.js Super Admin permissions 'ALL'; deactivated account -> 403 message
backend  routes/index.js         mounts /accounts
backend  routes/auth.js          removed GET/POST /auth/users (they let an Admin create any role, which
                                 breaks the Super Admin -> Admin -> User rule). Frontend never used them.
backend  package.json            script seed:superadmin
backend  .env.example            SUPERADMIN_* values
frontend App.js                  registers AccountList screen
frontend src/menu.js             "Users" tile now opens AccountList
frontend src/config.js           PC IP set to 10.0.250.143 (port 4000)

## Run order
1. Run aravai_migration_v4.sql in MySQL (after schema + v2 + v3). If your DB is called aravai_schema,
   change the USE line first.
2. backend: copy .env.example to .env (keep your own .env), add the SUPERADMIN_* lines, then
   npm install
   npm run seed                (teammate's seed: permissions + admin user)
   npm run seed:superadmin     (your Super Admin)
   npm run dev                 (port 4000)
3. frontend: npm install, npx expo start -c   (press w for browser, or scan QR on phone)
4. Login superadmin / ChangeMe@123 -> Home -> Users -> Add Admin.
   Login as that Admin -> Users -> Add User (optional: pick a staff role such as Batching Operator).

## Note
When an Admin adds a user they can pick a staff role (Batching Operator, Store Incharge ...). If none is
picked the account gets the generic "User" role (dashboard only). This is the only addition to your rules,
needed because the team database already has operator roles.
