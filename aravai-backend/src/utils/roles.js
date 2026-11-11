// Role names. Super Admin and Admin skip the module permission check.
const SUPER = 'Super Admin';
const ADMIN = 'Admin';
const FULL_ACCESS = [SUPER, ADMIN];
module.exports = { SUPER, ADMIN, FULL_ACCESS };
