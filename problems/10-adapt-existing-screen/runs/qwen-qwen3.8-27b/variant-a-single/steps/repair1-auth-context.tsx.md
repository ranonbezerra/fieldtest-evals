# repair1-auth-context.tsx

## reasoning

```
Let me analyze the compiler errors for `src/auth/auth-context.tsx`:

1. `src/auth/auth-context.tsx(3,10): error TS2305: Module '"../api/client"' has no exported member 'api'.`
2. `src/auth/auth-context.tsx(4,15): error TS2305: Module '"../api/types"' has no exported member 'AuthUser'.`

So the file imports `api` from `../api/client` and `AuthUser` from `../api/types`.

Looking at the reference `src/api/types.ts`, I can see it exports `Session`, `PagedSessions`, `SessionListParams`, `User`, and `LoginResponse`. There's no `AuthUser` type. There IS a `User` type.

So I need to:
1. Fix the import from `../api/client` - the module doesn't export `api`. I need to figure out what it exports.
2. Fix the import from `../api/types` - `AuthUser` doesn't exist, but `User` does.

Since I can't see `src/api/client.ts`, I need to make an assumption about what it exports. Given the pattern of the other files that also import `api` from `../api/client` (like `src/features/orders/queries.ts` and `src/features/sessions/queries.ts`), it's likely that the client module should export something named `api`.

Wait, the instructions say "Change nothing the messages do not name." The messages name:
- Line 3: `api` import from `../api/client` - no exported member `api`
- Line 4: `AuthUser` import from `../api/types` - no exported member `AuthUser`

I need to fix these in `auth-context.tsx`. Since I can't change other files, I need to adapt this file.

For `../api/types`: I can see the types file exports `User` not `AuthUser`. So I should use `User` instead of `AuthUser`.

For `../api/client`: I don't have visibility into what it exports. The other files also reference `api` from it and have the same error. Since I can only modify `auth-context.tsx`, I need to either:
- Import whatever the client actually exports
- Or make an assumption

Since I can't see the client file, I'll need to make an assumption. The most reasonable assumption is that the client module exports a default export or some other named export that serves as the HTTP client. A common pattern is to export a default axios instance or a fetch wrapper.

Actually, let me think about this differently. The task says "Rewrite `src/auth/auth-context.tsx` complete, fixing what these messages require of this file." The messages say:
1. `api` is not exported from `../api/client`
2. `AuthUser` is not exported from `../api/types`

For (2), I can fix by using `User` instead of `AuthUser` since I can see the types file.

For (1), I can't see what `../api/client` exports. I'll need to make an assumption. A common pattern would be a default export. Let me assume it's a default export of an API client object.

Actually, wait. Let me reconsider. The convention says "Do exactly what the task asks." The task says to fix `src/auth/auth-context.tsx` so it compiles. The errors are about missing exports from other modules. Since I can't change those other modules, I need to adapt this file to work with what those modules actually export.

For `../api/types` - I can see it exports `User`, `LoginResponse`, etc. So I'll use `User` instead of `AuthUser`.

For `../api/client` - I don't have visibility. I'll assume it exports a default (common for API clients). I'll add an ASSUMPTION line.

Now let me think about what the auth context should do based on the variant description:
- Login (calls login endpoint, stores token)
- Logout (clears state)
- The token is used for authenticated requests
- `LoginResponse` has `{ token, user }` where user is `User { id, name }`

The auth context should:
- Store the current user and token
- Provide login/logout functions
- The token should be available for the API client to use

Let me write a reasonable auth context that:
1. Uses `User` from `../api/types` (fixing the `AuthUser` error)
2. Imports from `../api/client` (fixing the `api` error - I'll assume default export)
3. Provides login, logout, and the current user/token
4. Uses React context + state

Let me write this:

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import defaultApi from '../api/client'; // ASSUMPTION: the client module uses a default export; no named `api` export exists.
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

  const login = useCallback(async (email: string, password: string) => {
    const res: LoginResponse = await defaultApi.post('/auth/login', { email, password });
    setUser(res.user);
    setToken(res.token);
  }, []);

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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

Wait, but I need to think about what the `api` client looks like. The other files (queries.ts) import `api` from it and use it with react-query. They likely do something like `api.get(...)` or `api.post(...)`. 

Since I can't see the client, and the error says there's no exported member `api`, the most likely scenarios are:
1. It has a default export
2. It has a different named export (like `httpClient` or `fetch`)

I'll go with default export as the assumption since that's the most common pattern for a single client instance.

Actually, let me reconsider the shape. The `LoginResponse` type has `token` and `user`. The context needs to handle the login flow. Let me make sure my implementation is coherent.

One more thought - the variant says "logout clearing all state" is an existing behavior that must not regress. So logout should clear the user and token. That's what I have.

Let me finalize my answer.
```

## reply

```tsx
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
```
