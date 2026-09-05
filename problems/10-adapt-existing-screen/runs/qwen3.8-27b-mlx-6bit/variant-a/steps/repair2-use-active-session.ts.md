# repair2-use-active-session.ts

## reasoning

```
Let me analyze the two compiler errors:

1. `src/features/sessions/session-detail.tsx(5,28): error TS2305: Module '"./use-active-session"' has no exported member 'ApiError'.`
   - This means `session-detail.tsx` imports `ApiError` from `./use-active-session`, but it's not exported there. I need to re-export `ApiError` from this file.

2. `src/features/sessions/use-active-session.ts(73,5): error TS2322: Type '(sessionId: string) => Promise<ActiveSession>' is not assignable to type '(sessionId: string) => Promise<void>'.`
   - The `setActive` function is typed as `(sessionId: string) => Promise<void>` in the interface, but the implementation returns `Promise<ActiveSession>`. I need to fix the implementation to match the interface (return `void`), or change the interface.

Looking at the plan:
```ts
setActive: (sessionId: string) => Promise<void>;
```

The plan says `setActive` returns `Promise<void>`. So the implementation should match. The mutation likely returns the active session from the API, but the hook's public API promises `void`. So I need to make the implementation return `void` (not the resolved value).

Now let me reconstruct the file. I don't have the current content of `use-active-session.ts`, but I need to write it complete. Let me infer from the plan and the errors:

- It exports `ActiveSession` interface
- It exports `useActiveSession` hook returning `UseActiveSessionResult`
- It needs to re-export `ApiError` (from `../../api/client`)
- The `setActive` mutation must return `Promise<void>` not `Promise<ActiveSession>`

From the plan:
- Uses react-query
- Query key for `GET /sessions/active`
- Mutation for `PUT /sessions/active` (setActive)
- Mutation for `POST /sessions/:id/close` (closeActive)
- On success of setActive: invalidate + refetch GET /sessions/active
- On success of closeActive: refetch GET /sessions/active (server returns null)

Wait, looking at the API client, `closeSession` is `POST /sessions/:id/close` and returns `Session`. The plan says "On success the server returns null (no active session) and the bar empties." But looking at the actual client, `closeSession` returns `request<Session>`. The plan also says `GET /sessions/active` is the source of truth, so after closing we just refetch that.

Let me also look at what the API client has:
- `getActiveSession: () => request<Session | null>('/sessions/active')`
- `closeSession: (id: string) => request<Session>(`/sessions/${id}/close`, { method: 'POST' })`

There's no `setActiveSession` in the client. The plan says `PUT /sessions/active`. I'll need to use the raw API or... wait, looking more carefully at the client, there's no PUT method for setting active. But the plan says to use it. I'll need to make a direct fetch call or... Actually, let me re-read the constraints.

The plan says:
- **Set-active endpoint**: `PUT /sessions/active` with body `{ sessionId: string }`, returning the `ActiveSession` object.

But the client doesn't have this method. I should either:
1. Add it to the client (but the task says "Change nothing the messages do not name")
2. Use a direct fetch in the hook

Actually, the task says "Rewrite `src/features/sessions/use-active-session.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

So I should only change what's needed to fix those two errors. But I don't have the original file content... I need to write the complete file.

Let me think about what the file likely contains based on the errors and plan:

The error at line 73 says the implementation returns `Promise<ActiveSession>` but should return `Promise<void>`. This suggests the mutation's `onSuccess` or the mutationFn itself returns the active session but the public API should be void.

For the `ApiError` export - I need to re-export it from `../../api/client`.

Let me write the complete file:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';

export { ApiError };

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

const activeSessionKey = ['sessions', 'active'] as const;

export function useActiveSession(): UseActiveSessionResult {
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: activeSessionKey,
    queryFn: async () => {
      const session = await api.getActiveSession();
      return session as ActiveSession | null;
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      await fetch(`/api/sessions/active`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activeSessionKey });
    },
  });

  const closeActiveMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!data) return;
      await api.closeSession(data.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activeSessionKey });
    },
  });

  return {
    active: data ?? null,
    isFetching,
    setActive: (sessionId: string) => setActiveMutation.mutateAsync(sessionId),
    closeActive: () => closeActiveMutation.mutateAsync(),
    isMutating: setActiveMutation.isPending || closeActiveMutation.isPending,
  };
}
```

Wait, but the plan says `setActive` should raise `ApiError { code: 'session_not_found' }` if the id is invalid. If I use raw fetch, I need to handle errors like the `request` function in the client does. Let me adjust:

```ts
mutationFn: async (sessionId: string): Promise<void> => {
  const res = await fetch(`/api/sessions/active`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    throw new ApiError(res.status, body.code ?? 'unknown');
  }
},
```

Actually wait - I need to think about this differently. The task says "Change nothing the messages do not name." The two errors are:
1. `ApiError` is not exported from this module
2. The return type of `setActive` implementation doesn't match the interface

So the minimal fix is:
1. Add `export { ApiError }` (re-export from client)
2. Change the mutation to return `Promise<void>` instead of `Promise<ActiveSession>`

But I don't have the original file, so I need to write it complete. Let me make sure my version satisfies both errors and the plan.

The key constraint from error 2: the `setActive` in the returned object must be `(sessionId: string) => Promise<void>`. If the mutation's `mutateAsync` returns `Promise<ActiveSession>` because that's what `mutationFn` returns, then I need to wrap it or change `mutationFn` to return `void`.

The cleanest approach: make `mutationFn` return `Promise<void>` (just don't return the response body).

Let me finalize my answer. I'll write a clean, complete file that:
1. Re-exports `ApiError`
2. Has `setActive` return `Promise<void>`
3. Follows the plan's behavior
4. Uses react-query properly

One more consideration: the plan says "Invalidates + refetches GET /sessions/active on success" for `setActive`. Using `invalidateQueries` will trigger a refetch, so that's fine.

Also the plan mentions the `ActiveSession` type has fields matching what `GET /sessions/active` returns. The client's `getActiveSession` returns `Session | null`. I need to check if `Session` is compatible with `ActiveSession`. Since I can't see the `Session` type, I'll just cast it or use it directly. Actually, looking at the plan's type definition, `ActiveSession` has `id`, `name`, `status`, `startedAt`. The `Session` type likely has all these fields plus more (like `notes`). So I can just use `Session` directly or cast.

Actually, to keep it simple and match the plan exactly, I'll define `ActiveSession` as the plan says and cast the query result to it. Or better, I'll just type the query as returning `ActiveSession | null` since the API returns that shape (at minimum those fields).

Let me write the final version.
```

## reply

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';

export { ApiError };

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

const activeSessionKey = ['sessions', 'active'] as const;

export function useActiveSession(): UseActiveSessionResult {
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: activeSessionKey,
    queryFn: async (): Promise<ActiveSession | null> => {
      const session = await api.getActiveSession();
      return (session as ActiveSession) ?? null;
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      const res = await fetch(`/api/sessions/active`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new ApiError(res.status, body.code ?? 'unknown');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activeSessionKey });
    },
  });

  const closeActiveMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!data) return;
      await api.closeSession(data.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activeSessionKey });
    },
  });

  return {
    active: data ?? null,
    isFetching,
    setActive: (sessionId: string) => setActiveMutation.mutateAsync(sessionId),
    closeActive: () => closeActiveMutation.mutateAsync(),
    isMutating: setActiveMutation.isPending || closeActiveMutation.isPending,
  };
}
```
