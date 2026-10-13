import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setMe(null);
    window.addEventListener('nc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('nc:unauthorized', onUnauthorized);
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setMe(null);
  }, []);

  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);

  return <AuthCtx.Provider value={{ me, loading, refresh, logout, can }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
