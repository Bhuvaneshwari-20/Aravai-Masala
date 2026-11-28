export const MENU = [
  { module: 'material', label: 'Material Master', icon: '📦', color: '#B45309', screen: 'MaterialList' },
  { module: 'vendor', label: 'Vendor Master', icon: '🏭', color: '#7C3AED', screen: 'VendorList' },
  { module: 'stock', label: 'Material Stock', icon: '🗂️', color: '#F59E0B', screen: 'StockList' },
  { module: 'product', label: 'Product & MRP', icon: '🏷️', color: '#EF4444', screen: 'ProductList' },

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
  // ---- Purchase Management (Quotation / Purchase Order / GRN have no screen yet: they show as SOON) ----
{ module: 'purchase', label: 'Indent', icon: '📝', color: '#B45309' },
  { module: 'quotation', label: 'Quotation', icon: '💬', color: '#7C3AED' },
  { module: 'purchase_order', label: 'Purchase Order', icon: '🛒', color: '#0891B2' },
  { module: 'grn', label: 'GRN', icon: '📥', color: '#16A34A' },
  { module: 'finished_goods', label: 'Finished Goods Stock', icon: '✅', color: '#22C55E' },
  { module: 'reports', label: 'Reports', icon: '📈', color: '#6366F1' },
  // ---- Sales Management ----
  { module: 'sales_dashboard', label: 'Sales Dashboard', icon: '📊', color: '#047857', screen: 'SalesDashboard' },
  { module: 'sales_entry', label: 'New Sales Entry', icon: '🧾', color: '#047857', screen: 'SalesEntry' },
  { module: 'sales_delivery', label: 'Sales Delivery', icon: '🚚', color: '#2F80ED', screen: 'SalesDelivery' },
  { module: 'sales_history', label: 'Sales History', icon: '🕘', color: '#0E7490', screen: 'SalesHistory' },
  { module: 'sales_return', label: 'Sales Return', icon: '↩️', color: '#C62828', screen: 'SalesReturn' },
  { module: 'sales_report', label: 'Monthly Sales & Profit', icon: '📈', color: '#6D28D9', screen: 'SalesReport' },
  { module: 'users', label: 'Users & Permissions', icon: '👤', color: '#0F766E', screen: 'AccountList' },
];

// Home screen sections (order matters)
export const GROUPS = [
  // order follows the factory flow: set up masters -> produce -> stock & tracking -> sell & dispatch -> admin
 { title: 'Masters', icon: 'database', color: '#C62828', modules: ['material', 'vendor', 'product', 'recipe', 'machine'] },
  { title: 'Purchase Management', icon: 'cart-arrow-down', color: '#B45309', modules: ['purchase', 'quotation', 'purchase_order', 'grn'] },
  { title: 'Production', icon: 'factory', color: '#D97706', modules: ['batching', 'filtering', 'roasting', 'grinding', 'blending', 'packing'] },
  { title: 'Stock & Tracking', icon: 'chart-box', color: '#6D28D9', modules: ['stock', 'finished_goods', 'tracking', 'process_loss', 'reports'] },
  { title: 'Sales Management', icon: 'cart', color: '#047857', modules: ['sales_dashboard', 'sales_entry', 'sales_delivery', 'sales_history', 'sales_return', 'sales_report'] },
  { title: 'Admin', icon: 'shield-account', color: '#BE185D', modules: ['users'] },
];

// ---- Role-based visibility (three levels) ----
// Super Admin -> every group.   Admin -> Masters + Purchase + Stock & Tracking + Sales.   Everyone else (User level) -> every group except Admin (their menu ticks decide).
// Staff roles (Batching Operator, Roasting Operator, ...) count as "User level"; their per-module
// permissions from role_permissions still decide which Production modules they actually see.
export const ROLE_GROUPS = {
  'Super Admin': null,                              // null = all groups
  Admin: ['Masters', 'Purchase Management', 'Stock & Tracking', 'Sales Management'],
};
export const USER_GROUPS = null; // staff roles: every group except 'Admin'; the menus ticked by the Super Admin (user_menu_access) / role_permissions decide

export const groupsForRole = (role) => {
  if (!(role in ROLE_GROUPS)) return GROUPS.filter((g) => g.title !== 'Admin');   // staff roles: all groups except Admin
  const allowed = ROLE_GROUPS[role];
  return allowed === null ? GROUPS : GROUPS.filter((g) => allowed.includes(g.title));
};

// Is this module inside a group the role may see?
export const roleCanSee = (role, module) => groupsForRole(role).some((g) => g.modules.includes(module));