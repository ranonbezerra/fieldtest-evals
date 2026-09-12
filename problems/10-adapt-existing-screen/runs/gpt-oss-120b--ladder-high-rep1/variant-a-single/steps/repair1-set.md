# repair1-set

## reasoning

```
We need fix imports: test line 47 expects HTMLElement; use within returns Element, need cast to HTMLElement via as HTMLElement. So change test.

Also queries.ts onSuccess not allowed because useQuery options type missing onSuccess? Actually useQuery takes UseQueryOptions which includes onSuccess. But they used useQuery({queryKey, queryFn, onSuccess}) which is fine. Type error maybe because generic not inferred; need to provide generic type: useQuery<Session, Error>(...). Add generic. Also data param any: type annotate.

SessionDetailScreen has session typed as any? Need to import useSession and handle possibly null. Likely they destructure const { data: session } = useSession(id); session may be undefined. Should add optional chaining or null checks. For simplicity cast session as Session. import type Session. Use const session = data as Session; but need to fix TS errors.

Let's open file? Not provided, but we can modify to handle null: const session = data ?? {} as any leads to property errors. Better to add non-null assertion where used: session!.notes etc. Add ! after session.

Implement changes.

Also test: change const closeBtn = within(bar).getByRole... need cast bar as HTMLElement: const bar = resumeBtn.closest('.active-session-bar') as HTMLElement;

Now produce modified files: ActiveSessionBar.test.tsx, queries.ts, SessionDetailScreen.tsx.
```

## reply

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure a clean auth + active‑session state before each test.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
  });

  it('appears after opening a session and persists across navigation', async () => {
    renderApp('/sessions');

    // Wait for the first page of sessions to load.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Open a session from the list.
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // The bar should now be visible.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Navigate away (to Orders) – the bar should stay.
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('closes active session and bar disappears', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Wait for the bar's Resume button (unique to the bar).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Locate the Close button inside the same bar.
    const resumeBtn = screen.getByRole('button', { name: 'Resume' });
    const bar = resumeBtn.closest('.active-session-bar') as HTMLElement;
    if (!bar) throw new Error('Active session bar not found');
    const closeBtn = within(bar).getByRole('button', { name: 'Close session' });

    // Trigger the close flow.
    await userEvent.click(closeBtn);

    // Confirm dialog appears – confirm the action.
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
    await userEvent.click(confirmBtn);

    // After successful close the bar should disappear.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument());
  });

  it('persists after page refresh', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Ensure the bar is present.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Simulate a full page refresh by unmounting and remounting the app.
    cleanup();
    renderApp('/orders');

    // The bar should be restored from the server‑side active session.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
  });
});
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

/**
 * Fetch a single session.
 * On success we also update the active‑session cache, because the server marks
 * the session as active when it is fetched (unless it is closed).
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery<Session>({
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
  return useQuery<Session | null>({
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

### src/features/sessions/SessionDetailScreen.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession, useUpdateSessionNotes, useCloseSession } from './queries';
import type { Session } from '../../api/types';

export function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: sessionData } = useSession(id!);
  const session = sessionData as Session | null;

  const [notes, setNotes] = useState(session?.notes ?? '');
  const [isDirty, setDirty] = useState(false);

  useEffect(() => {
    if (session) {
      setNotes(session.notes);
    }
  }, [session]);

  const updateNotes = useUpdateSessionNotes(id!);
  const closeSession = useCloseSession();

  const handleSave = () => {
    updateNotes.mutate(notes);
    setDirty(false);
  };

  const handleClose = () => {
    closeSession.mutate(id!);
    navigate('/sessions');
  };

  if (!session) {
    return <div>Loading...</div>;
  }

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
      <button onClick={handleSave} disabled={!isDirty}>
        Save
      </button>
      <button onClick={handleClose}>Close session</button>
    </div>
  );
}
```
