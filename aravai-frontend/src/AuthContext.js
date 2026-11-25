import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { setToken } from './api';
import { storage } from './storage';
import { roleCanSee } from './menu';
import { unregisterPush } from './pushNotifications';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
    setUser(null);
  };

  const can = (module, action = 'view') => {
    if (!user) return false;
    // Role level first: Super Admin = all, Admin = Masters + Stock & Reports, User level = Production only
    if (!roleCanSee(user.role_name, module)) return false;
    if (user.permissions === 'ALL') return true;
    // Read-only screens that follow an existing permission (no extra permission row needed)
    const FOLLOWS = { tracking: 'batching',process_loss: 'batching',material_overview: 'material', ingredient: 'material' };
    const mod = FOLLOWS[module] || module;
    const p = user.permissions.find((x) => x.module === mod);
    return !!(p && p[`can_${action}`]);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}