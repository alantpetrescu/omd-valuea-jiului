/**
 * Current-user state.
 *
 * Server state, not client state: the user comes from `GET /auth/me` and is
 * never persisted to localStorage. On reload we ask the server again, and the
 * HttpOnly cookie answers for us.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, ApiError } from '../../api/client';

export type RoleCode = 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
  mustChangePassword: boolean;
}

/** Romanian role names shown in the topbar (spec 11.7). */
export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'Administrator',
  EDITOR: 'Editor',
  VIEWER: 'Vizualizare',
};

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the current user, e.g. after changing the password. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<CurrentUser>('/auth/me')
      .then((response) => setUser(response.data))
      .catch((error: unknown) => {
        // 401 on load simply means "not signed in" — not an error to surface.
        if (!(error instanceof ApiError) || error.code !== 'UNAUTHENTICATED') {
          console.error(error);
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post<CurrentUser>('/auth/login', { email, password });
    setUser(response.data);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<CurrentUser>('/auth/me');
      setUser(response.data);
    } catch {
      setUser(null);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
