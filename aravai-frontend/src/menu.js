export const MENU = [
  { module: 'dashboard', label: 'Dashboard', icon: '📊', color: '#2574f5' },
  { module: 'material', label: 'Material Master', icon: '📦', color: '#B45309', screen: 'MaterialList' },
  { module: 'vendor', label: 'Vendor Master', icon: '🏭', color: '#7C3AED', screen: 'VendorList' },
  { module: 'stock', label: 'Material Stock Card', icon: '🗂️', color: '#F59E0B', screen: 'StockList' },
  { module: 'product', label: 'Product & MRP', icon: '🏷️', color: '#EF4444', screen: 'ProductList' },
  { module: 'gram', label: 'Grams', icon: '📏', color: '#0EA5E9', screen: 'GramList' },
  { module: 'recipe', label: 'Recipes', icon: '📖', color: '#8B5CF6', screen: 'RecipeList' },
  { module: 'batching', label: 'Batching', icon: '⚖️', color: '#14B8A6', screen: 'BatchList' },
  { module: 'roasting', label: 'Roasting', icon: '🔥', color: '#F97316' },
  { module: 'grinding', label: 'Grinding', icon: '⚙️', color: '#64748B', screen: 'GrindingList' },
    { module: 'blending', label: 'Blending', icon: '🥣', color: '#D946EF',screen: 'BlendingList'  },
    { module: 'machine', label: 'Machines', icon: '🛠️', color: '#475569', screen: 'MachineList' },
 { module: 'packing', label: 'Packing', icon: '📫', color: '#06B6D4' , screen: 'PackingList'},
   { module: 'finished_goods', label: 'Finished Goods', icon: '✅', color: '#22C55E' },
  { module: 'reports', label: 'Reports', icon: '📈', color: '#6366F1' },
  { module: 'users', label: 'Users', icon: '👤', color: '#0F766E', screen: 'AccountList' },
];
 
// Home screen sections (order matters)
export const GROUPS = [
  { title: 'Masters', icon: 'database', color: '#C62828', modules: ['material', 'gram', 'vendor', 'product', 'recipe', 'machine'] },
  { title: 'Production', icon: 'factory', color: '#D97706', modules: ['batching', 'roasting', 'grinding', 'blending', 'packing'] },
  { title: 'Stock & Reports', icon: 'chart-box', color: '#6D28D9', modules: ['stock', 'finished_goods', 'dashboard', 'reports'] },
  { title: 'Admin', icon: 'shield-account', color: '#BE185D', modules: ['users'] },
];