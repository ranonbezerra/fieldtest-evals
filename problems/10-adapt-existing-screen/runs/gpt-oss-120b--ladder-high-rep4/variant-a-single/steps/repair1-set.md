# repair1-set

## reasoning

```
We need to add onSuccess typing: useQuery from react-query v4 has option onSuccess allowed. Need to import appropriate types? Actually need to set generic for useQuery: useQuery<Session, Error>. Provide generic to accept onSuccess. So change useSession to specify generics.

Also SessionDetailScreen expects session from useSession query, need to handle undefined. Likely need to type data as Session | null. Let's open file? Not provided but errors indicate accessing session.notes etc on {}. Probably they destructure const { data: session } = useSession(id); need default {}. Should change to use optional chaining or provide default {}. Simplest: add nullish coalescing: const session = data ?? {} as Session; but better type.

We'll modify SessionDetailScreen to handle possibly undefined: use const { data: session } = useSession(id); then if (!session) return null; else render.

Implement guard.

Also fix import of onSuccess: just add generic.

Let's produce patches.
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
  return useQuery({ queryKey: sessionKeys.list(q), queryFn: () => api.listSessions(q) });
}

/** Fetch a single session detail. */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery<Session | null, Error>({
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
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, useUpdateSessionNotes, useCloseSession } from './queries';
import type { Session } from '../../api/types';

export default function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: session } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
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
