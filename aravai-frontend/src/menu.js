export const MENU = [
  { module: 'material', label: 'Material Master', icon: '📦', color: '#B45309', screen: 'MaterialList' },
  { module: 'vendor', label: 'Vendor Master', icon: '🏭', color: '#7C3AED', screen: 'VendorList' },
  { module: 'stock', label: 'Material Stock and Tracking', icon: '🗂️', color: '#F59E0B', screen: 'StockList' },
  { module: 'product', label: 'Product & MRP', icon: '🏷️', color: '#EF4444', screen: 'ProductList' },
  { module: 'mesh', label: 'Mesh Size', icon: '🔳', color: '#0891B2', screen: 'MeshList' },
  { module: 'recipe', label: 'Recipe Management', icon: '📖', color: '#8B5CF6', screen: 'RecipeList' },
  { module: 'filtering', label: 'Filtering', icon: '🧺', color: '#0891B2', screen: 'FilteringList' },
  { module: 'batching', label: 'Batching', icon: '⚖️', color: '#14B8A6', screen: 'BatchList' },
  { module: 'roasting', label: 'Roasting', icon: '🔥', color: '#F97316', screen: 'RoastingList' },
  { module: 'grinding', label: 'Grinding', icon: '⚙️', color: '#64748B', screen: 'GrindingList' },
  { module: 'blending', label: 'Blending', icon: '🥣', color: '#D946EF', screen: 'BlendingList' },
  { module: 'machine', label: 'Machines', icon: '🛠️', color: '#475569', screen: 'MachineList' },
  { module: 'packing', label: 'Packing', icon: '📫', color: '#06B6D4', screen: 'PackingList' },
  { module: 'tracking', label: 'Batch Tracking', icon: '🧭', color: '#0E7490', screen: 'TrackingList' },
  { module: 'process_loss', label: 'Process Yield & Loss', icon: '📉', color: '#B01E1E', screen: 'ProcessLossList' },
  { module: 'finished_goods', label: 'Finished Goods', icon: '✅', color: '#22C55E' },
  { module: 'reports', label: 'Reports', icon: '📈', color: '#6366F1' },
  { module: 'purchase', label: 'Indent', icon: '🛒', color: '#0F766E', screen: 'PurchaseList' },
  { module: 'users', label: 'Users', icon: '👤', color: '#0F766E', screen: 'AccountList' },
];

// Home screen sections (order matters)
export const GROUPS = [
  { title: 'Masters', icon: 'database', color: '#C62828', modules: ['material', 'recipe'] },
  { title: 'Production', icon: 'factory', color: '#D97706', modules: ['batching', 'filtering', 'roasting', 'grinding', 'blending', 'packing'] },
  { title: 'Factory Administration', icon: 'domain', color: '#0F766E', modules: ['vendor', 'product', 'machine'] },
  { title: 'Stock & Tracking', icon: 'chart-box', color: '#6D28D9', modules: ['stock', 'tracking', 'process_loss', 'finished_goods', 'reports'] },
  { title: 'Purchase', icon: 'cart', color: '#0F766E', modules: ['purchase'] },
  { title: 'Admin', icon: 'shield-account', color: '#BE185D', modules: ['users'] },
];

// ---- Permission switches the Super Admin can give per module (User Access & Permission Management) ----
// "View" is the sidebar tick itself. These are the extra switches; only the ones that make sense for a module are listed.
export const ACTION_LABELS = {
  create: 'Create', edit: 'Edit', delete: 'Delete',
  start: 'Production Start', stop: 'Production Stop',
  history: 'History View', review: 'Review', remark: 'Add Remarks', approve: 'Approve',
};
const CRUD = ['create', 'edit', 'delete'];
const RUN = ['start', 'stop', 'create', 'edit', 'history', 'review', 'remark', 'approve'];   // filtering / roasting / grinding: start + stop machines
export const MODULE_ACTIONS = {
  batching: ['create', 'edit', 'delete', 'history', 'review', 'remark', 'approve'],
  filtering: RUN, roasting: RUN, grinding: RUN,
  blending: ['create', 'edit', 'history', 'review', 'remark', 'approve'],
  packing: ['create', 'edit', 'history', 'review', 'remark', 'approve'],
  stock: ['create', 'edit', 'history'],
  tracking: [],                                   // view only
  process_loss: ['history', 'review', 'remark'],
  purchase: ['create', 'edit', 'approve'],        // Indent: Admin raises (create / edit = cancel), Manager approves
};
export const actionsFor = (module) => MODULE_ACTIONS[module] || CRUD;

// ---- Role-based visibility ----
// Super Admin -> every group.   Admin -> Masters + Factory Administration + Stock & Tracking + Purchase.
// Manager -> Purchase only (approve / reject indents).
// Staff roles (Batching Operator, Roasting Operator, ...) -> every group except 'Admin'; their per-module
// permissions from role_permissions still decide which modules they actually see.
export const ROLE_GROUPS = {
  'Super Admin': null,                              // null = all groups
  Admin: ['Masters', 'Factory Administration', 'Stock & Tracking', 'Purchase'],   // Admin raises indents
  Manager: ['Purchase'],                            // Manager: only the indents sent by Admin (approve / reject)
};
export const USER_GROUPS = null; // staff roles: every group except 'Admin'; can_view in role_permissions decides the modules

export const groupsForRole = (role, explicit = false) => {
  if (explicit || !(role in ROLE_GROUPS)) return GROUPS.filter((g) => g.title !== 'Admin');
  const allowed = ROLE_GROUPS[role];
  return allowed === null ? GROUPS : GROUPS.filter((g) => allowed.includes(g.title));
};

// Is this module inside a group the role may see?
export const roleCanSee = (role, module) => groupsForRole(role).some((g) => g.modules.includes(module));