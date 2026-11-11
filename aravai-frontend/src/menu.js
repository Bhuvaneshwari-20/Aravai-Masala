// module key = role_permissions.module in the database
// screen = name of the screen in App.js navigator (no screen => "coming soon")
export const MENU = [
  { module: 'dashboard', label: 'Dashboard', icon: '📊', color: '#2574f5' },
  { module: 'material', label: 'Material Master', icon: '📦', color: '#B45309', screen: 'MaterialList' },
  { module: 'vendor', label: 'Vendor Master', icon: '🏭', color: '#7C3AED', screen: 'VendorList' },
  { module: 'indent', label: 'Indent', icon: '📝', color: '#0EA5E9' },
  { module: 'quotation', label: 'Quotation', icon: '💬', color: '#EC4899' },
  { module: 'purchase_order', label: 'Purchase Order', icon: '🧾', color: '#10B981' },
  { module: 'stock', label: 'Material Stock Card', icon: '🗂️', color: '#F59E0B' },
  { module: 'product', label: 'Product & MRP', icon: '🏷️', color: '#EF4444' },
  { module: 'recipe', label: 'Recipes', icon: '📖', color: '#8B5CF6' },
  { module: 'batching', label: 'Batching', icon: '⚖️', color: '#14B8A6' },
  { module: 'roasting', label: 'Roasting', icon: '🔥', color: '#F97316' },
  { module: 'grinding', label: 'Grinding', icon: '⚙️', color: '#64748B' },
  { module: 'blending', label: 'Blending', icon: '🥣', color: '#D946EF' },
  { module: 'machine', label: 'Machines', icon: '🛠️', color: '#475569' },
  { module: 'packing', label: 'Packing', icon: '📫', color: '#06B6D4' },
  { module: 'finished_goods', label: 'Finished Goods', icon: '✅', color: '#22C55E' },
  { module: 'reports', label: 'Reports', icon: '📈', color: '#6366F1' },
  { module: 'users', label: 'Users', icon: '👤', color: '#0F766E', screen: 'AccountList' },
];

// Home screen sections (order matters)
export const GROUPS = [
  { title: 'Masters', icon: 'database', color: '#C62828', modules: ['material', 'vendor', 'product', 'recipe', 'machine'] },
  { title: 'Purchase', icon: 'cart', color: '#0E7490', modules: ['indent', 'quotation', 'purchase_order'] },
  { title: 'Production', icon: 'factory', color: '#D97706', modules: ['batching', 'roasting', 'grinding', 'blending', 'packing'] },
  { title: 'Stock & Reports', icon: 'chart-box', color: '#6D28D9', modules: ['stock', 'finished_goods', 'dashboard', 'reports'] },
  { title: 'Admin', icon: 'shield-account', color: '#BE185D', modules: ['users'] },
];
