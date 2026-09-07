import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requestLogin } from '../api/auth';
import { setAuthToken } from '../api/client';
import type { User } from '../api/types';

/** sessionStorage key for the credential; exported so tests can inspect it. */
export const AUTH_STORAGE_KEY = 'ops-back-office.auth';

interface StoredAuth {
  token: string;
  user: User;
}

interface AuthContextValue {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.user) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [stored, setStored] = useState<StoredAuth | null>(loadStoredAuth);

  // Keep the API client's bearer token in sync (initial load, login, logout).
  const storedToken = stored?.token ?? null;
  useEffect(() => {
    setAuthToken(storedToken);
  }, [storedToken]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await requestLogin(email, password);
    const next: StoredAuth = { token: res.token, user: res.user };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    setStored(next);
  }, []);

  const logout = useCallback(() => {
    // The task requires logout to clear all client state: the credential,
    // the API token and every cached server fact.
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthToken(null);
    queryClient.clear();
    setStored(null);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ token: stored?.token ?? null, user: stored?.user ?? null, login, logout }),
    [stored, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
