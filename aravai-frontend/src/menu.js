export const MENU = [
  { module: 'material', label: 'Material Master', icon: '📦', color: '#B45309', screen: 'MaterialList' },
  { module: 'vendor', label: 'Vendor Master', icon: '🏭', color: '#7C3AED', screen: 'VendorList' },
  { module: 'stock', label: 'Material Stock Card', icon: '🗂️', color: '#F59E0B', screen: 'StockList' },
  { module: 'product', label: 'Product & MRP', icon: '🏷️', color: '#EF4444', screen: 'ProductList' },
  { module: 'gram', label: 'Grams', icon: '📏', color: '#0EA5E9', screen: 'GramList' },
  { module: 'mesh', label: 'Mesh Size', icon: '🔳', color: '#0891B2', screen: 'MeshList' },
  { module: 'recipe', label: 'Recipes', icon: '📖', color: '#8B5CF6', screen: 'RecipeList' },
  { module: 'filtering', label: 'Filtering', icon: '🧺', color: '#0891B2', screen: 'FilteringList' },
  { module: 'batching', label: 'Batching', icon: '⚖️', color: '#14B8A6', screen: 'BatchList' },
  { module: 'roasting', label: 'Roasting', icon: '🔥', color: '#F97316', screen: 'RoastingList' },
  { module: 'grinding', label: 'Grinding', icon: '⚙️', color: '#64748B', screen: 'GrindingList' },
  { module: 'blending', label: 'Blending', icon: '🥣', color: '#D946EF', screen: 'BlendingList' },
  { module: 'machine', label: 'Machines', icon: '🛠️', color: '#475569', screen: 'MachineList' },
  { module: 'packing', label: 'Packing', icon: '📫', color: '#06B6D4', screen: 'PackingList' },
  { module: 'tracking', label: 'Batch Tracking', icon: '🧭', color: '#0E7490', screen: 'TrackingList' },

  { module: 'finished_goods', label: 'Finished Goods', icon: '✅', color: '#22C55E' },
  { module: 'reports', label: 'Reports', icon: '📈', color: '#6366F1' },
  { module: 'users', label: 'Users', icon: '👤', color: '#0F766E', screen: 'AccountList' },
];

// Home screen sections (order matters)
export const GROUPS = [
  { title: 'Masters', icon: 'database', color: '#C62828', modules: ['material', 'gram', 'mesh', 'vendor', 'product', 'recipe', 'machine'] },
  { title: 'Production', icon: 'factory', color: '#D97706', modules: ['batching', 'filtering', 'roasting', 'grinding', 'blending', 'packing'] },
  { title: 'Stock & Reports', icon: 'chart-box', color: '#6D28D9', modules: ['stock', 'tracking', 'finished_goods', 'reports'] },
  { title: 'Admin', icon: 'shield-account', color: '#BE185D', modules: ['users'] },
];

// ---- Role-based visibility (three levels) ----
// Super Admin -> every group.   Admin -> Masters + Stock & Reports.   Everyone else (User level) -> Production only.
// Staff roles (Batching Operator, Roasting Operator, ...) count as "User level"; their per-module
// permissions from role_permissions still decide which Production modules they actually see.
export const ROLE_GROUPS = {
  'Super Admin': null,                              // null = all groups
  Admin: ['Masters', 'Stock & Reports'],
};
export const USER_GROUPS = ['Production'];

export const groupsForRole = (role) => {
  const allowed = role in ROLE_GROUPS ? ROLE_GROUPS[role] : USER_GROUPS;
  return allowed === null ? GROUPS : GROUPS.filter((g) => allowed.includes(g.title));
};

// Is this module inside a group the role may see?
export const roleCanSee = (role, module) => groupsForRole(role).some((g) => g.modules.includes(module));