import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { setToken } from './api';
import { storage } from './storage';

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
    await storage.del('token');
    setToken(null);
    setUser(null);
  };

  const can = (module, action = 'view') => {
    if (!user) return false;
    if (user.permissions === 'ALL') return true;
    const p = user.permissions.find((x) => x.module === module);
    return !!(p && p[`can_${action}`]);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}