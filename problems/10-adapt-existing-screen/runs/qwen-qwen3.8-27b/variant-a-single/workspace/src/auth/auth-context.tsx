import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
// ASSUMPTION: the client module has no named `api` export; it is consumed via a default export.
import client from '../api/client';
import type { User, LoginResponse } from '../api/types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = (await client.post<LoginResponse>('/auth/login', {
        email,
        password,
      })) as LoginResponse;
      setUser(res.user);
      setToken(res.token);
    },
    [],
  );

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
