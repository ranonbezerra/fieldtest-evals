# 02-use-active-session.ts

## reasoning

```
Let me analyze what's needed for `src/features/sessions/use-active-session.ts` based on the plan.

From the plan:
- `ActiveSession` type with `id`, `name`, `status`, `startedAt`
- `UseActiveSessionResult` interface with `active`, `isFetching`, `setActive`, `closeActive`, `isMutating`
- `useActiveSession()` hook that:
  - Uses react-query to fetch `GET /sessions/active` (query)
  - `setActive(sessionId)` calls `PUT /sessions/active` with body `{ sessionId: string }`, then invalidates/refetches the query
  - `closeActive()` calls `POST /sessions/:active.id/close`, then refetches the query
  - Error codes: `session_not_found` for bad id in setActive, `session_already_closed` for closeActive on already-closed

The plan says:
- `setActive`: "Sets the given session as active (PUT /sessions/active). Raises ApiError { code: 'session_not_found' } if the id is invalid. Invalidates + refetches GET /sessions/active on success."
- `closeActive`: "Calls POST /sessions/:active.id/close, then refetches GET /sessions/active. On success the server returns null (no active session) and the bar empties. Raises ApiError { code: 'session_already_closed' } if already closed."

Now, I need to figure out what API client/pattern this app uses. The plan doesn't explicitly show an API client module. Let me look at what's available.

The references show:
- The app is React + TS + react-query + router
- There's an existing close endpoint at `POST /sessions/:id/close`
- There's `GET /sessions/active`

Since I don't have the existing API client code, I need to make a reasonable assumption. The most common pattern in React apps with react-query is to have a simple fetch-based API call or an axios instance. Since the plan mentions `ApiError` with a `code` field, there's likely an error class.

Let me think about what's most defensible:
1. I'll use `fetch` directly since no specific HTTP client is referenced
2. I'll create a minimal `ApiError` class or assume one exists

Actually, looking more carefully at the plan, it says "Raises ApiError { code: 'session_not_found' }" - this suggests there's an existing `ApiError` class in the codebase. But since I don't have it in my references, I should either:
- Import it from a presumed location
- Define a minimal version

The plan's manifest says this file reads: `src/features/sessions/dirty-context.tsx` - wait, why would it read dirty-context? Let me re-read...

Actually looking at the manifest again:
```
src/features/sessions/use-active-session.ts | reads: src/features/sessions/dirty-context.tsx | ActiveSession type, useActiveSession hook (query + mutations)
```

Hmm, that's odd. The hook itself doesn't seem to need dirty-context. But the plan says it reads it. Maybe it's for the `setActive` confirmation logic? No, the plan says the detail screen handles that, not the hook.

Wait, looking at the plan more carefully:
- "What must NOT be inside the bar component: any API call, any navigation logic beyond useNavigate().push('/sessions/:id') for the Resume button, any dirty-flag write."
- The detail screen handles the dirty confirmation before calling setActive

So the hook itself doesn't need dirty-context. The manifest might just be listing it as a related file. I'll focus on what the hook actually needs.

Let me think about the implementation:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ActiveSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string;
}

export interface UseActiveSessionResult {
  active: ActiveSession | null;
  isFetching: boolean;
  setActive: (sessionId: string) => Promise<void>;
  closeActive: () => Promise<void>;
  isMutating: boolean;
}

export function useActiveSession(): UseActiveSessionResult {
  const queryClient = useQueryClient();

  // Query: GET /sessions/active
  const { data: active, isFetching } = useQuery({
    queryKey: ['sessions', 'active'],
    queryFn: async () => {
      const res = await fetch('/api/sessions/active', { headers: { ...authHeaders() } });
      if (!res.ok) throw new ApiError(res.status, await parseError(res));
      const json = await res.json();
      return json as ActiveSession | null;
    },
  });

  // Mutation: PUT /sessions/active
  const setActiveMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch('/api/sessions/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new ApiError(res.status, await parseError(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'active'] });
    },
  });

  // Mutation: POST /sessions/:id/close
  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error('No active session to close');
      const res = await fetch(`/api/sessions/${active.id}/close`, {
        method: 'POST',
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new ApiError(res.status, await parseError(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'active'] });
    },
  });

  return {
    active: active ?? null,
    isFetching,
    setActive: (sessionId: string) => setActiveMutation.mutateAsync(sessionId),
    closeActive: () => closeMutation.mutateAsync(),
    isMutating: setActiveMutation.isMutating || closeMutation.isMutating,
  };
}
```

Now, issues:
1. `authHeaders()` - I don't know how auth works in this app. I'll need to make an assumption or use a simpler approach.
2. `ApiError` - I don't have this class defined anywhere in my references.
3. `parseError` - same issue.

Since the plan mentions specific error codes (`session_not_found`, `session_already_closed`), and the error envelope is `{ "error": { "code": "...", "message": "...", "details": {} } }` (from the conventions), I should handle errors in that shape.

Let me think about what's most defensible without over-assuming:
- For auth, I'll use a simple fetch with credentials or a token from a module. Since the plan says "token missing/expired (handled by react-query retry → redirect to login)", there's likely an auth mechanism. I'll use `credentials: 'include'` or assume a token helper. Actually, the simplest defensible approach is to just use `fetch` with `credentials: 'include'` for cookie-based auth, or I could assume there's a helper.

Actually, let me reconsider. The plan says this is a back-office with login. Common patterns:
- Cookie-based auth (JWT in cookie) → just use `credentials: 'include'`
- Bearer token from a module → import a helper

Since I don't have the auth module in my references, I'll go with `credentials: 'include'` as it's the simplest and most defensible for a back-office app. Actually wait - many React apps store tokens in localStorage or get them from an auth context. Let me just use a simple approach and mark it as an assumption if needed.

Actually, the simplest and most defensible: just use `fetch` with no special headers for auth (assuming cookie-based or a global fetch interceptor). Or I could use `credentials: 'include'`. Let me just go with a plain fetch - in many apps there's a global fetch wrapper or the server uses cookies.

Hmm, but I should be more careful. Let me re-read the plan... The plan mentions "token missing/expired" which suggests token-based auth. But without knowing the exact mechanism, I'll use a minimal approach.

Let me define a small `ApiError` class within this file since it's needed for the error contract and I don't have it from elsewhere. Actually wait - the plan says "Raises ApiError" which implies it already exists. But I don't have it in my references. Let me mark this as an assumption and define a minimal one, or import it from a presumed location.

Actually, I think the most defensible approach is:
1. Define `ApiError` in this file (or import from a common location)
2. Use plain `fetch` with `credentials: 'include'`

Let me go with defining it locally since I have no reference to where it lives. I'll mark it as an assumption.

Wait, actually - re-reading the instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one // ASSUMPTION comment at the point it matters."

So I should:
- Use `fetch` (most defensible without knowing the HTTP client)
- Mark an assumption about auth mechanism
- Define `ApiError` inline or import it - I'll define a minimal one and mark assumption

Let me also think about the query key. The plan says `GET /sessions/active` - I'll use `['sessions', 'active']` as the query key.

For the `closeActive` - it needs `active.id` which comes from the query data. The mutation needs access to it.

Let me also consider: the plan says "Invalidates + refetches GET /sessions/active on success" for both mutations. I'll use `queryClient.invalidateQueries` which triggers a refetch.

Let me write the final version:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ASSUMPTION: No shared ApiError class or HTTP client was available in the references; a minimal local error type is defined here to satisfy the plan's error contract.

export interface ActiveSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string; // ISO-8601
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UseActiveSessionResult {
  active: ActiveSession | null;
  isFetching: boolean;
  setActive: (sessionId: string) => Promise<void>;
  closeActive: () => Promise<void>;
  isMutating: boolean;
}

const ACTIVE_SESSION_KEY = ['sessions', 'active'] as const;

async function parseErrorEnvelope(res: Response): Promise<ApiError> {
  let code = 'unknown_error';
  let message = res.statusText || 'Request failed';
  let details: Record<string, unknown> = {};

  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details ?? {};
    }
  } catch {
    // non-JSON body; keep defaults
  }

  return new ApiError(code, message, details);
}

export function useActiveSession(): UseActiveSessionResult {
  const queryClient = useQueryClient();

  const { data: active, isFetching } = useQuery<ActiveSession | null>({
    queryKey: ACTIVE_SESSION_KEY,
    queryFn: async () => {
      const res = await fetch('/api/sessions/active', {
        credentials: 'include',
      });
      if (!res.ok) throw await parseErrorEnvelope(res);
      const json: unknown = await res.json();
      return (json as ActiveSession | null) ?? null;
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      const res = await fetch('/api/sessions/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw await parseErrorEnvelope(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (active === null) {
        throw new ApiError('no_active_session', 'No active session to close.');
      }
      const res = await fetch(`/api/sessions/${active.id}/close`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await parseErrorEnvelope(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
    },
  });

  return {
    active: active ?? null,
    isFetching,
    setActive: (sessionId: string) => setActiveMutation.mutateAsync(sessionId),
    closeActive: () => closeMutation.mutateAsync(),
    isMutating: setActiveMutation.isMutating || closeMutation.isMutating,
  };
}
```

Wait, I need to double-check the plan's error contract:
- `session_not_found`: raised when `setActive` called with an id that has no matching row → this would come from the server as a 404 with that code in the envelope
- `session_already_closed`: raised when `closeActive` called on an already-closed session → server returns this

So these error codes come FROM the server response, not something I generate client-side. My `parseErrorEnvelope` handles extracting them from the response body. Good.

The `no_active_session` I'm generating client-side when `active` is null - that's a guard to prevent calling close on nothing. The plan doesn't explicitly mention this case for `closeActive`, but it's a reasonable guard. Actually, the plan says the bar only shows when there IS an active session, so `closeActive` would only be callable when there is one. But the hook could be called without the bar being present. I'll keep the guard.

Actually, wait - let me re-read: "Close endpoint: already exists as POST /sessions/:id/close; no new route." And the plan says `closeActive` "Calls POST /sessions/:active.id/close". So it needs the active session's id. If there's no active session, it can't call it. My guard is appropriate.

One more thought: should I use `credentials: 'include'`? The plan mentions "token missing/expired" which could be a cookie or a header. For a back-office app, cookies are common. But it could also be a Bearer token. Since I have no reference to an auth mechanism, `credentials: 'include'` is the most defensible for a same-origin app (which a back-office typically is). I'll add an assumption comment about this.

Actually, let me reconsider whether to put the assumption on auth or not. The instructions say "mark it with one // ASSUMPTION comment at the point it matters." I'll put one for the API base path / auth approach since that's the main unresolved thing.

Let me finalize. I think my implementation is solid. Let me clean it up.
```

## reply

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ASSUMPTION: No shared HTTP client or ApiError type was available in the references;
// a minimal local error class and raw fetch (same-origin, cookie auth) are used here.

export interface ActiveSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string; // ISO-8601
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UseActiveSessionResult {
  active: ActiveSession | null;
  isFetching: boolean;
  /**
   * Sets the given session as active (PUT /sessions/active).
   * Raises ApiError { code: 'session_not_found' } if the id is invalid.
   * Invalidates + refetches GET /sessions/active on success.
   */
  setActive: (sessionId: string) => Promise<void>;
  /**
   * Calls POST /sessions/:active.id/close, then refetches GET /sessions/active.
   * On success the server returns null (no active session) and the bar empties.
   * Raises ApiError { code: 'session_already_closed' } if already closed.
   */
  closeActive: () => Promise<void>;
  isMutating: boolean;
}

const ACTIVE_SESSION_KEY = ['sessions', 'active'] as const;

async function parseErrorEnvelope(res: Response): Promise<ApiError> {
  let code = 'unknown_error';
  let message = res.statusText || 'Request failed';
  let details: Record<string, unknown> = {};

  try {
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as Record<string, unknown>).error === 'object' &&
      (body as Record<string, unknown>).error !== null
    ) {
      const err = (body as { error: Record<string, unknown> }).error;
      if (typeof err.code === 'string') code = err.code;
      if (typeof err.message === 'string') message = err.message;
      if (typeof err.details === 'object' && err.details !== null) {
        details = err.details as Record<string, unknown>;
      }
    }
  } catch {
    // non-JSON body; keep defaults
  }

  return new ApiError(code, message, details);
}

export function useActiveSession(): UseActiveSessionResult {
  const queryClient = useQueryClient();

  const { data: active, isFetching } = useQuery<ActiveSession | null>({
    queryKey: ACTIVE_SESSION_KEY,
    queryFn: async (): Promise<ActiveSession | null> => {
      const res = await fetch('/api/sessions/active', {
        credentials: 'include',
      });
      if (!res.ok) throw await parseErrorEnvelope(res);
      const json: unknown = await res.json();
      return (json as ActiveSession | null) ?? null;
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      const res = await fetch('/api/sessions/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw await parseErrorEnvelope(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (active === null) {
        throw new ApiError('no_active_session', 'No active session to close.');
      }
      const res = await fetch(`/api/sessions/${active.id}/close`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await parseErrorEnvelope(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
    },
  });

  return {
    active: active ?? null,
    isFetching,
    setActive: (sessionId: string) => setActiveMutation.mutateAsync(sessionId),
    closeActive: () => closeMutation.mutateAsync(),
    isMutating: setActiveMutation.isMutating || closeMutation.isMutating,
  };
}
```
