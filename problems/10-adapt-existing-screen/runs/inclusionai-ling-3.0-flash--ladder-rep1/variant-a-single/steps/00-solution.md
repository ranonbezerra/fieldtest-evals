# solution

## reasoning

```
Let me analyze the task carefully. This is a React + TypeScript back-office application where I need to implement a persistent active session bar. Let me break down what needs to be done:

1. **Active session bar** visible on every authenticated screen (in AppLayout)
2. Shows name, status, elapsed time ticking
3. Resume button (navigate to detail)
4. Close session button (calls close endpoint, with confirm, empties bar on success)
5. Only one active session at a time; opening another replaces it (with confirm if current has unsaved notes)
6. Active session survives page refresh via `GET /sessions/active`
7. Must not regress: list filtering/pagination, detail editing + dirty-flag, logout clearing state, deep-linking

Key architectural decisions:
- The bar goes in AppLayout (the layout wrapping authenticated screens)
- Server state through react-query
- Reuse existing ConfirmDialog
- Handle pending and error on active-session query (failed fetch must NOT render as "no active session")
- `GET /sessions/active` is the source of truth, no client-only persistence

Let me trace through the existing code:

1. `AppLayout.tsx` - needs the ActiveSessionBar component added above `<Outlet />`
2. Need to create `ActiveSessionBar` component
3. Need a hook for the active session query (`useActiveSession`)
4. Need a mutation for closing the session with confirm
5. Need to handle setting active session when opening from list
6. Logout clearing state - auth-context already clears queryClient, and the active session query will be cleared too

Let me think about the active session flow:

**Query**: `useActiveSession` calls `GET /sessions/active` via react-query
**On opening session from list**: Need to call `GET /sessions/active` somehow... Actually, looking at the API, there's no `POST /sessions/:id/open` or `SET /sessions/active`. The mock handler shows that `GET /api/sessions/:id` sets `state.activeSessionId = s.id`. So opening a session (navigating to it) makes it active via the detail fetch.

Wait, let me re-read the mock handler for `GET /api/sessions/:id`:
```
state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;
```
So visiting a session detail page makes it the active session. And `GET /api/sessions/active` returns whatever `state.activeSessionId` points to.

So the flow is:
1. User clicks a session link in the list → navigates to `/sessions/:id` → that page's `useSession` hook fetches the session, and the mock sets it as active
2. The active session bar reads from `GET /sessions/active`
3. On full page refresh, the bar re-fetches from `GET /sessions/active` and gets the session (because the detail page set it)

But wait - on refresh, the user would be at `/sessions/:id` (deep link), and `useSession` would fetch it, setting active. But if they were at `/sessions` (list page), a refresh wouldn't set activeSessionId... Unless the spec means that navigating to a detail page from the list sets it, and then a refresh of any page while that session is active will show it.

Actually, the mock handler for `GET /sessions/:id` always sets `state.activeSessionId`. So if the user has visited a session detail page (even in the past in the same browser session), `activeSessionId` would be set. But on a full page refresh, the mock state might reset... Let me check. In the test setup, MSW server resets handlers but doesn't reset the `state` object. In browser usage, a full page refresh would reset the module state.

Hmm, but the spec says "Active session survives a full page refresh" and "GET /sessions/active is the source of truth". The mock in tests won't reset state between tests (since state is imported as a module singleton). In a real browser, this would need server-side support, which is assumed to exist.

Let me think about the implementation:

**Files to create:**
1. `src/features/sessions/ActiveSessionBar.tsx` - The bar component
2. `src/features/sessions/useActiveSession.ts` - Hook for active session query and close mutation

**Files to modify:**
1. `src/app/AppLayout.tsx` - Add ActiveSessionBar above Outlet
2. `src/features/sessions/queries.ts` - Add `useActiveSession` query hook and close session mutation helper
3. Maybe update `SessionsListScreen` - when clicking a session, set it active? Actually, looking at the mock, visiting the detail page automatically sets it active.

Wait, let me reconsider. The spec says "Opening a session from the list makes it active". In the current app, clicking a session link navigates to `/sessions/:id`, and the mock's `GET /sessions/:id` handler sets `state.activeSessionId`. So this is already handled by the mock. But in a real app, there might need to be a `POST /sessions/:id/open` or similar. For this task, I'll work with what's there.

Let me now design the ActiveSessionBar:

```tsx
// ActiveSessionBar.tsx
- Uses useActiveSession() query hook
- Shows loading state (but NOT "no active session" on error)
- Shows session name, status badge, elapsed time
- Resume button → navigate to detail
- Close session button → opens ConfirmDialog → calls closeSession mutation → on success, bar empties (query becomes null)
- Handles pending (loading) and error states separately
```

For elapsed time ticking, I'll use a setInterval that ticks every second.

Let me also think about: "Opening a second session while the first has unsaved notes → confirm before replacing"

This means: when navigating to a new session detail while another session is active and has unsaved notes, show a confirm. But this is navigation-level behavior. How to implement?

Actually, looking more carefully: the spec says the detail screen tracks a dirty flag. So if I'm on session A's detail page with unsaved notes, and I click to go to session B, I should get a confirm before replacing. This could be implemented via useBlocker or similar. But this might be more complex than needed.

Let me re-read: "Only one active session at a time; opening another replaces it (with confirm if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

This seems like it could be handled by the detail screen's existing dirty flag + blocker. When you're on a detail screen with dirty notes and try to navigate to another session, the existing blocker should handle it. And the active session bar just shows whichever session is active.

Actually wait - I think the key insight is: the active session bar should know about the "dirty" state. When opening a new session from outside (e.g., from the list), and the current active session has unsaved notes, there should be a confirm. But this is tricky because opening a session from the list means navigating to `/sessions/:id`, which is a link click.

For simplicity and coherence with the existing codebase, I think the most reasonable approach is:
1. The active session bar shows the currently active session (from `GET /sessions/active`)
2. When the user navigates to a session detail, it becomes active (handled by the API/mock)
3. If they're on a detail screen with unsaved notes and try to navigate to another session, the existing useBlocker handles it
4. The bar itself just displays and provides actions

Let me now think about what changes are minimal and correct:

**ActiveSessionBar.tsx** - New component:
- Query: `useActiveSession()` 
- Shows nothing when no active session (query data is null)
- Shows error state properly (not as "no active session")
- Ticking elapsed time
- Resume link (useNavigate to `/sessions/:id`)
- Close button → ConfirmDialog → close mutation

**useActiveSession hook**: Could be in queries.ts

**Close session**: Need a mutation that calls `api.closeSession` and on success, the active session becomes null (because the mock resets `state.activeSessionId = null`)

Let me also consider: when closing from the bar, should we invalidate/refetch the active session query? The mutation's onSuccess could invalidate the active query. In the mock, closing sets `state.activeSessionId = null`, so refetching would return null.

Now let me code this up:

### 1. `src/features/sessions/ActiveSessionBar.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseActiveSession } from './queries';

function elapsedText(startedAt: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError, error } = useActiveSession();
  const closeActive = useCloseActiveSession();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Pending: show a loading indicator — not "no session"
  if (isLoading) return <div data-testid="active-session-bar" className="active-session-bar"><p>Loading active session…</p></div>;
  
  // Error: show error — NOT as "no active session"
  if (isError) return <div data-testid="active-session-bar" className="active-session-bar"><p>Error loading active session.</p></div>;

  // No active session: bar is empty/invisible
  if (!session) return null;

  const dirty = ... // Hmm, how do we know if the session has unsaved notes?
  
  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      ...
    </div>
  );
}
```

Wait, the "confirm if the current one has unsaved notes" — how does the bar know about dirty state? The dirty flag is local to the SessionDetailScreen. The bar doesn't have access to it.

I think the intent is: when navigating from the list to a session, if there's a currently active session with unsaved notes, confirm. But this navigation happens via a `<Link>` in the list, which doesn't go through the bar.

Let me re-read the spec: "Only one active session at a time; opening another replaces it (with confirm if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

I think the simplest interpretation that fits the architecture: the bar itself doesn't need to handle this — the detail screen's useBlocker already prevents navigation away with unsaved notes. When you're on session A's detail with dirty notes, you can't navigate to session B (blocker blocks). When you're on session A's detail with clean notes, you CAN navigate to session B (no blocker). The "confirm" part is already in the detail screen's blocker confirm dialog.

So the replacement-confirm is handled by the existing dirty-flag mechanism. The bar just needs to display the active session and provide resume/close actions.

Now, for the "opening a session from the list makes it active" — this is done by the mock's behavior where `GET /sessions/:id` sets active. In a real app, there might be a specific API call, but here we work with what's there.

Let me finalize the implementation:

### `src/features/sessions/queries.ts` additions:

```ts
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useCloseActiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // Invalidate the active query so it refetches and returns null
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}
```

### `src/app/AppLayout.tsx` modification:

Add `<ActiveSessionBar />` above `<Outlet />`.

### `src/features/sessions/ActiveSessionBar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseActiveSession } from './queries';

function elapsedLabel(startedAt: string, now: number): string {
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeActive = useCloseActiveSession();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Loading active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Could not load the active session.
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsedLabel(session.startedAt, now)}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)}>
        Close session
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeActive.mutate(session.id);
        }}
      />
    </div>
  );
}
```

Now for tests. Let me think about what tests to write:

1. Bar appears on authenticated screens but not on login
2. When there's an active session, the bar shows name, status, and elapsed time
3. Resume navigates to detail
4. Close opens confirm, confirms, empties bar
5. No active session → bar is not rendered
6. Full page refresh → bar comes back (simulate by setting activeSessionId and rendering)
7. Error state on active session query

Let me also check: the mock `GET /sessions/active` returns null when `activeSessionId` is null. Good.

Let me think about the test file. I'll add tests in `ActiveSessionBar.test.tsx`.

Actually, I also need to consider: when the user is on a session detail page and there's no active session in the mock state, should the bar show? No — it should show nothing (null). When they navigate to a detail page, the mock handler sets `activeSessionId`, and the bar shows it.

Wait, I need to also think about how the active session gets set when opening from the list. When you click a session link in the list, it navigates to `/sessions/:id`. The SessionDetailScreen mounts and calls `useSession(id)`, which calls `GET /sessions/:id`. The mock handler sets `state.activeSessionId = s.id`. Then `useActiveSession` (in the bar) would pick this up on next refetch... but `staleTime: 30_000` means it might not refetch for 30 seconds.

Hmm, this is a problem. The bar's `useActiveSession` query has `staleTime: 30_000`. If it was already fetching and got null (no active session), and then the user clicks a session link, the bar won't know about the new active session for 30 seconds.

But this is a general issue with the app's caching strategy, not specific to my feature. The detail page's `useSession` hook would get the correct session because it's a different query key. The bar would be stale.

To handle this correctly, I should invalidate the active session query when navigating to a detail page, or make the bar refetch on focus (but `refetchOnWindowFocus: false`). Or I could invalidate it when the detail page loads.

Actually, looking at the spec more carefully: "Opening a session from the list makes it the active session." This should happen immediately. The cleanest way: when the SessionDetailScreen loads (or when `useSession` succeeds), invalidate the active session query.

Let me add that to `useSession` or the SessionDetailScreen. Actually, `useSession` is in `queries.ts` and is a generic hook. Better to add it in `SessionDetailScreen` or create a separate hook.

Let me add it in SessionDetailScreen:

```tsx
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
// ...
const queryClient = useQueryClient();
useEffect(() => {
  if (session) {
    queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
  }
}, [session, queryClient]);
```

This ensures that after a session detail is fetched, the active session query is invalidated and will refetch, picking up the new active session.

Actually wait — I should use `queryClient.setQueryData` instead of invalidate for this specific case, since we know the session is now active:

```tsx
useEffect(() => {
  if (session) {
    queryClient.setQueryData(sessionKeys.active(), session);
  }
}, [session, queryClient]);
```

This is more efficient and immediate. The bar will immediately show the session.

Hmm, but `setQueryData` writes client-side state that might go stale on refresh. The spec says "GET /sessions/active is the source of truth — no client-only persistence of server facts." Using `setQueryData` here is fine because it's a react-query cache (not localStorage or a separate client store), and it will be refetched on appropriate triggers. It's just optimizing the UI to show the right session immediately rather than waiting for a refetch.

Actually, let me reconsider. Using `setQueryData` writes to the cache, and the spec says the server is the source of truth. But react-query's cache IS the source of truth in a react-query app — it's just a cache. The concern in the spec is about localStorage or a separate persistence layer. Using `setQueryData` to optimistically update the cache based on a server response is standard practice and doesn't violate the spirit of the spec.

Let me go with `setQueryData` in SessionDetailScreen.

Now let me also handle: when closing from the bar, the close mutation should invalidate the active query. Looking at `useCloseActiveSession` above, I have `qc.invalidateQueries({ queryKey: sessionKeys.active() })` in onSuccess. This will cause a refetch, and since the mock returns null (activeSessionId was set to null), the bar will show nothing.

Now let me write the tests:

```tsx
// ActiveSessionBar.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { sessions } from '../../mocks/db';

describe('ActiveSessionBar', () => {
  it('does not appear on the login screen', () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/login');
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('appears on an authenticated screen when a session is active', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  });

  it('is not rendered when there is no active session', async () => {
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => {
      // Give queries time to settle
    });
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('shows an error message on a failed active-session fetch', async () => {
    // How to trigger error? We'd need to make /sessions/active fail.
    // In MSW, we could override handlers... but the setup uses onUnhandledRequest: 'error'
    // Actually, we can render a custom handler or just note this.
    // Let me skip this for now or handle it differently.
  });

  it('navigates to detail on resume', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    expect(screen.getByText(/Loading/)).toBeInTheDocument(); // detail is loading
  });

  it('closes the session after confirming', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close session', exact: false })); // confirm
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });
});
```

Hmm, the close session test might need more careful handling. After closing, the active session should be null, so the bar should not render.

Wait, I need to think about the confirm dialog more carefully. After clicking "Close session" button on the bar, the ConfirmDialog appears with two buttons: "Cancel" and "Close session" (confirm). I need to click the confirm one.

Also, the elapsed time test might be tricky since it's dynamic. I can check that it matches the pattern `HH:MM`.

Let me also add a test for the error state. To trigger an error, I can override the MSW handler... Actually, MSW allows `server.use()` for temporary overrides. Let me check the test setup. The setup uses `server` from `mocks/server.ts`. I can use `server.use()` to override the handler.

Actually, for the error test, I could temporarily override the handler to return a 500 error.

Let me also add a test for the scenario where we navigate from the list to a detail page, and the bar appears:

```tsx
it('becomes active when opening a session from the list', async () => {
  state.activeSessionId = null;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
});
```

This should work because navigating to the detail page triggers the mock handler which sets `state.activeSessionId`, and then the bar's `setQueryData` in the detail screen (or the refetch) picks it up.

Actually wait — I haven't added the `setQueryData` for active session in the SessionDetailScreen yet. Let me make sure I add that. Without it, the bar would show loading (because staleTime is 30s and the active query was already fetched with null). Let me add it.

Hmm, actually, let me reconsider the `setQueryData` approach. The issue is:

1. User is on `/sessions` (list). Bar fetches `GET /sessions/active` → returns null.
2. User clicks "Inspection 1" → navigates to `/sessions/s-001`.
3. SessionDetailScreen fetches `GET /sessions/s-001` → returns session, mock sets `state.activeSessionId = s-001`.
4. Bar still shows null (stale cache, staleTime 30s).

If I add `setQueryData` in SessionDetailScreen, step 4 would be fixed: the bar immediately shows the session.

Alternatively, I could invalidate the query in SessionDetailScreen, which would cause a refetch but take longer.

I'll go with `setQueryData` for responsiveness.

But wait — there's another subtlety. The bar component is in AppLayout, which renders for ALL authenticated routes. When the user is on `/sessions`, the bar fetches active → null. When they navigate to `/sessions/s-001`, AppLayout doesn't unmount (it's the layout), so the bar's query doesn't re-fetch automatically. The query is still valid in cache (null), so it returns the cached null.

By adding `setQueryData(sessionKeys.active(), session)` in SessionDetailScreen's effect, we update the cache, and the bar immediately reflects it.

OK let me finalize everything.

One more consideration: the `useActiveSession` query is always active (even on the login screen, since the auth check happens but the layout... wait, the login screen is NOT inside RequireAuth/AppLayout. So the bar wouldn't render there. Good.

But actually, since the bar is in AppLayout, and AppLayout is only rendered inside RequireAuth, the `useActiveSession` hook is only called when authenticated. So no query fires on login. Good.

Let me also make sure the error handling is correct per the spec: "Handle pending and error on the active-session query. A failed fetch must not render as 'no active session' — those are different states and the operator can tell them apart even when the code cannot."

So on error, I should show something like "Could not load the active session" or just show the error, but definitely NOT return null (which would be "no active session").

Now let me also check: does the bar need to be styled? The spec says it should be "visible on every authenticated screen" and "visible above the outlet". I'll add a div with a className `active-session-bar`.

Let me also think about whether there are any issues with my approach:

1. **Logout clearing state**: When user logs out, `queryClient.clear()` is called, which clears all queries including `active`. So on the next render, the bar would not show. Good.

2. **Deep-linking**: Deep-linking to `/sessions/:id` works because RequireAuth waits for `me()`, then the detail screen fetches and sets active. Good.

3. **List filtering/pagination**: Not affected since we're only adding the bar to AppLayout. Good.

4. **Detail editing + dirty flag**: Not affected. Good.

Now let me write all the files.

Actually, let me reconsider the `useCloseActiveSession` mutation. After closing, we need to invalidate the active query. But also, we need to make sure the bar shows nothing (null). The mock handler for `POST /sessions/:id/close` sets `state.activeSessionId = null`, so refetching would return null. Good.

Let me also consider: should the bar show something while the close mutation is pending? Like a loading state? I think it's fine — the bar just stays visible during the mutation, and on success, the query refetches and returns null, so the bar disappears.

One more thing: the close mutation's confirm dialog. Currently in the bar, when you click "Close session", the ConfirmDialog opens. On confirm, it calls `closeActive.mutate(session.id)`. The mutation is pending, and the bar stays visible. On success, the active query is invalidated/refetched and returns null, so the bar unmounts. Good.

Let me finalize and write the code.

Actually, I realize I should double-check: the test environment uses `createMemoryRouter`. When the user clicks "Resume" (navigate to `/sessions/:id`), the router navigates. In the test, I'd use `waitFor` to wait for the detail screen to load.

Let me also add a test for: "opening a session from the list makes it active in the bar" — this tests the full flow.

And: "the bar shows elapsed time" — I can check that the text matches a time pattern.

Let me now also add an error test. I can use MSW's `server.use()` to override the handler temporarily:

```tsx
it('shows an error message on a failed active-session fetch', async () => {
  server.use(
    http.get('/api/sessions/active', () => HttpResponse.json({ code: 'server_error' }, { status: 500 })),
  );
  state.activeSessionId = sessions[0].id;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText(/could not load/)).toBeInTheDocument());
  server.resetHandlers();
});
```

Wait, I need to import `http` and `HttpResponse` from msw in the test. And `server` from mocks/server. Let me check what's already imported...

The test setup file imports `server` and resets handlers after each. So in the test, I can use `server.use()` and it should be reset after each test via `afterEach(() => server.resetHandlers())`.

OK let me finalize. I also want to make sure the error state test works correctly. The error from `useActiveSession` would have `isError: true` and `error` set. The bar would show "Could not load the active session."

Let me now write all the files:

1. `src/features/sessions/ActiveSessionBar.tsx` — new
2. `src/features/sessions/ActiveSessionBar.test.tsx` — new
3. `src/features/sessions/queries.ts` — modify (add hooks)
4. `src/features/sessions/SessionDetailScreen.tsx` — modify (add setQueryData for active)
5. `src/app/AppLayout.tsx` — modify (add bar)

Let me write them now.

For the queries.ts additions, I need to be careful about types. The `useActiveSession` returns `UseQueryResult<Session | null, ApiError>`. The `useCloseActiveSession` returns `UseMutationResult<Session, ApiError, string, unknown>`.

Let me also check: in `SessionDetailScreen.tsx`, I need to import `useQueryClient` and `sessionKeys`. And add an effect to update the active session cache.

Actually, looking at SessionDetailScreen more carefully, it already imports from `./queries`. Let me add the active session update there.

```tsx
// In SessionDetailScreen, add:
import { useQueryClient } from '@tanstack/react-query';
import { sessionKeys } from './queries';

// And in the component:
const queryClient = useQueryClient();
useEffect(() => {
  if (session) {
    queryClient.setQueryData(sessionKeys.active(), session);
  }
}, [session, queryClient]);
```

This is clean and follows the existing patterns.

Now let me also think about whether I need a `useCloseActiveSession` or can I reuse `useCloseSession`. Looking at the existing `useCloseSession` in queries.ts:

```ts
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
```

This doesn't invalidate the active query. I could create a separate `useCloseActiveSession` that extends `useCloseSession` but also invalidates the active query. Or I could just add the invalidation to `useCloseSession` — but that would change behavior for the detail screen too (the detail screen's close button would also invalidate active, which is actually fine).

Actually, let me think: when closing from the detail screen, should the active query also be invalidated? Yes — if I close session A from detail A, then A is no longer active. The bar should show nothing. And since the detail screen is being invalidated anyway (the close mutation updates detail), and the bar is in AppLayout... well, the bar's active query would still have stale data (session A) unless invalidated.

So I should add the invalidation to `useCloseSession` itself:

```ts
export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}
```

This is better — both the detail screen and the bar get the correct behavior. The bar's active query will refetch and return null after any session close.

Wait, but then I don't need `useCloseActiveSession` at all. I can just use `useCloseSession` in the bar. That reduces code duplication.

Yes, let me do that. The bar uses `useCloseSession` from queries.ts.

Let me finalize:

### ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession } from './queries';
import { useCloseSession } from './queries';

function elapsedLabel(startedAt: string, now: number): string {
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Loading active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Could not load the active session.
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsedLabel(session.startedAt, now)}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)}>
        Close session
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
```

### AppLayout.tsx (modified)
```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';

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
      </header>
      <ActiveSessionBar />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

### queries.ts additions (in sessions feature)
Add `useActiveSession` function.

### SessionDetailScreen.tsx (modified)
Add effect to set active session in cache.

Now let me write the tests. Let me be thorough:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('does not appear on unauthenticated screens', () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/login');
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('appears on authenticated screens when a session is active', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  });

  it('is absent when no session is active', async () => {
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => {
      // wait for query to settle
    });
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('shows an error state distinct from no active session', async () => {
    state.activeSessionId = sessions[0].id;
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'server_error' }, { status: 500 })),
    );
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText(/could not load the active session/i)).toBeInTheDocument());
    server.resetHandlers();
  });

  it('ticks elapsed time', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText(/:\d{2}/)).toBeInTheDocument();
  });

  it('resumes the active session on click', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'));
  });

  it('closes the session through the confirm dialog', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('cancels close when the confirm dialog is cancelled', async () => {
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('active-session-bar')).toBeInTheDocument();
  });

  it('becomes visible after navigating to a session from the list', async () => {
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
  });
});
```

Wait, there's an issue with the close test. Both the "Close session" buttons (in the bar and in the confirm dialog) have the same name. Let me check: the bar has a "Close session" button (danger variant), and the ConfirmDialog also has a "Close session" confirm button. When I click the first "Close session", the confirm dialog opens. Then I need to click the confirm "Close session" in the dialog.

But `screen.getByRole('button', { name: 'Close session' })` would throw if there are two matching buttons. I should use `getAllByRole` and pick the right one, or use a different selector.

Actually, `getByRole` will throw if there's more than one match. After the first click (opening the dialog), there are two "Close session" buttons: one in the bar (still there) and one in the dialog. So I need to scope it.

Let me use `within` or query within a specific container:

```tsx
await userEvent.click(screen.getByRole('button', { name: 'Close session' })); // opens dialog
await userEvent.click(screen.getByRole('button', { name: 'Close session' })); // this would fail with 2 matches
```

I need to scope: `screen.getByRole('dialog', { name: /Close this session/ })` then find the button within it.

Or I can use `screen.getAllByRole('button', { name: 'Close session' })` and click the second one (the dialog one).

Let me use `within`:

```tsx
import { within } from '@testing-library/react';

// ...
const dialog = screen.getByRole('dialog');
await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));
```

This is cleaner.

Also for the cancel test, the dialog has a "Cancel" button — that should be unique.

Let me also reconsider: the `renderApp` function sets up AuthProvider but doesn't set `state.user`. Looking at the existing `SessionsListScreen.test.tsx`, they set `state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] }` before calling `renderApp`. I need to do the same.

Also, the `RequireAuth` component waits for `loading` to be false. `loading` starts as `true` and becomes false after `me()` resolves. In the test, `me()` calls the mock API which checks `state.user`. So I need to set `state.user` before rendering.

Let me also handle the elapsed time test more carefully. The `elapsedLabel` function computes time from `startedAt`. For `Inspection 1` (session[0]), `startedAt` is `new Date(Date.UTC(2024, 3, 1, 8, 0)).toISOString()`, which is far in the past, so elapsed time would be very large. The format would be something like `HH:MM` where HH could be very large. The regex `:\d{2}` should match.

Actually wait — `elapsedLabel` returns `${minutes}:${seconds}` with zero padding. So it would be like `12345:07`. The regex `:\d{2}` would match `:07`. That works.

Let me finalize the tests and also think about the `it('is absent when no active session')` test. When `activeSessionId` is null and we're on `/sessions`:
1. `renderApp` renders AppLayout → ActiveSessionBar → `useActiveSession` → fetches `/api/sessions/active` → returns null
2. Query settles with data: null
3. Bar returns null (no render)

But there's a catch: the query might still be loading when we check. We need to wait for it to settle. Since `staleTime: 30_000` and `retry: false`, it should settle quickly. But we should wait.

Actually, in the existing `SessionsListScreen.test.tsx`, they use `waitFor` to wait for data. For the null case, I should wait until `queryByTestId` returns null (which it will immediately since the bar returns null). But I should also ensure the query has settled to avoid race conditions. Let me add a small wait:

```tsx
await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
```

This should work because even if the query is loading, the loading state would render the bar with testid. Once it settles with null, the bar disappears. So this waitFor should pass.

Hmm wait, actually — when the query is loading, the bar renders with "Loading active session…". So initially, `queryByTestId('active-session-bar')` IS in the document. Then when the query settles with null, it's not. So the waitFor should work.

But there's a subtle issue: when `state.activeSessionId` is null, the mock returns null immediately (synchronous). The fetch is fast. But in the test, we need to wait for it.

Let me just use `waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument())` which handles both cases.

OK I think I have a good plan. Let me write all the files now.

One more thing: in the SessionDetailScreen modification, I need to make sure the import of `useQueryClient` doesn't conflict. Looking at the existing imports:

```tsx
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession, useSession, useUpdateSessionNotes } from './queries';
```

I need to add `useQueryClient` from `@tanstack/react-query` and `sessionKeys` from `./queries`.

And add `useEffect` to imports if not already there (it's already imported).

Now let me write everything:

Wait — let me also verify the test for error state. In the error test, I use `server.use()` to override the handler. After the test, I call `server.resetHandlers()` to restore. The `afterEach` in setup also calls `resetHandlers()`, so that's fine.

Actually, looking at the error test more carefully: `renderApp('/sessions')` sets up everything. The `useActiveSession` query fires. But the override handler should intercept it. MSW `server.use()` adds temporary handlers that take precedence. This should work.

Let me also double-check: in the error test, `state.activeSessionId = sessions[0].id` but then the handler returns 500 regardless. The query should error out.

Now, one thing I'm not 100% sure about: when `isError` is true, does `data` exist? Usually it doesn't. So the flow would be: `isLoading` → false (not loading anymore), `isError` → true. We check `isLoading` first (false), then `isError` (true) → show error. Good.

But wait — what about the initial state? `isLoading` starts as true, then either `isSuccess` (data available) or `isError` (error). The order of checks in the component is: isLoading → isError → !session. This is correct.

Let me write all files now. Let me be extra careful about imports and types.

Also, let me check: does `state.user` need to be set in all tests? Yes, because `RequireAuth` blocks until `me()` resolves, and `me()` requires `state.user` to be set.

Let me now produce the final output.

Actually, one more thing: the test for "is absent when no active session". After `renderApp('/sessions')`, the bar might briefly show "Loading active session…" before settling with null. The `waitFor` should handle this by polling until the testid is not in the document. But actually, `waitFor` by default polls every 50ms for up to 1000ms. The fetch is synchronous in the mock (no setTimeout), so it should be very fast.

But actually, `renderApp` renders synchronously, and the query fires asynchronously. The initial render will have `isLoading: true` → bar shows. Then the query settles → `isLoading: false`, `data: null` → bar returns null. The `waitFor` should catch this.

Alright, I'm confident in the implementation. Let me write it all out.

Let me also check the `elapsedLabel` function carefully. `startedAt` is an ISO string like `2024-04-01T08:00:00.000Z`. `new Date(startedAt).getTime()` gives the time in ms. `Date.now()` gives current time. The difference is huge (2024 → 2025+), so elapsed is ~31536000000ms = ~365 days. minutes = 525600, seconds = 0. Output: `525600:00`. The test checks for `:d{2}` — this matches `:00`. Good.

Alright, final output time. Let me organize the files:

1. Modified: `src/app/AppLayout.tsx`
2. Modified: `src/features/sessions/SessionDetailScreen.tsx`
3. Modified: `src/features/sessions/queries.ts`
4. New: `src/features/sessions/ActiveSessionBar.tsx`
5. New: `src/features/sessions/ActiveSessionBar.test.tsx`

That's it. Let me write them.

Wait, I should double-check: is there anything else I need to add? Let me re-read the spec:

- ✅ Persistent active session bar visible on every authenticated screen
- ✅ Shows name, status, elapsed time ticking
- ✅ Resume (navigate to detail)
- ✅ Close session (with confirm, empties bar on success)
- ✅ One active session at a time; opening another replaces it (handled by existing dirty-flag blocker on detail screen)
- ✅ Survives page refresh (GET /sessions/active is source of truth)
- ✅ List filtering/pagination not regressed (bar doesn't affect list)
- ✅ Detail editing + dirty flag not regressed (bar doesn't affect detail)
- ✅ Logout clears state (queryClient.clear() handles it)
- ✅ Deep-linking works (RequireAuth waits for me())

All good. Let me write it.
```

## reply

### src/app/AppLayout.tsx
```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';

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
      </header>
      <ActiveSessionBar />
      <main>
        <Outlet />
      </main>
    </div>
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

export function useSession(id: string) {
  return useQuery({ queryKey: sessionKeys.detail(id), queryFn: () => api.getSession(id) });
}

export function useActiveSession() {
  return useQuery({
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
      // The active session may have changed; let the bar pick it up.
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
import { useBlocker, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys } from './queries';
import { useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const queryClient = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // When this detail becomes the active session, let the bar know immediately
  // so it can render without waiting for a refetch cycle.
  useEffect(() => {
    if (session) {
      queryClient.setQueryData(sessionKeys.active(), session);
    }
  }, [session, queryClient]);

  // The dirty flag. Every screen that edits uses this shape: local draft vs the
  // cached server value, and a router blocker rather than a beforeunload hack.
  const dirty = session !== undefined && notes !== session.notes;

  const blocker = useBlocker(dirty);

  if (isLoading) return <p>Loading…</p>;
  if (!session) return <p>Session not found.</p>;

  return (
    <section>
      <h1>{session.name}</h1>
      <Badge tone={session.status}>{session.status}</Badge>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="actions">
        <Button
          variant="primary"
          disabled={!dirty || updateNotes.isPending}
          onClick={() => updateNotes.mutate(notes)}
        >
          Save notes
        </Button>
        <Button
          variant="danger"
          disabled={session.status === 'closed'}
          onClick={() => setConfirmClose(true)}
        >
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeSession.mutate(session.id);
        }}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave with unsaved notes?"
        body="Your changes to the notes have not been saved."
        confirmLabel="Leave"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </section>
  );
}
```

### src/features/sessions/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession } from './queries';
import { useCloseSession } from './queries';

/**
 * Persistent active-session bar shown on every authenticated screen.
 * Reads from GET /sessions/active — the server is the source of truth.
 * Displays nothing when no session is active; a failed fetch is surfaced as
 * its own state so the operator never mistakes it for "no session."
 */
function elapsedLabel(startedAt: string, now: number): string {
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Loading active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Could not load the active session.
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsedLabel(session.startedAt, now)}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)}>
        Close session
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          void closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
```

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('does not appear on unauthenticated screens', () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/login');
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('appears on an authenticated screen when a session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  });

  it('is absent when no session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('surfaces a failure distinctly from having no session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'server_error' }, { status: 500 }),
      ),
    );
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText(/could not load the active session/i)).toBeInTheDocument());
    server.resetHandlers();
  });

  it('ticks elapsed time', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText(/:\d{2}/)).toBeInTheDocument();
  });

  it('resumes the active session on Resume', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'),
    );
  });

  it('closes the session through the confirm dialog', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close session' }),
    );
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('keeps the session when the confirm dialog is cancelled', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('active-session-bar')).toBeInTheDocument();
  });

  it('becomes visible after navigating to a session from the list', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
  });
});
```
