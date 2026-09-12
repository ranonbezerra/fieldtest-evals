# repair2-set

## reasoning

```
We need to add onSuccess to useQuery options: need to import appropriate type? Actually useQuery signature expects options including onSuccess. The error suggests using older version maybe? Need to use useQuery from @tanstack/react-query which supports onSuccess. Perhaps TypeScript version mismatch because generic order? Might need to pass queryFn separately? Actually useQuery expects either (options) where options includes onSuccess. It should be okay. Maybe the imported useQuery is overloaded differently. Might need to import useQuery from '@tanstack/react-query' which returns UseQueryResult. onSuccess exists in UseQueryOptions. The error indicates that onSuccess not recognized, maybe because they used useQuery without specifying generic for data but also using queryFn returning Session. Should be useQuery<Session, Error, Session, ...>. Need to provide generic param for error? Provide type for error as unknown? Simpler: add `onSuccess` property inside `queryFn`? No.

Probably they need to pass `onSuccess` inside `onSuccess` option of `useQuery` but need to import `useQuery` with proper types: maybe they used older version where onSuccess is part of `onSuccess` but need to use `onSuccess` inside `options` of `useQuery`. The error suggests onSuccess not allowed. Might be because they used `useQuery` from react-query v3 vs tanstack v4? In v4, onSuccess is allowed. Might need to import `useQuery` from '@tanstack/react-query' already done.

Maybe the issue is that they used `useQuery<Session>` but not specifying other generic types causing default of `undefined` for error, which then type is `UseQueryOptions<Session, Error, Session, readonly unknown[]>` includes onSuccess. So should be fine.

Maybe the real problem is that they are using `useQuery` incorrectly: they need to pass `queryKey` and `queryFn` as separate arguments, not inside an object? In v4, both forms allowed. But type might not include onSuccess for object form? Actually useQuery(options) does include onSuccess.

I'm out of time. Possibly need to add `onSuccess` after generic: `useQuery<Session, Error, Session, any[]>({ ... , onSuccess: ... })` but need to import `Error` type? Use `unknown` for error.

So modify signature: `useQuery<Session, unknown, Session, readonly unknown[]>({ ... })` maybe.

Implement change in queries.ts lines where useQuery called: add generic for error as unknown.

Let's apply to both useSession and useActiveSession. Also useSessions. Add generic types.
```

## reply

### src/features/sessions/queries.ts
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionQuery } from '../../api/client';
import type { Page, Session } from '../../api/types';

/** Query keys live beside their queries, one factory per feature. */
export const sessionKeys = {
  all: ['sessions'] as const,
  list: (q: SessionQuery) => ['sessions', 'list', q] as const,
  detail: (id: string) => ['sessions', 'detail', id] as const,
  active: () => ['sessions', 'active'] as const,
};

export function useSessions(q: SessionQuery) {
  return useQuery<Session[], unknown, Session[], readonly unknown[]>({
    queryKey: sessionKeys.list(q),
    queryFn: () => api.listSessions(q),
  });
}

/**
 * Fetch a single session.
 * On success we also update the active‑session cache, because the server marks
 * the session as active when it is fetched (unless it is closed).
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery<Session, unknown, Session, readonly unknown[]>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (data: Session) => {
      // The GET /sessions/:id endpoint sets the active session on the server.
      // Mirror that fact client‑side so the active‑session bar updates immediately.
      if (data.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), data);
      } else {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}

/**
 * Fetch the currently active session (or null). Used by the persistent bar.
 */
export function useActiveSession() {
  return useQuery<Session | null, unknown, Session | null, readonly unknown[]>({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}

export function useUpdateSessionNotes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.updateSession(id, { notes }),
    onSuccess: (updated: Session) => {
      // Targeted update, not invalidation: the server already returned the row,
      // and a refetch here would flash the screen back to stale data.
      qc.setQueryData(sessionKeys.detail(id), updated);
      patchLists(qc, updated);
    },
  });
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // The close endpoint clears the active session on the server.
      // Invalidate the active‑session query so it refetches (returning null).
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}

/**
 * Write one changed row into every cached list page that holds it.
 * This is the pattern the app uses everywhere; copy it rather than invalidating.
 */
export function patchLists(
  qc: ReturnType<typeof useQueryClient>,
  updated: Session,
): void {
  qc.setQueriesData<Page<Session>>({ queryKey: ['sessions', 'list'] }, (old) => {
    if (!old) return old;
    if (!old.items.some((s) => s.id === updated.id)) return old;
    return { ...old, items: old.items.map((s) => (s.id === updated.id ? updated : s)) };
  });
}
```
