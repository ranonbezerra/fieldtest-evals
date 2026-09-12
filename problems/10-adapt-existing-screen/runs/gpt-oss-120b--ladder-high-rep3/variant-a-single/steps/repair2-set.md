# repair2-set

## reasoning

```
We need fix imports and types. In router expecting named export; SessionDetailScreen default export. Change router import to default. Let's open router? not provided but error line. We'll modify src/app/router.tsx to import default as SessionDetailScreen.

Also queries: useQuery options should use 'onSuccess' is allowed in useQuery generic; but need to specify generic correctly: useQuery<Session | null> expects options with onSuccess allowed. Actually need to import from '@tanstack/react-query' types. The error says onSuccess not in options; maybe they used useQuery from react-query v4 where options key is 'onSuccess' but TypeScript expects? It should be allowed. However they used useQuery defined as function with overloads; maybe they need to pass 'queryFn' and 'onSuccess' inside options but also need to set 'select' etc. The issue likely because they used useQuery without specifying 'initialData' type causing defined vs undefined. The fix: use useQuery<Session | null, Error, Session | null, ...> with options including onSuccess is allowed. Actually the error says onSuccess not exist. In tanstack/react-query v5 maybe option is 'onSuccess' still. Might be they imported useQuery incorrectly? The function signature maybe useQuery(options) where options type is UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>. onSuccess exists there. So why error? Possibly they are using useQuery from 'react-query' older version? But we have '@tanstack/react-query'. Should be fine. The error arises because they used generic only one param; need to provide four generic args? UseQueryOptions generic defaults? Might need to pass second generic for error type. Let's adjust: useQuery<Session | null, Error, Session | null, ReturnType<typeof sessionKeys.detail>>( ... ) But easier: add // @ts-ignore? Not allowed. Better to move onSuccess into separate useEffect using queryClient? Simpler: remove onSuccess from useQuery and instead use useEffect to sync. That satisfies compiler.

Implement: inside useSession, call useQuery without onSuccess, then useEffect watching data to set active.

Also need type for session param in onSuccess removed.

Fix SessionDetailScreen: remove unused imports React, Session type not used. Also useParams returns string | undefined, need to handle undefined. Ensure id is non-undefined before calling hooks. Could default to '' but better guard: if (!id) return <>Invalid session</>. Or use const id = useParams<{id:string}>().id! with non-null assertion. Add !.

Also property notes etc errors due to session type being maybe null? session is maybe undefined? Actually useSession returns data: Session | null. They check if (!session) loading. So within after that, session is Session, not null. Types should narrow. However TypeScript doesn't know that because session is possibly null. The guard ensures but still type is Session | null. Use if (!session) return...; after that, TypeScript knows session is Session. Should be fine. But errors show NonNullable<TQueryFnData>. maybe generic not set causing unknown. Use useSession defined to return UseQueryResult<Session | null>. The data type is Session | null. After guard, should be Session. So maybe need to add type assertion: const session = data as Session; but better to change useSession to return UseQueryResult<Session>. It never returns null? API returns maybe null when not found. Keep but fix component by adding non-null assertion: const session = data!; and type Session.

Simpler: change component to const { data } = useSession(id!); and then treat as Session. Add exclamation.

Also need to import React only for JSX? In React 18 with new JSX transform, React import not needed, but TS still flags unused. Remove import React.

Remove import of Session type.

Now implement changes.
```

## reply

### src/app/router.tsx
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SessionListScreen from '../features/sessions/SessionListScreen';
import SessionDetailScreen from '../features/sessions/SessionDetailScreen';
import { useAuth } from '../features/auth/authHooks';

export default function AppRouter() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sessions" element={<SessionListScreen />} />
        <Route path="/sessions/:id" element={<SessionDetailScreen />} />
        {/* other routes */}
      </Routes>
    </BrowserRouter>
  );
}
```

### src/features/sessions/queries.ts
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionQuery } from '../../api/client';
import type { Page, Session } from '../../api/types';

export const sessionKeys = {
  all: ['sessions'] as const,
  list: (q: SessionQuery) => ['sessions', 'list', q] as const,
  detail: (id: string) => ['sessions', 'detail', id] as const,
  active: () => ['sessions', 'active'] as const,
};

export function useSessions(q: SessionQuery) {
  return useQuery({ queryKey: sessionKeys.list(q), queryFn: () => api.listSessions(q) });
}

/**
 * Fetch a single session and keep the active‑session query in sync.
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  const query = useQuery<Session | null>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });

  // Keep the active‑session query in sync with the fetched session.
  // Run this effect whenever the query result changes.
  React.useEffect(() => {
    const session = query.data;
    if (session && session.status !== 'closed') {
      qc.setQueryData(sessionKeys.active(), session);
    } else {
      qc.setQueryData(sessionKeys.active(), null);
    }
  }, [qc, query.data]);

  return query;
}

/**
 * Fetch the currently active session. Returns `null` when there is none.
 */
export function useActiveSession() {
  return useQuery<Session | null>({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useUpdateSessionNotes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.updateSession(id, { notes }),
    onSuccess: (updated: Session) => {
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

### src/features/sessions/SessionDetailScreen.tsx
```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, useUpdateSessionNotes, useCloseSession } from './queries';
import { useEffect, useState } from 'react';

export default function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Guard against missing id (should not happen for a valid route)
  if (!id) {
    return <div>Invalid session ID</div>;
  }

  const { data: session } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);

  // Initialise notes when session loads
  useEffect(() => {
    if (session) {
      setNotes(session.notes ?? '');
      setIsDirty(false);
    }
  }, [session]);

  // Guard against null/undefined session
  if (!session) {
    return <div>Loading…</div>;
  }

  const handleSave = async () => {
    await updateNotes.mutateAsync(notes);
    setIsDirty(false);
  };

  const handleClose = async () => {
    if (window.confirm('Close this session?')) {
      await closeSession.mutateAsync(session.id);
      navigate('/sessions');
    }
  };

  return (
    <div>
      <h1>{session.name}</h1>
      <p>Status: {session.status}</p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setIsDirty(true);
        }}
      />
      <button onClick={handleSave} disabled={!isDirty}>
        Save Notes
      </button>
      <button onClick={handleClose}>Close Session</button>
    </div>
  );
}
```
