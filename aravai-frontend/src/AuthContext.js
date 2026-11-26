import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { setToken } from './api';
import { storage } from './storage';
import { roleCanSee } from './menu';
import { unregisterPush } from './pushNotifications';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);
// The one role that may use the sidebar "view as role" switch (same name the server uses for Super Admin).
const SUPER_ROLE = 'Super Admin';

// Read-only screens that follow an existing permission (no extra permission row needed)
const FOLLOWS = { tracking: 'batching', material_overview: 'material', ingredient: 'material' };

// THE permission rule, used for the logged-in user AND for the role a Super Admin is previewing, so a preview can never differ
// from what that role's users really see.
//   1. role level first: Super Admin = all, Admin = Masters + Stock & Reports, User level = Production only (menu.js)
//   2. then role_permissions: can_view / can_create / can_edit / can_delete / can_approve
const canFor = (roleName, permissions, module, action = 'view') => {
  if (!roleCanSee(roleName, module)) return false;
  if (permissions === 'ALL') return true;
  const list = permissions || [];
  const p = list.find((x) => x.module === module) || list.find((x) => x.module === FOLLOWS[module]);
  return !!(p && p[`can_${action}`]);
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
    // ---- Super Admin "view as role" (sidebar dropdown). Pure UI preview: the login and the server-side permissions are NOT changed. ----
  const [roleList, setRoleList] = useState([]);   // every role with its role_permissions rows (from GET /accounts/roles/permissions)
  const [viewAs, setViewAs] = useState(null);     // null = my own role, otherwise one item of roleList


  useEffect(() => {
    (async () => {
      try {
        const t = await storage.get('token');
        if (t) {
          setToken(t);
          const r = await api.get('/auth/me');
          setUser(r.data.data);
        }
      } catch (e) {
        if (e.response?.status === 401) { await storage.del('token'); setToken(null); }
      }
      setLoading(false);
    })();
  }, []);
const isSuper = !!user && user.role_name === SUPER_ROLE;

  const reloadRoles = async () => {
    if (!isSuper) return;
    try {
      const list = (await api.get('/accounts/roles/permissions')).data.data;
      setRoleList(list);
      // a role that was edited while being previewed: keep the preview, with its fresh permissions
      setViewAs((cur) => (cur ? list.find((x) => x.id === cur.id) || null : null));
    } catch (e) { /* keep the roles we already have */ }
  };
  useEffect(() => {
    if (!isSuper) { setRoleList([]); setViewAs(null); return; }
    reloadRoles();
  }, [user && user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // pick a role (by id). My own role = back to normal.
  const selectRole = (id) => {
    const r = roleList.find((x) => x.id === id);
    setViewAs(!r || r.role_name === user.role_name ? null : r);
  };

  const login = async (username, password) => {
    const r = await api.post('/auth/login', { username, password });
    await storage.set('token', r.data.data.token);
    setToken(r.data.data.token);
    setUser(r.data.data.user);
  };

  const logout = async () => {
     await unregisterPush();
    await storage.del('token');
    setToken(null);
    setViewAs(null); setRoleList([]);
    setUser(null);
  };

  // every screen asks can(module, action): while a role is being previewed the answer is that role's
  const can = (module, action = 'view') => {
    if (!user) return false;
    return viewAs ? canFor(viewAs.role_name, viewAs.permissions, module, action) : canFor(user.role_name, user.permissions, module, action);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, can, isSuper, roleList, viewAs, selectRole, reloadRoles }}>
      {children}
    </Ctx.Provider>
  );
}
