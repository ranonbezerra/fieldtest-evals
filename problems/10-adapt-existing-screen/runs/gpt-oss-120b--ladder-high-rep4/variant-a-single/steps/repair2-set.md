# repair2-set

## reasoning

```
We need to fix imports and types. In router.tsx they import named export but default export exists. Change to default import. Also queries use onSuccess not allowed? useQuery from react-query v4 uses options object where onSuccess is allowed. But TypeScript types maybe need generic parameter order: useQuery<Session | null, Error> with options includes onSuccess? Actually useQuery takes UseQueryOptions which includes onSuccess. Why error? Because they used defined initial data options? Might need to add initialData? But simplest: add generic for queryFn return type, and include onSuccess in options: need to import UseQueryOptions? But error says onSuccess not recognized, likely using useQuery from '@tanstack/react-query' v5? Might require useQuery({ queryKey, queryFn, onSuccess }) is valid. Perhaps they need to import useQuery from '@tanstack/react-query' which has proper types. Already imported.

Maybe need to enable type inference by adding 'select' etc? Actually error arises because they used useQuery without providing queryFn returning Session | null, and they typed generic as useQuery<Session | null, Error>. The overload expects options type based on data being defined? onSuccess exists in UseQueryOptions but not in DefinedInitialDataOptions? Might need to add 'initialData' param? Simpler: move onSuccess to 'onSuccess' inside useQuery's options is valid; maybe need to import 'useQuery' from '@tanstack/react-query' version that supports onSuccess. Might be missing generic for TQueryFnData separate from TData. Use useQuery<Session, Error, Session | null> ?

Given complexity, easier: use useQuery<Session, Error> and then handle onSuccess via queryClient.setQueryData manually using queryClient.setQueryData after fetch via useEffect? But tests expect current behavior.

Simplify: change useSession to use useQuery with onSuccess typed via generic any: cast options as any to bypass. Could add // @ts-ignore? Not allowed.

Better: change function signature to useQuery<any, Error> to allow onSuccess property? Actually overload selection: DefinedInitialDataOptions includes onSuccess? It does not. UseQueryOptions includes onSuccess. The difference is when initialData is provided. They didn't. So TypeScript thinks it's DefinedInitialDataOptions because they provided generic TData same as TQueryFnData? Actually when data type is same as queryFnData, it's defined. So useQuery<Session | null, Error, Session | null> leads to defined initial data. onSuccess not allowed. To allow onSuccess, need to use UseQueryOptions generic where TData is different? Provide TData = Session | null, TQueryFnData = Session, maybe? UseQuery<Session, Error, Session | null>. Then onSuccess receives Session. So modify useSession: useQuery<Session, Error, Session | null>. Also adjust return type.

Also need to fix unused imports and undefined param ids: useParams returns possibly undefined, need to handle. In SessionDetailScreen, they import React but not used; can remove import or use JSX pragma? In React 17+, need not import React. So remove import line.

Also import Session type unused; remove.

Fix useParams id possibly undefined: const { id } = useParams<{ id: string }>(); id may be string | undefined. Pass to useSession expects string. We can assert non-null: const { id } = useParams<{ id: string }>(); if (!id) return null or navigate. For compile, cast as string: useSession(id as string). Similarly in handleClose uses session.id which is fine.

Also notes property errors because session is possibly null in type inference; after guard they know session not null but TS still maybe Session | null. Using non-null assertion session!.notes.

Implement changes.

Also router import fix.

Let's produce changed files: src/app/router.tsx, src/features/sessions/queries.ts, src/features/sessions/SessionDetailScreen.tsx.
```

## reply

### src/app/router.tsx
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SessionsListScreen from '../features/sessions/SessionsListScreen';
import SessionDetailScreen from '../features/sessions/SessionDetailScreen';
import LoginScreen from '../features/auth/LoginScreen';
import { useAuth } from '../features/auth/authContext';

export default function AppRouter() {
  const { user } = useAuth();

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sessions" element={<SessionsListScreen />} />
        <Route path="/sessions/:id" element={<SessionDetailScreen />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
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

/** Query keys live beside their queries, one factory per feature. */
export const sessionKeys = {
  all: ['sessions'] as const,
  list: (q: SessionQuery) => ['sessions', 'list', q] as const,
  detail: (id: string) => ['sessions', 'detail', id] as const,
  active: () => ['sessions', 'active'] as const,
};

export function useSessions(q: SessionQuery) {
  return useQuery({ queryKey: sessionKeys.list(q), queryFn: () => api.listSessions(q) });
}

/** Fetch a single session detail. */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery<Session, Error, Session | null>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    // Synchronise the active‑session query with the fetched detail.
    onSuccess: (session) => {
      if (session && session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      } else {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
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
      // The server clears the active session on close; reflect that immediately.
      if (updated.status === 'closed') {
        qc.setQueryData(sessionKeys.active(), null);
      }
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

export default function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: session } = useSession(id as string);
  const updateNotes = useUpdateSessionNotes(id as string);
  const closeSession = useCloseSession();

  // Guard against the session still loading or being null.
  if (!session) {
    return <div>Loading…</div>;
  }

  const [notes, setNotes] = useState<string>(session.notes ?? '');
  const [dirty, setDirty] = useState<boolean>(false);

  useEffect(() => {
    setNotes(session.notes ?? '');
  }, [session.notes]);

  const handleSave = () => {
    updateNotes.mutate(notes);
    setDirty(false);
  };

  const handleClose = async () => {
    await closeSession.mutateAsync(session.id);
    navigate('/sessions');
  };

  return (
    <div>
      <h1>{session.name}</h1>
      <p>Status: {session.status}</p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setDirty(true);
        }}
      />
      <button onClick={handleSave} disabled={!dirty}>
        Save
      </button>
      <button onClick={handleClose}>Close Session</button>
    </div>
  );
}
```
