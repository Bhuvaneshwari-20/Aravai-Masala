// Role names. Super Admin always passes; Admin is limited by ADMIN_ACCESS below.
const SUPER = 'Super Admin';
const ADMIN = 'Admin';
const FULL_ACCESS = [SUPER, ADMIN]; // still used by login/profile ('ALL') and account management

// Admin: only Masters + Stock & Reports modules (mirrors menu.js).
// '*' = all actions. batching / weighing_review are view-only because Batch Tracking
// (Stock & Reports) and the machine form's staff list read from them.
const ADMIN_ACCESS = {
  material: '*',
  gram: '*',
  mesh: '*',
  vendor: '*',
  product: '*',
  recipe: '*',
  machine: '*',
  stock: '*',
  finished_goods: '*',
  reports: '*',
  batching: ['view'],
  weighing_review: ['view'],
};

const adminAllows = (module, action) => {
  const a = ADMIN_ACCESS[module];
  return a === '*' || (Array.isArray(a) && a.includes(action));
};

// Super Admin: always true. Admin: decided by ADMIN_ACCESS.
// Other roles: null -> fall through to the role_permissions table.
const roleDecision = (roleName, module, action) => {
  if (roleName === SUPER) return true;
  if (roleName === ADMIN) return adminAllows(module, action);
  return null;
};

module.exports = { SUPER, ADMIN, FULL_ACCESS, ADMIN_ACCESS, adminAllows, roleDecision };