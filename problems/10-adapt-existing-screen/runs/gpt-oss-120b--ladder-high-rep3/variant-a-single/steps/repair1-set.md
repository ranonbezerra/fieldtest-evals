# repair1-set

## reasoning

```
We need fix imports/types. In queries.ts onSuccess not allowed because useQuery expects options with onSuccess? Actually useQuery from react-query v4 has onSuccess in options. Need to import correct type? maybe need to use useQuery<Session>. Provide generic. Add generic to useQuery call: useQuery<Session>({ queryKey..., queryFn..., onSuccess... }). Also session param type. So modify useSession.

Also SessionDetailScreen expects session data from useSession which may be undefined. Need to handle possibly null. Let's open file? not given but we can adjust types: useSession returns UseQueryResult<Session | null>. In component, need to check loading or data?. We'll just add non-null assertion? Better cast.

Simplify: import { Session } type and use optional chaining.

Implement changes in SessionDetailScreen.tsx to handle possibly undefined and null.

We need to see file content to edit. Not provided but we can infer lines causing errors: accessing session.notes etc where session typed as {}. Likely they didn't type the query result. So change const { data: session } = useSession(id) as Session | null. Add type annotation: const { data: session } = useSession(id) as { data: Session | null }. Actually useSession returns UseQueryResult<Session | null>. So destructuring yields session: Session | undefined? It returns data?: Session | null. So type is Session | undefined | null. We'll set const { data: session } = useSession(id); then treat session?.notes etc.

Update file accordingly.

Provide changed files: src/features/sessions/queries.ts and src/features/sessions/SessionDetailScreen.tsx.
```

## reply

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
  return useQuery<Session | null>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      // Keep the active‑session query in sync with the fetched session.
      if (session && session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      } else {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
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
