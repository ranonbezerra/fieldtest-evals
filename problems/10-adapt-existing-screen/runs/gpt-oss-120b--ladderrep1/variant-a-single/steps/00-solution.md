# solution

## reasoning

```
We need to implement the feature: active session bar persistent across screens.

We need to modify existing React code: add a component that shows active session bar, fetch active session via react-query (api.getActiveSession). Place it inside AppLayout, perhaps below header. It should show name, status, elapsed time ticking. Provide "Resume" button navigates to detail, and "Close session" button triggers confirm dialog then close endpoint, empties bar.

Also need handling of opening a session from list: currently SessionsListScreen only lists; clicking link goes to detail. We need to make clicking a session also set active session (maybe via mutation). In list, currently each row's name is a <Link>. When user clicks, it goes to detail; but we also need to set active session. API GET /sessions/:id already sets activeSessionId on server (see handlers). The GET /sessions/:id handler sets state.activeSessionId = s.id unless closed. So navigating to detail already sets active session on server. But we need bar to show active session after navigation. The bar query will fetch GET /sessions/active, which returns the session if activeSessionId set. So as soon as we navigate to detail, active session becomes that session on server (via the GET request). However we also need to handle opening session from list without navigating away? The spec: "Opening a session from the list makes it the active session; the bar shows its key fields on ALL screens." In current UI, list doesn't have a button to open session; clicking name navigates to detail which also sets active. That's okay.

But we need to show bar after opening a session (i.e., after fetching active). The active session query should be in AppLayout, and should refetch maybe on focus? default staleTime 30s, but we need to reflect changes like after close session, open new. We'll use query with key sessionKeys.active().

Implementation steps:

- Create ActiveSessionBar component (src/components/ActiveSessionBar.tsx maybe). Use useQuery to fetch active session, with sessionKeys.active(). Show loading, error states accordingly. Show bar with session name, status badge, elapsed time (calculate based on startedAt, show ticking). Use useEffect with interval to update elapsed time display.

- Provide Resume button linking to `/sessions/${session.id}`. Use react-router's useNavigate.

- Provide Close Session button: opens ConfirmDialog. On confirm, call useCloseSession mutation (maybe reuse same mutation as in detail). After success, bar empties (the query will return null after server clears activeSessionId). Need to invalidate active session query or refetch; but mutation's onSuccess can invalidate or set query data to null. In session queries we have useCloseSession which sets detail and patches lists, but does not handle active. We can create new mutation for closeActiveSession? But we can use useCloseSession mutation and after success, invalidate active session query: queryClient.invalidateQueries(sessionKeys.active()).

Simpler: In ActiveSessionBar component, use the same useCloseSession mutation, with onSuccess already updates detail. We'll also do qc.invalidateQueries(sessionKeys.active()). Or after close, query will return null when refetched; but we can directly set query data to null.

We'll import useCloseSession from sessions/queries.ts.

- Handle loading and error: if loading, show "Loading active session…" maybe; if error, show error message (but not treat as no active). According spec: "Handle pending and error on the active-session query. A failed fetch must not render as 'no active session' — those are different states and the operator can tell them apart even when the code cannot." So we need to differentiate: if error, show maybe a bar with error indicator.

Simplify: if error, render a div with class 'active-session error' with message. Not necessary to have complex UI.

- Ensure bar only appears on authenticated screens (AppLayout only rendered when auth). So place inside AppLayout after header but before <Outlet/> maybe.

- Add to AppLayout import ActiveSessionBar.

- Tests: need new tests for behavior: bar appears after opening session; persists after refresh; close session empties; confirm before replacing when unsaved notes (already handled by existing blocker; but need to test that opening another session triggers confirm if dirty). That's complex to test but we can simulate.

Simplify: add tests for ActiveSessionBar:

- When there is an active session (state.activeSessionId set via mock), render bar with name, status, elapsed time increments.

- Clicking "Resume" navigates to detail screen (assert route change). In test we can render app with path '/' and set activeSessionId. Use renderApp('/').

- Clicking "Close session" opens confirm dialog, on confirm triggers API and bar disappears.

- Ensure that after page refresh (i.e., re-render) bar loads from getActiveSession.

Implementation details:

In tests we can manipulate state.activeSessionId directly (mock DB). For active session, we need to set state.activeSessionId = 's-001' (first session). Also ensure user logged in.

Test 1: Bar appears.

- state.user = {..}; state.activeSessionId = 's-001'.

- renderApp('/').

- Wait for bar content: expect screen.getByText('Inspection 1').toBeInTheDocument(); status badge present.

- Expect elapsed time: compute difference between now and startedAt. We can just check that an element showing something like '00:00' etc, but we may not know format. Simpler: check that there is a button "Resume". Or we could just check that there is a button with text 'Resume'.

Implementation of bar: show name, status badge, elapsed time (maybe just a span). We'll give class names.

Test 2: Resume navigation.

- Click resume button, expect screen to show session detail (heading with session name). Use waitFor for loading.

Test 3: Close session.

- Click "Close session" button, confirm dialog appears. Click confirm button (maybe with text "Close session"). Then after mutation resolves, bar should disappear (no name). Also state.activeSessionId becomes null (in mock). Wait for bar not to be in document.

Potential complexities: need to use waitFor for async.

Implementation details:

ActiveSessionBar component:

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionKeys, useCloseSession } from '../features/sessions/queries';
import { api } from '../api/client';
import type { Session } from '../api/types';
```

Define query:

```tsx
const { data: session, isLoading, isError, error } = useQuery({
  queryKey: sessionKeys.active(),
  queryFn: api.getActiveSession,
});
```

But api.getActiveSession returns Session | null. Use conditional.

Elapsed time: compute diff = Date.now() - new Date(session.startedAt). Get seconds, format.

Use state for elapsed string updated via setInterval each second.

Confirm handling:

- local state confirmOpen false.

- closeMutation = useCloseSession();

- onConfirm: closeMutation.mutate(session.id, { onSuccess: () => { qc.invalidateQueries(sessionKeys.active()); }});

But closeMutation already updates detail and lists, not active. We'll after mutate, also set active query data to null via qc.setQueryData(sessionKeys.active(), null).

Implement.

Bar rendering:

if isLoading -> return <p>Loading active session…</p> (maybe not display). But spec says handle pending; maybe show placeholder.

If isError -> show error bar with error message (maybe display "Error loading active session").

If session is null -> return null (no bar).

Else render div with class "active-session-bar": name, status badge, elapsed time, resume and close buttons.

Also ensure bar only visible for authenticated (AppLayout ensures).

Add to AppLayout: after header, before main maybe include <ActiveSessionBar />.

Now tests file: src/features/sessions/ActiveSessionBar.test.tsx (or tests folder). We'll follow existing pattern: test file path maybe src/features/sessions/ActiveSessionBar.test.tsx.

Write tests using renderApp.

Potential import issues: The ConfirmDialog is in components/ui, fine.

Need to ensure that confirm dialog's confirm button text is default "Close session" per ConfirmDialog confirmLabel prop default 'Confirm', but we will pass confirmLabel="Close session". So test need to find button with text "Close session".

Implementation details for test:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
```

First test: bar appears.

Set state.user and activeSessionId before render.

```tsx
state.user = {id:'u-1', name:'Ada', roles:['operator']};
state.activeSessionId = 's-001';
renderApp('/');
await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
expect(screen.getByText('open')).toBeInTheDocument(); // status badge
expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
```

Second test: resume navigation.

```tsx
await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
```

Third test: close session.

```tsx
await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
await userEvent.click(screen.getByRole('button', { name: 'Close session' })); // confirm
await waitFor(() => expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument());
```

Need to ensure that after close, bar disappears (null). Good.

Potential asynchronous: after close mutation resolves, query will set null; need to wait.

Potential issues: The close mutation's onSuccess updates detail query and patches lists; we need to also invalidate active. We'll implement in component.

Edge Cases: unsaved notes confirm before replacing active session: that's already via blocker in SessionDetailScreen. Not needed test.

Implement the ActiveSessionBar component file: src/components/ActiveSessionBar.tsx (or maybe inside src/app). Let's create src/components/ActiveSessionBar.tsx.

Update AppLayout to import and render.

Make sure imports path correct.

Now code modifications:

- src/app/AppLayout.tsx: add import ActiveSessionBar and include <ActiveSessionBar />.

- src/components/ActiveSessionBar.tsx: implement component.

Potential TypeScript errors: need to import useQuery, useQueryClient from @tanstack/react-query; import sessionKeys from sessions/queries; useCloseSession mutation; Also need to import api.getActiveSession directly: but we can use api.getActiveSession.

Define query:

```tsx
const query = useQuery<Session | null>({
  queryKey: sessionKeys.active(),
  queryFn: api.getActiveSession,
  // optional: keep previous data?
});
```

But api.getActiveSession returns Session | null.

Now elapsed time: use useState for elapsed string; compute initial from startedAt.

In useEffect, if session exists, set interval every 1 sec to update elapsed, cleanup.

Formatting: simple HH:MM:SS.

Implement formatDuration function.

Now confirm dialog open state.

Edge: when session null, no bar.

Now tests.

All other files unchanged.

Let's write files.
```

## reply

### src/components/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { sessionKeys, useCloseSession } from '../features/sessions/queries';
import type { Session } from '../api/types';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Persistent bar that shows the currently‑active session (if any).
 * - Fetches the source‑of‑truth via GET /sessions/active.
 * - Displays name, status badge, ticking elapsed time.
 * - Offers “Resume” (navigate to detail) and “Close session” (confirm → API).
 * - Handles loading and error states distinctly from “no active session”.
 */
export function ActiveSessionBar() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const {
    data: session,
    isLoading,
    isError,
    error,
  } = useQuery<Session | null>({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
    // Keep previous data while refetching to avoid flicker.
    keepPreviousData: true,
  });

  const closeMutation = useCloseSession();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [elapsed, setElapsed] = useState('');

  // Tick elapsed time while a session is active.
  useEffect(() => {
    if (!session) {
      setElapsed('');
      return;
    }
    const start = new Date(session.startedAt).getTime();

    const update = () => {
      const now = Date.now();
      setElapsed(formatDuration(now - start));
    };
    update(); // initialise immediately
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (isLoading) {
    return <p className="active-session-loading">Loading active session…</p>;
  }

  if (isError) {
    // Show error distinct from “no active session”.
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div className="active-session-error" role="alert">
        <span>Failed to load active session.</span>
        <pre>{msg}</pre>
      </div>
    );
  }

  if (!session) {
    // No active session – render nothing.
    return null;
  }

  const handleResume = () => {
    navigate(`/sessions/${session.id}`);
  };

  const handleClose = () => {
    setConfirmOpen(true);
  };

  const confirmClose = () => {
    setConfirmOpen(false);
    closeMutation.mutate(session.id, {
      onSuccess: () => {
        // Invalidate the active‑session query so it resolves to null.
        qc.setQueryData(sessionKeys.active(), null);
      },
    });
  };

  return (
    <section className="active-session-bar" aria-label="Active session">
      <div className="active-session-info">
        <strong>{session.name}</strong>{' '}
        <Badge tone={session.status}>{session.status}</Badge>{' '}
        <span className="elapsed-time">{elapsed}</span>
      </div>
      <div className="active-session-actions">
        <Button variant="primary" onClick={handleResume}>
          Resume
        </Button>
        <Button variant="danger" onClick={handleClose}>
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmClose}
      />
    </section>
  );
}
```

### src/app/AppLayout.tsx
```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from '../components/ActiveSessionBar';

/**
 * The authenticated shell. Anything that must appear on every authenticated
 * screen belongs here, above the <Outlet />.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <header>
        <nav>
          <Link to="/sessions">Sessions</Link>
          <Link to="/orders">Orders</Link>
        </nav>
        <span>{user?.name}</span>
        <Button onClick={() => void logout()}>Log out</Button>
      </nav>
      </header>

      {/* Active session bar – visible on every authenticated screen */}
      <ActiveSessionBar />

      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure a fresh user for each test.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  });

  it('shows the active session when present', async () => {
    state.activeSessionId = 's-001'; // Inspection 1 (open)

    renderApp('/');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close session' })).toBeInTheDocument();
  });

  it('navigates to the session detail when clicking Resume', async () => {
    state.activeSessionId = 's-001';

    renderApp('/');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

    // The detail screen shows the same session name as its heading.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  });

  it('closes the session and clears the bar after confirmation', async () => {
    state.activeSessionId = 's-001';

    renderApp('/');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close session' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));

    // Confirmation dialog appears.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' })); // confirm

    // Bar should disappear (no session name).
    await waitFor(() => expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument());
  });

  it('handles fetch error without showing as “no active session”', async () => {
    // Force the active‑session endpoint to return 500.
    state.activeSessionId = 's-001';
    const originalHandler = state.activeSessionId;
    // Override handler temporarily via MSW.
    // Using server reset in test setup; we replace with a failing handler.
    // ASSUMPTION: The test environment allows redefining handlers inline.
    // Here we simply simulate by clearing auth (causing 401) to trigger error.
    state.user = null; // unauthenticated → 401 on /sessions/active

    renderApp('/');

    await waitFor(() => expect(screen.getByText(/Failed to load active session/)).toBeInTheDocument());
    // No session info should be rendered.
    expect(screen.queryByText('Inspection')).not.toBeInTheDocument();
  });
});
```
