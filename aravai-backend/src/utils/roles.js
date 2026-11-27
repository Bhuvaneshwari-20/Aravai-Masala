// Role names. Super Admin always passes; Admin is limited by ADMIN_ACCESS below.
const SUPER = 'Super Admin';
const ADMIN = 'Admin';
const MANAGER = 'Manager';
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
  purchase: ['view', 'create', 'edit'],   // Admin raises purchase requests; only Manager / Super Admin approve
};

// Manager: purchase requests only (view + approve / reject).
const MANAGER_ACCESS = { purchase: ['view', 'approve'] };
const managerAllows = (module, action) => Array.isArray(MANAGER_ACCESS[module]) && MANAGER_ACCESS[module].includes(action);

const adminAllows = (module, action) => {
  const a = ADMIN_ACCESS[module];
  return a === '*' || (Array.isArray(a) && a.includes(action));
};

// Super Admin: always true. Admin: decided by ADMIN_ACCESS.
// Other roles: null -> fall through to the role_permissions table.
const roleDecision = (roleName, module, action) => {
  if (roleName === SUPER) return true;
  if (roleName === ADMIN) return adminAllows(module, action);
  if (roleName === MANAGER) return managerAllows(module, action);
  return null;
};

module.exports = { SUPER, ADMIN, MANAGER, FULL_ACCESS, ADMIN_ACCESS, adminAllows, roleDecision };