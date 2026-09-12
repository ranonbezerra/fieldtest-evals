# solution

## reasoning

```
We need to implement a persistent active session bar across all authenticated screens, as per spec. This includes:

- The bar should appear on every authenticated screen and nowhere else.
- It shows name, status, elapsed time ticking (i.e., show how long session has been open, presumably based on startedAt and maybe closedAt).
- It offers "Resume" that navigates to session detail: route '/sessions/:id'.
- It offers "Close session", with confirm, using existing close endpoint.
- When closing successfully, bar empties (i.e., no active session).
- Opening a session from list makes it active and bar shows it. Already the backend set activeSessionId when GET '/api/sessions/:id' fetches session detail (the handler sets activeSessionId = s.id if not closed). But we need to set active session on click in list. The list currently just displays a Link to session detail, but we need to add a handler: maybe clicking a session name triggers navigation to detail (which will automatically set active session via the GET request). So maybe we don't need extra logic; clicking the link navigates to detail, the GET will set active session. But we also need the bar to reflect that immediately across all screens, not only after navigating. However the GET request for session detail is executed as part of the SessionDetailScreen query. The bar may need to query /sessions/active to get current active session. So we can implement a new hook useActiveSession that uses query client to fetch GET /sessions/active. This query is used by the active session bar component to display session details.

- The active session bar must survive full page refresh: on reload, we need to query GET /sessions/active. That's covered by useActiveSession.

- Opening another session while current one has unsaved notes should present a confirm before replacing. The detail screen already tracks dirty flag. So the bar's "Resume" button would navigate to the new session's detail, but if there is unsaved notes in the current active session's detail screen, we need to trigger confirm. However the spec says: opening another session from the list replaces it (with confirm if the current one has unsaved notes). So when user clicks on a link to a session (list) while they have an active session with dirty notes open somewhere (maybe they navigated away from detail but still have unsaved notes in the detail screen? Actually the dirty flag is in SessionDetailScreen via router blocker; they are still on that screen when they attempt to open another session via the list. The list screen is separate; but they might click on another session there, not via the bar. The bar is visible on all screens. So they could be on a different screen (like orders) and click a session in the list. The spec says "opening another session while the first has unsaved notes → confirm before replacing". The detail screen's dirty flag is only active while the user is on detail page; but if they navigate away (to other screen) the router blocker would prompt if they navigate away, but they may have disabled it by confirming? Actually the blocker only triggers on navigation attempts when dirty is true. In SessionDetailScreen, they use useBlocker(dirty). That means any navigation attempt away from the detail screen is blocked. So if they have unsaved notes (dirty) and click on a link to another session from the list, they would be on the detail screen. The link to another session would trigger navigation, which would be blocked by the blocker; the confirm dialog appears from blocker. So they will see a confirm "Leave with unsaved notes?" from the blocker. So the spec about confirming before replacing may already be covered via that. However we also need to handle case when user opens a new session via the bar "Resume"? If they click "Resume" for a session, they are navigating to the same session? Actually the bar will have "Resume" that navigates to active session detail (so no switching). For switching to another session, the user will click a session in the list, and that will navigate to its detail, which will set active session via GET request. If they have dirty notes, navigation will be blocked and they will be asked to confirm leaving. So that's fine.

Potentially we need to implement active session bar UI: placed in AppLayout above the Outlet or below header? The spec says "visible on every authenticated screen". The AppLayout currently has header and main with Outlet. We can add the active session bar within AppLayout, maybe below the header. The bar should only appear when there is an active session, and should show session name, status, elapsed time ticking. Provide "Resume" button and "Close session" button with confirm dialog. Also need to handle pending and error states: active session query may be loading or error. A loading state may display a spinner or something; spec says "handle pending and error on the active-session query. A failed fetch must not render as "no active session" — those are different states and the operator can tell them apart even when the code cannot." So the component should display a distinct UI for loading (maybe "Loading active session…") and for error (maybe "Failed to load active session"). Could show error message? The error from query will be thrown? useQuery will give error property. The error will be ApiError thrown. So we can show something like <p>Could not load active session.</p>. For the case where there's no active session (i.e., GET returns null), we show nothing (i.e., bar not shown). Should not confuse error.

The bar's elapsed time: We need to compute time difference between now and session.startedAt and show a ticking display like "00:00:00". The spec mentions "elapsed time ticking". Implementation details may be simple: display time since startedAt in seconds, updating every second via setInterval. Use a component that uses useEffect with setInterval, and calculates difference using Date.now() - new Date(startedAt). Show formatted as HH:MM:SS (or maybe as minutes). Use a hook.

The bar should also hide when the active session is closed. On closing session via "Close session" button in bar, we need to confirm (reuse ConfirmDialog) and call closeSession mutation; on success, active session query may become null (server side). But we also need to invalidate the active session query or set it to null. We'll have a mutation useCloseActiveSession (maybe same as useCloseSession) that will call api.closeSession(id) and then invalidate active session query. In queries.ts we have useCloseSession for any session. But that expects a mutation with an ID param. In bar, we want to close the active session. So we can use that hook with the active session's ID, and onSuccess we might also need to clear active session. But the server already sets activeSessionId to null; however the client query for active session (GET /sessions/active) will still hold old data unless we refetch or invalidate. The useCloseSession mutation will automatically update detail query and lists but not active session query. So after closing, we can call queryClient.invalidateQueries(sessionKeys.active()) or set active session query to null.

Better design: create a new hook useActiveSession to fetch active session, plus a mutation hook useCloseActiveSession that calls api.closeSession(id) and onSuccess invalidates active session query (or set query data to null). Also maybe we need to patch lists? The close mutation already patches session details and lists via patchLists; after that, we need to also patch active session query.

But maybe we can reuse useCloseSession and add a side effect: after success, queryClient.invalidateQueries(sessionKeys.active()). Or set query data for active session to null. We'll implement within bar.

Also need to show a "Resume" button to navigate to detail. Use react-router navigate.

Implementation steps:

1. Add a new file src/features/sessions/ActiveSessionBar.tsx (or in some folder). This component will use the useActiveSession hook.

2. Implement useActiveSession in src/features/sessions/queries.ts. Add a function useActiveSession = () => useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession(), staleTime: Infinity? but we may set staleTime 0? The default is query client default (staleTime 30_000). However we want to refetch on mount; fine.

3. Add close session hook for active session: maybe just useCloseSession, but we can also call it.

4. ActiveSessionBar component UI:

- if activeSession query is loading: display <p>Loading active session…</p> maybe a placeholder bar with spinner.

- if error: display <p>Failed to load active session.</p> maybe show error message.

- if data is null: return null (no bar). Note: if no active session, no bar at all. Should still be part of layout.

- else data is Session; display a <div className="active-session-bar"> with info.

The bar should show:

- Session name (session.name)
- Badge showing status (maybe using Badge component)
- Elapsed time: we need a component that shows elapsed time. Could implement a simple hook useElapsed(startedAt: string) that returns a string formatted.

Implementation: useElapsed returns elapsed seconds; format to hh:mm:ss.

Implementation details: In the bar component, define a state for current time, useEffect with interval to update every second. Compute elapsed = Date.now() - new Date(session.startedAt). Show as formatted.

- Buttons: "Resume" (Button variant primary maybe) that navigates to `/sessions/${session.id}`; "Close session" (Button variant danger) that opens ConfirmDialog; ConfirmDialog open state in component.

- For closing, we need to call closeSession.mutate(session.id); after success, active session query becomes null. We'll need to set confirmClose open state.

- For error handling: closeSession mutation might have isPending, isError etc. Show spinner? The spec only requires confirm before closing; not required to show loading. Could disable close button when pending.

- Use ConfirmDialog component (provided) for confirming close.

5. Add the bar component to AppLayout, after header perhaps, before <Outlet/> or inside <main>. The layout: header then maybe bar then main content. The bar should only be shown on authenticated screens (the layout only renders after RequireAuth, which ensures authentication). So placing inside AppLayout will be fine.

Potential UI:

<div className="active-session-bar">
  <div>{session.name}</div>
  <Badge tone={session.status}>{session.status}</Badge>
  <div>{elapsed}</div>
  <Button variant="primary" onClick={...}>Resume</Button>
  <Button variant="danger" onClick={() => setConfirmClose(true)}>Close session</Button>
  <ConfirmDialog ... />
</div>

Add style classes maybe not needed.

6. Ensure tests for the new behavior. Add tests to src/features/sessions/ActiveSessionBar.test.tsx (or integrate into existing tests). The test environment includes renderApp which uses the router, etc. We'll need to simulate login, navigate to sessions list, click a session to make active, then check that the bar appears with proper name, status, and that elapsed time updates? Possibly just test that bar appears and displays correct name and status. Also test that clicking close calls API and clears bar. Use msw to check state changes.

Also test that loading/error states display correctly? Maybe not required.

Write tests for:

- Bar appears after opening a session (click on a session row in SessionsListScreen) and shows correct session name.

- Bar persists across navigation: after clicking "Resume" to session detail, then navigate to orders list, the bar still shows (since it's part of layout). So test that after navigating away, bar still present.

- Bar disappears after closing session: Click "Close session" button in bar, confirm dialog, after mutation resolves, bar disappears.

- Full page refresh scenario: simulate refresh by re-rendering the app at a path, but ensure active session is persisted via GET /sessions/active. However since MSW state persists across tests, we can simulate: set activeSessionId manually via handler? Actually when we open a session from list, GET '/sessions/:id' will set activeSessionId on the server. Then we re-render app (maybe call renderApp again with same path?) The active session query runs on mount and fetches GET /sessions/active which returns the current active session. So test that after render new component, the bar appears.

Better approach: Use renderApp('/sessions') to start, login via state.user, click first session, then wait for bar to appear, then re-render app using renderApp('/orders') after unmounting maybe; but state.activeSessionId remains set. The bar should appear on new page.

Potential issues: renderApp sets up router memory; when re-rendering, we need to ensure same query client? Actually each renderApp creates a new QueryClient. It may not share the same query cache across renders. But the server state is persistent (in memory across tests). So after re-render, active session query fetches from server again, which returns the active session. So bar appears.

Implementation of bar may use useActiveSession query which will be cached and not stale (maybe 30 seconds). That's okay.

Also we need to ensure we reset state.activeSessionId after logout.

The logout logic clears state.user and activeSessionId in handlers. Already done.

Potential issues: The active session query returns Session | null. On success, the query data is either Session or null.

Now implement the components.

But we must also add import of ActiveSessionBar into AppLayout.

Also we might need to export from a new module (maybe we don't need separate module). For consistency, we could just add a new file for the component and use it.

Potential naming: src/features/sessions/ActiveSessionBar.tsx.

We also need a hook for active session: src/features/sessions/active-queries.ts or in existing queries.ts file (the file currently exports sessionKeys, useSessions, useSession, useUpdateSessionNotes, useCloseSession, patchLists). We'll add useActiveSession, perhaps also useCloseActiveSession (or just useCloseSession with side-effect).

Add new function:

export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

Make sure to import Query.

Potential TypeScript type issues: useQuery returns { data: Session | null; isLoading; error; isError }. We'll need to type generic? It's okay.

Now implement ActiveSessionBar.

Potential imports:

import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';
import { useEffect, useState } from 'react';

Implementation details:

function useElapsed(startedAt: string): string {
  const [elapsed, setElapsed] = useState(() => computeElapsed(startedAt));
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(computeElapsed(startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return elapsed;
}
function computeElapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - start);
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / (1000 * 60)) % 60;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

Bar component:

export function ActiveSessionBar() {
  const { data: session, isLoading, isError, error } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  if (isLoading) return <p>Loading active session…</p>;
  if (isError) return <p>Failed to load active session.</p>;
  if (!session) return null;

  const elapsed = useElapsed(session.startedAt);
  const isClosing = closeSession.isPending;

  return (
    <div className="active-session-bar">
      <div className="active-session-info">
        <span>{session.name}</span>
        <Badge tone={session.status}>{session.status}</Badge>
        <span>{elapsed}</span>
      </div>
      <div className="active-session-actions">
        <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
          Resume
        </Button>
        <Button variant="danger" disabled={session.status === 'closed' || isClosing} onClick={() => setConfirmClose(true)}>
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
    </div>
  );
}

Need to handle after close session: The active session query should be refreshed. useCloseSession mutation onSuccess currently sets session detail and patches lists but not active. So we need to add an onSuccess that also invalidates active session query. Options: Create a new hook useCloseActiveSession that uses useCloseSession but with side-effect, but simpler: In bar component, after closeSession.mutate, we can use closeSession.isSuccess or useEffect to detect success and maybe call queryClient.invalidateQueries(sessionKeys.active()). But the query might automatically become null on refetch of active session (because server side activeSessionId set to null). However without refetch, the bar will still show the old session. To hide bar immediately after successful close, we need to either update the active session query data to null. So we can get the queryClient via useQueryClient and after closeSession mutation success, set query data.

Implementation approach: useCloseSession returns a mutation object; we can add onSuccess callback when calling mutate within component, but we need to pass options: closeSession.mutate(session.id, { onSuccess: () => qc.invalidateQueries(sessionKeys.active()) }); However closeSession is defined via useCloseSession which sets its own onSuccess. We cannot pass extra options to mutate? In React Query, mutate can accept variables and options overrides: mutate(variables, { onSuccess }) - yes you can override. We'll use that.

So in component:

import { useQueryClient } from '@tanstack/react-query';
...
const qc = useQueryClient();
...
onConfirm={() => {
  setConfirmClose(false);
  closeSession.mutate(session.id, {
    onSuccess: () => {
      qc.setQueryData(sessionKeys.active(), null);
      // or invalidate.
    },
  });
}}

Thus after close, active session query becomes null.

But we also need to make sure that after closing, the bar disappears. By setting query data to null, the component will re-render and show null, returning null, not rendering bar.

Potential concurrency: If closeSession mutation also updates active session query via server returning session object with status 'closed', but we want null. But server's close endpoint returns the closed session; but we set the active session query to null manually.

Alternatively we could just set queryClient.invalidateQueries(sessionKeys.active()) to refetch; the refetch would get null. That also works.

We'll implement using invalidate.

Implementation:

const qc = useQueryClient();

onConfirm={() => {
  setConfirmClose(false);
  closeSession.mutate(session.id, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}}

Now we need to import sessionKeys from queries.

Make sure to add to import: import { sessionKeys, useActiveSession, useCloseSession } from './queries';

Now modify AppLayout to include ActiveSessionBar. We'll add import: import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';

In AppLayout's return, after header maybe before main content: add <ActiveSessionBar />; but spec says visible on every authenticated screen, presumably in header or maybe below header. We'll place above <main>. Could wrap in <div>.

AppLayout currently:

<div className="shell">
  <header>...</header>
  <main>
    <Outlet />
  </main>
</div>

Add <ActiveSessionBar /> either between header and main or within main above Outlet. Let's add after header and before main: <ActiveSessionBar />.

So updated AppLayout:

<div className="shell">
  <header>...</header>
  <ActiveSessionBar />
  <main> <Outlet /> </main>
</div>

Now we need to ensure import path correct: AppLayout is in src/app/AppLayout.tsx; relative to that file, ActiveSessionBar is in src/features/sessions/ActiveSessionBar.tsx. So import path: import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';

Now tests.

Add test file src/features/sessions/ActiveSessionBar.test.tsx. In tests, we need to import renderApp and use the same mock server.

Test 1: Bar appears after opening a session.

Pseudo:

describe('ActiveSessionBar', () => {
  beforeEach(() => { state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] }; });

  it('shows after opening a session and persists across navigation', async () => {
    renderApp('/sessions');

    // Wait for session list to load
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Click the first session link (maybe using role 'link', name 'Inspection 1')
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    // Wait for session detail to load (session name heading)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Now the bar should appear. Since bar appears on any screen, after navigation, check for bar content: name, status badge, resume button
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument()); // This matches both heading and bar; ambiguous. Use getByText with query inside bar? Use getByLabelText? Not present. Could query for the Resume button. The presence of a 'Resume' button indicates bar exists.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    // Now navigate to orders list (via navigation link)
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByText('Orders')).toBeInTheDocument());

    // Bar should still be present
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('closes active session and bar disappears', async () => {
    // similar steps to open session, then close via bar
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Click 'Close session' button in bar
    const closeBtn = screen.getByRole('button', { name: 'Close session' });
    await userEvent.click(closeBtn);

    // Confirm dialog appears
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const confirmBtn = screen.getByRole('button', { name: 'Close session' }); // ambiguous, but confirm button is same label? ConfirmDialog uses confirmLabel default 'Confirm', but we passed confirmLabel="Close session". So there will be two buttons with same label? In ConfirmDialog, the confirm button variant 'danger' with label confirmLabel. In bar's ConfirmDialog, confirmLabel is "Close session". Cancel button is "Cancel". So there will be two "Close session" buttons? The confirm button and the original "Close session" bar button. When the dialog opens, the original bar button is still there; we need to differentiate by maybe using getByRole('button', { name: 'Close session' }) returns both. To avoid ambiguous, we can get within dialog: screen.getByRole('button', { name: 'Close session' }) after the dialog appears; still ambiguous. We can get by text inside dialog maybe? The confirm button is inside dialog and is the only "Close session" button that is a descendant of the dialog. Could use getByRole('dialog') then within query: within(dialog).getByRole('button', { name: 'Close session' }). We'll import within from @testing-library/react.

Implementation: import { within }.

Proceed:

const dialog = screen.getByRole('dialog');
const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
await userEvent.click(confirmBtn);

Now wait for bar to disappear:

await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument());

Additionally ensure that active session state is cleared: after bar disappears, if we reload app (renderApp('/sessions') again), bar should not show.

Could also test full page refresh: after closing, re-render. But maybe not needed.

Third test: Bar persists after page refresh.

Implementation: Open session, then re-render app at another route to simulate page refresh.

In test, after opening session (active session set), we could unmount component (by calling cleanup?) but we have a fresh renderApp call.

Simplify: In test, after opening session, we call renderApp('/orders') (new call) which will create a new query client, but the server still has activeSessionId. We then check that bar shows.

But we need to wait for active session query to finish loading.

Implementation:

renderApp('/orders');
await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

Now we need to ensure that the test environment's state user is set. In each test we set state.user accordingly.

Edge Cases: The test environment may need to login first. The login flow is done via login screen and then after login, it sets state.user. In previous tests (SessionsListScreen.test.tsx), they set state.user directly (state.user = ...) and then call renderApp('/sessions'), which bypasses login screen because RequireAuth checks me which reads state.user. Since state.user is set, me returns that user. So we can set state.user directly.

Now implement test file.

Potential imports needed: import { renderApp } from '../../test/render' (path relative). The test file is src/features/sessions/ActiveSessionBar.test.tsx; relative path to test utilities is '../../test/render'.

We also need to import screen, waitFor, within, etc.

Now adjust any imports that may cause circular dependencies.

ActiveSessionBar component uses useCloseSession from queries; this hook uses useMutation and patchLists, which also updates list caches.

Now ensure that active session query is not stale for 30 seconds. The default staleTime is 30 seconds, meaning after initial fetch, subsequent queries within 30 seconds will not re-fetch, but we might want to have the bar reflect the server state after closing. We're invalidating via queryClient.invalidateQueries({ queryKey: sessionKeys.active() }) after close, which should refetch. Invalidation will set isFetching maybe. Then the component's isLoading will be true for a moment. We'll see.

Potential TypeScript errors: In useCloseSession, the mutation has isPending property (v5 uses isPending). Actually in React Query v5, the property is isPending. The code in SessionDetailScreen uses closeSession.mutate(session.id) and the close button disabled = session.status === 'closed', no loading. So we will follow that.

In ActiveSessionBar we need to import type for mutation result maybe.

Now implement active session queries in queries.ts.

Add:

export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

Potential options: staleTime Infinity? Not needed.

Now need to export sessionKeys and other functions from queries, as they already exported.

Now adjust import paths accordingly.

Now we need to add test for active session bar loading error? Not needed.

Also need to ensure that confirm dialog for close session is imported correctly.

Potential concurrency issues: In bar, after closing session, we need to also clear active session query data or invalidate. Use invalidateQueries.

Now implement ActiveSessionBar component in src/features/sessions/ActiveSessionBar.tsx.

Implementation details:

- The component uses useActiveSession and useCloseSession.

- It uses useQueryClient.

- The component's internal state: confirmClose open.

- When active session data is loading: maybe return null (or spinner). But spec says handle pending and error: a failed fetch must not render as "no active session". So we should show some UI for loading and error separate from no active session (null). For loading we can show a placeholder like <p>Loading active session…</p> maybe inside bar container. For error we can show <p>Failed to load active session.</p>. We'll also show these messages maybe with class. That's okay.

Now add to AppLayout import.

Now need to consider the UI for bar with loading: Since the bar appears on all screens, showing a loading text might be odd but okay. Could also not show bar when loading; but spec says handle pending and error states: likely they want to display a loading indicator and error message.

Thus implement:

if (isLoading) return <p>Loading active session…</p>;

if (isError) return <p>Failed to load active session.</p>;

If no session: return null.

Now style class names not required.

Now we should think about concurrency for active session being closed elsewhere. If server side changes, the query might be stale and not refetch. The spec mentions it must survive a full page refresh but also reflect closed state after closing via bar. That's covered.

Now we need to ensure that the active session query is not disabled. It's active across all screens.

Potential issue: The active session query may be called many times (one per component). Since it's in layout, it's only one place. Good.

Now we need to ensure that the bar is not rendered on login screen. Since login screen is outside RequireAuth, AppLayout is only used after auth. So bar only appears when user is authenticated.

Now we also need to ensure that logging out clears all state, including bar. On logout, AuthProvider clears queryClient (clear()), which will remove all query caches, including active session query. The layout will still be rendered but active session query will be loading (since no user). Actually after logout, user is null, and RequireAuth will redirect to login. The AppLayout component may still be present while redirect? In RequireAuth, if user is null, they render <Navigate to="/login" replace state={...}/>; thus AppLayout may be unmounted. So bar disappears.

Now we need to ensure that the active session query is not attempted while not logged in; but query will call GET /sessions/active, which will return unauthorized 401. In that case, request throws ApiError (status 401, code 'unauthenticated'), and useQuery will set error. The bar will show error message. However since AppLayout is not rendered after logout, we don't need to worry.

Now test for full page refresh (simulate). Write test:

it('persists across page refresh', async () => {
  // login user
  state.user = ...;
  // open a session
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  // Wait for bar's resume button to appear
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
  // simulate refresh by re-rendering at a new path
  renderApp('/orders'); // this unmounts previous render and mounts new app
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
});

But we need to ensure we clear previous render before re-render; renderApp returns the rendered component but not used; we can simply call renderApp again; the previous DOM still present. However we might have both renders present, interfering. Instead we could call cleanup (import from '@testing-library/react') after first render, then call renderApp again.

Test approach: use renderApp('/sessions'), perform actions, then call cleanup() and renderApp('/orders') again. But renderApp uses testing library's render which returns utilities; but cleanup is automatically called after each test? But not within test. We can import from '@testing-library/react' the cleanup function. However we need to ensure that we don't have duplicate containers.

Simplify: Instead of re-rendering a new app, we can simulate navigation to a different page via router (click on Orders link). The bar should persist across navigation, which also covers refresh scenario (except the query would still have cached data). However spec wants to test full page refresh (i.e., new page load). But we can approximate by unmounting and remounting.

Alternatively we can use renderApp('/orders') initially after open session, but that would not preserve active session across navigation; but we can test the bar persists across navigation as part of test for "persist across navigation". The full page refresh may be implicitly covered if we test that after calling renderApp again, the bar appears using active session query.

Potential issues: The state.activeSessionId is set by GET /sessions/:id (when we opened session via detail screen). In our test, we click on session link which navigates to detail screen, triggering GET /sessions/:id which will set activeSessionId. So that is done.

Now after we close the app and re-render, the active session query will fetch /sessions/active which will return the session (still active). So we can test that.

Now we need to import cleanup.

Now implement test file accordingly.

Potential issues: The test may have timing issues due to interval tick of elapsed time; but we only check for presence of Resume button. That's okay.

Now check other aspects: The active session bar's UI may have multiple elements with same text: session name appears both in heading and bar. In test we rely on Resume button to detect bar. For checking that bar shows after opening a session, we need to wait for Resume button to appear. We'll ensure that.

Now we need to modify other existing files that may conflict: SessionDetailScreen also sets active session on GET of session detail (handler does this). So the bar will show after GET call, but we also have to ensure that the bar component's useActiveSession may be triggered concurrently and might have stale data initially (null). For the first load after opening session, the active session query may still be null until the server sets activeSessionId? Let's think: When we navigate to session detail, the screen's useSession query fetches GET /sessions/:id. That request also sets state.activeSessionId on server side before responding. The active session query GET /sessions/active may be already in flight concurrently (or may have previously fetched null). In that case, after the GET /sessions/:id resolves, active session query may still have stale data (null) until refetched.

We need to ensure the bar updates when the active session becomes active after navigating to detail.

The active session query's staleTime default is 30s; after initial fetch of null (maybe from earlier load before opening any session), the query will have data null and considered fresh for 30s, so it won't refetch automatically when we later set active session via GET /sessions/:id. So the bar will not update to show active session. That's a problem.

Solution: Use useActiveSession query with enabled: true always but we need to set it to refetch on window focus or on mount? But staleTime prevents auto refetch after initial load. We need to set staleTime to 0 (immediate stale) or use refetchOnMount: true. The default query client config sets staleTime to 30_000 and refetchOnWindowFocus false. We can override query options per query: set staleTime: 0. Or set refetchOnMount: true.

Thus in useActiveSession we should set staleTime: 0 (so data considered stale after fetch and will refetch when component remounts). However we need it to refetch when we navigate to another screen? It will not refetch unless we manually trigger. We could set refetchInterval? Not needed.

Better approach: Since we want the bar to reflect the active session as soon as possible when it changes, we can set query key to sessionKeys.active(), and we can use react-query's query invalidation when the active session changes, for example in useSession's onSuccess patch we can also set active session query data. But we could simply set active session query's staleTime to 0 so that it will always refetch on mount. The bar component is mounted once; after active session changes, it won't automatically refetch. But we could set up a subscription to updates via using useQuery with refetchOnWindowFocus: false but maybe use useEffect to watch for changes to something else. However maybe the active session is set by GET /sessions/:id; we can use queryClient.invalidateQueries(sessionKeys.active()) in useSession's onSuccess hook. The useSession query defined in queries.ts currently only fetches session details; no onSuccess. We can modify useSession to have an onSuccess that invalidates active session query. However that would cause the active session query to refetch after fetching session detail. That might be okay.

But the spec does not mention needing to do that. However they expect that after opening a session from the list, the bar appears on all screens. The list screen does not have a call to GET /sessions/:id; it just renders a list. The user opens a session from the list by clicking a Link to the detail screen; at that moment the detail screen is loaded, which sets active session id. But the bar should appear even while the user is on the list screen? The spec says "Opening a session from the list makes it the active session; the bar shows its key fields on ALL screens." So maybe they want the bar to appear as soon as they open a session (i.e., after clicking the list entry and navigating to detail screen). If they are still on the list page before navigation, bar wouldn't show. But after navigation to detail screen, bar shows. That's fine.

Now after they navigate away (e.g., back to list or orders), the bar should still be visible with that session active. For that, the active session query must have been updated after navigation to detail screen, and not considered stale such that it won't refetch. If we set staleTime: 0, after initial fetch (null) will be considered stale, but the query is not refetched automatically unless we use some trigger (like refetchOnMount). The bar is already mounted; after fetching session detail, the active session query will still have data null unless we manually invalidate. Since we set staleTime to 0, does useQuery automatically refetch when data becomes stale after some time? No; staleTime indicates that after the data becomes stale, it can be refetched on certain triggers: refetchOnMount (default true), refetchOnWindowFocus (default true), refetchInterval etc. Since refetchOnMount defaults to true (I think in v5), but the query is already mounted, not unmounted. The next mount does not happen. So it won't automatically refetch.

Thus we need to trigger invalidation of active session query after opening a session. Could be done in the GET /sessions/:id request: The server sets activeSessionId, but client doesn't know. We can modify useSession to have onSuccess that sets active session query's data to that session (if not closed). That would ensure immediate update.

Spec says that the GET /sessions/:id endpoint sets active session on server; we need to reflect that on client via active session query. It might be okay to rely on the GET /sessions/:id response to know active session; but the bar uses its own query to fetch active session. We could also avoid active session query entirely, and just compute active session based on current session id from route? But spec requires using GET /sessions/active.

Thus we need to ensure that after navigating to session detail (GET /sessions/:id), the active session query updates.

Option A: use useSession to set active session query data on success, using queryClient.setQueryData(sessionKeys.active(), session) (if not closed). That's simplest.

So modify useSession function in queries.ts to add onSuccess hook.

Current definition:

export function useSession(id: string) {
  return useQuery({ queryKey: sessionKeys.detail(id), queryFn: () => api.getSession(id) });
}

We can change to:

export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (data) => {
      // If session is not closed, set as active session
      if (data.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), data);
      } else {
        // If closed, maybe set active null if matches
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}

We need to import useQueryClient.

Now ensure import in queries.ts: import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'; Already imported.

Now this will update active session query data to the session.

But we must ensure that the active session query may have stale data (maybe null), but setQueryData will override.

Potential edge: On subsequent navigation to other screens, the active session query will hold the data (Session). When the active session is closed (via close mutation), we will set it to null via invalidation.

Now need to adjust import for useQueryClient in queries.ts; already imported.

Thus active session query is updated.

Now we must consider that the active session query may have been loaded before (null) with stale data; on useSession onSuccess we set it; good.

Now the bar will display after navigating to session detail. However when we navigate away to other screen, the bar stays because sessionKeys.active query data remains the session. The query will be considered fresh for 30 seconds, but we don't need to refetch until maybe after close. Good.

Now after closing the session via bar, we must set active session query to null. Our earlier plan to invalidate will cause refetch, which will return null. That works.

Thus test for bar appearing after clicking a session link (which triggers navigation) should see bar after navigation to detail. The test may also check the bar after navigating back to list, but after navigation to list we may have to click the link again. We'll test after navigation to orders page that bar remains.

Now we need to adjust imports accordingly.

Potential concurrency: useCloseSession also patches lists, but we must also update active session query. In bar we already do invalidate. In close via detail screen (SessionDetailScreen) also close session. That screen also uses useCloseSession, but no invalidation of active session. When user closes session from detail, the bar may not update (if bar still present). But we need to ensure that bar also disappears after closing from detail. The spec says "Closing session calls the existing close endpoint ... and empties the bar on success." If you close from detail screen, bar should clear as well. Right now, closing from detail screen will not update active session query, so bar will still show stale session until page refresh. This is a bug. We need to ensure that active session query gets cleared when any session close occurs (either from bar or from detail screen). Options: modify useCloseSession's onSuccess to also invalidate active session query.

Since useCloseSession is used both in bar and detail screen, updating it globally is appropriate.

So modify useCloseSession in queries.ts:

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // Update active session query: if closed, set null; otherwise maybe set updated.
      if (updated.status === 'closed') {
        // Invalidate active session to refetch null
        qc.invalidateQueries({ queryKey: sessionKeys.active() });
      } else {
        // If for some reason not closed (maybe reopened?), set it
        qc.setQueryData(sessionKeys.active(), updated);
      }
    },
  });
}

But to keep consistency, we may just invalidate always: qc.invalidateQueries({ queryKey: sessionKeys.active() }). That will refetch GET /sessions/active which returns null after close. That works.

Thus modify useCloseSession onSuccess accordingly.

Also adjust useUpdateSessionNotes: if updating notes, may not affect active. No need.

Now modify useSession onSuccess to update active.

Now tests: when closing via bar, the bar disappears due to invalidation (refetch). When closing via detail screen, we might not test, but it's important to pass overall suite.

Potential infinite loops? If closeSession triggers invalidation, active session query refetches GET /sessions/active, which returns null; the query's onSuccess (if any) not defined; but it updates nothing. Good.

Now adjust code.

Potential other code: When session is closed by other actions (maybe via another operator), the active session query may still hold old session; but we don't worry.

Now implement changes.

Now update imports accordingly.

Now adjust any TypeScript errors: The useActiveSession function uses useQuery; need to import { useQuery }.

Now need to modify AppLayout to import and render bar.

Now write tests.

Test file path: src/features/sessions/ActiveSessionBar.test.tsx.

Implementation details for tests:

import { renderApp } from '../../test/render';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { state } from '../../mocks/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react'; // optional

Now test steps.

But note that renderApp takes a path; we need to pass initial path as '/sessions' to start at sessions list.

Test 1: bar appears after opening a session and persists across navigation.

Implementation details:

await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

Now click the link. The link is in SessionsListScreen, the name is inside a <Link> with text session.name. So we can find it by role 'link' with name 'Inspection 1'.

await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

Now wait for detail screen heading. The heading is <h1>{session.name}</h1>. So use getByRole('heading', { level: 1, name: 'Inspection 1' }) or getByRole('heading', { name: 'Inspection 1' }).

await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

Now check bar: Wait for 'Resume' button.

await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

Now navigate to orders: the header nav link for orders has Link to '/orders' with visible text 'Orders'.

await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
await waitFor(() => expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument());

Now check bar still present.

expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

Now test close: similar steps, after bar appears, click 'Close session' button.

Find close button: screen.getByRole('button', { name: 'Close session' }). That may conflict with other 'Close session' button in detail screen (there is also a 'Close session' button in the detail screen). In our scenario after we navigate to detail screen, there are two 'Close session' buttons: one in detail screen (danger button) and one in the bar (danger button). They have same label. This might cause ambiguous query.

We can differentiate by using within the header or maybe using test IDs. Alternatively, we can find the bar's close button by searching for the button within the bar container. We could get the bar container via its class "active-session-bar" but that is not a role. However we can query for the element containing the 'Resume' button and then find the sibling close button.

Implementation:

const bar = screen.getByRole('button', { name: 'Resume' }).closest('.active-session-bar');

But we cannot rely on CSS classes being accessible. We could query for the bar's region by something else: maybe the bar includes both Resume and Close session button; we can use within:

const barSection = screen.getByText('Resume').closest('div'); But we can't guarantee.

Simplify: For close action test, we can navigate to detail screen and close there using the close button in the detail screen, which will also clear active session. However we need to test that bar empties after that close. That may be simpler because we can target the detail screen's button which is unique; after closing, bar should disappear. But the detail screen's button also uses ConfirmDialog, but we can confirm that.

Let's do that: open session, click 'Close session' button in detail screen (not bar). Confirm dialog appears, confirm. Then bar should disappear.

Thus we avoid ambiguous button selection.

Implementation steps:

- After opening session (detail screen), find the 'Close session' button in detail screen. It is also labeled 'Close session'. We can find it as the second button after 'Save notes'? Actually there are two buttons: Save notes (primary) and Close session (danger). Both have labels 'Save notes' and 'Close session'.

We can use getByRole('button', { name: 'Close session' }) to get the close button. However this will also match the bar's close button if bar is present at that moment (since after navigation to detail, bar also appears). So there will be two buttons with same name.

We need to differentiate: Use getByRole('button', { name: 'Close session' }) will return the first matching element in DOM order, which may be the bar's button (since bar is before main? Actually layout: header, bar, main with outlet. The detail screen content appears inside main (outlet). So bar is above detail screen. So the first 'Close session' button is likely the bar's. That's ambiguous.

To avoid that, we can locate the button inside the ConfirmDialog? Actually the close button inside detail screen triggers a confirm dialog same as bar. But we want to click that button, not bar's.

To uniquely identify the detail screen's close button, we could use a test attribute. Since we cannot modify component markup, we need to rely on relative location.

We could get the button inside the detail screen by searching inside the heading. For instance, get the element containing the heading 'Inspection 1', then find the following button.

Simplify: Instead test bar's close functionality directly via bar's close button, and we need to differentiate between bar's confirm and other.

We can target the bar's close button by first getting the bar's Resume button (unique) and then using its parent container to find the close button.

Implementation:

const resumeBtn = screen.getByRole('button', { name: 'Resume' });
const bar = resumeBtn.closest('.active-session-bar') as HTMLElement;
if (!bar) throw new Error('Bar not found');
const closeBtn = within(bar).getByRole('button', { name: 'Close session' });

Now click closeBtn.

Now confirm dialog appears. Use screen.getByRole('dialog').

Confirm button inside dialog: within(dialog).getByRole('button', { name: 'Close session' }) (confirm label).

Click confirm.

Then wait for bar to disappear: expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument().

Potential issue: after clicking confirm, the mutation may have pending state and query invalidation; we need to wait for the bar to disappear. Use waitFor.

Test passes.

Now we need to import screen, waitFor, within, userEvent.

Now we need to ensure that the confirm dialog's confirm button uses label "Close session" as confirmLabel. In our component, we passed confirmLabel="Close session" to ConfirmDialog. Good.

Now we need to implement confirm dialog open state management.

Now add tests.

Potential concurrency: The confirm dialog from bar might share same label as bar's close button causing ambiguous queries. Our within(bar) ensures we target the bar button.

Now we also need to test that the bar persists after page refresh (i.e., after unmount and remount). Implement test:

it('persists after page refresh', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  // Open session
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

  // Simulate page refresh by cleanup and renderApp again at a different path
  cleanup();
  renderApp('/orders');
  // Wait for active session bar to load
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
});

We need to import cleanup.

Now we need to ensure that state.activeSessionId persists across test runs; we are resetting state in beforeEach or each test; but state.activeSessionId will be set via GET /sessions/:id. For each test we may need to reset state.activeSessionId to null at the start to avoid cross-test contamination. Usually tests are isolated because server reset handlers after each test; but state is not reset automatically except state.activeSessionId may remain set; after each test, we should set state.activeSessionId = null manually in beforeEach or afterEach. The test's state is manipulated in each test: we set state.user. The server's state persists across tests unless we reset. In other tests they only set state.user, not resetting activeSessionId; but previous test might have left activeSessionId set. This could affect tests; but the repository's existing tests only test sessions list, which may not rely on active session. Might be okay. However to be safe, we can set state.activeSessionId = null at start of each test.

Add in beforeEach: state.activeSessionId = null;

Now need to import state from '../../mocks/db'.

Now ensure tests compile.

Now implement modifications to code.

Now let's produce the final diff.

We need to produce full files: those we modified and new ones.

- src/app/AppLayout.tsx (modified)
- src/features/sessions/queries.ts (modified)
- src/features/sessions/ActiveSessionBar.tsx (new)
- src/features/sessions/ActiveSessionBar.test.tsx (new)

Potentially need to adjust imports in any other files if required.

Now implement modifications.

Potential additional import: useQueryClient added to queries.ts import statement; already there.

Now we need to adjust src/features/sessions/queries.ts's useSession to include onSuccess to update active session.

Implementation details: useQuery's options may require generic type parameters: useQuery<Session, ApiError, Session> but we can just pass an object.

Will import useQueryClient.

Now adjust useCloseSession's onSuccess to also invalidate active session query.

Implementation:

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // Invalidate active session query to refetch; after close it will be null.
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}

Now add useActiveSession function.

export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}

Now update imports: we already have api, SessionQuery imported.

Now need to update the file import lines if necessary.

Now modify AppLayout to import and render ActiveSessionBar.

Now create ActiveSessionBar.tsx component file.

Implementation details:

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession, sessionKeys } from './queries';
import { useQueryClient } from '@tanstack/react-query';
```

Note: relative path of queries.ts from this component is './queries', as same folder. That's okay.

Now component.

Edge Cases: The bar may display "Loading active session…" while loading, but we may want to style as a bar.

Implementation code:

function formatElapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - start);
  const secs = Math.floor(diff / 1000) % 60;
  const mins = Math.floor(diff / (1000 * 60)) % 60;
  const hrs = Math.floor(diff / (1000 * 60 * 60));
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function useElapsed(startedAt: string): string {
  const [elapsed, setElapsed] = useState(() => formatElapsed(startedAt));
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsed(startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return elapsed;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  if (isLoading) return <p>Loading active session…</p>;
  if (isError) return <p>Failed to load active session.</p>;
  if (!session) return null;

  const elapsed = useElapsed(session.startedAt);
  const isClosing = closeSession.isPending;

  const handleClose = () => {
    setConfirmClose(false);
    closeSession.mutate(session.id, {
      onSuccess: () => {
        // Invalidate active session query to refetch null
        queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
      },
    });
  };

  return (
    <div className="active-session-bar">
      <div className="active-session-info">
        <span>{session.name}</span>
        <Badge tone={session.status}>{session.status}</Badge>
        <span>{elapsed}</span>
      </div>
      <div className="active-session-actions">
        <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
          Resume
        </Button>
        <Button variant="danger" disabled={isClosing} onClick={() => setConfirmClose(true)}>
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={handleClose}
      />
    </div>
  );
}
```

Potential TypeScript issues: useCloseSession returns a mutation result; property isPending? In React Query v5, the mutation object has status: 'idle' | 'pending' | ... and boolean flags isPending, isSuccess, isError. We'll use closeSession.isPending.

Now import needed items.

Now modify AppLayout:

```tsx
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
...
<ActiveSessionBar />
```

Now adjust import order.

Now modify src/features/sessions/queries.ts accordingly.

Now create test file src/features/sessions/ActiveSessionBar.test.tsx.

Implementation:

```tsx
import { screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Reset mock state
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
  });

  it('appears after opening a session and persists across navigation', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Open first session
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Bar should appear
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Navigate to orders
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument());

    // Bar should still be present
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('closes active session and bar disappears', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Wait for bar's resume button
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Find the close button within the bar
    const resumeBtn = screen.getByRole('button', { name: 'Resume' });
    const bar = resumeBtn.closest('.active-session-bar');
    if (!bar) throw new Error('Active session bar not found');
    const closeBtn = within(bar).getByRole('button', { name: 'Close session' });

    await userEvent.click(closeBtn);

    // Confirm dialog appears
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
    await userEvent.click(confirmBtn);

    // Bar should disappear
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument());
  });

  it('persists after page refresh', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Simulate page refresh by unmounting and remounting
    cleanup();

    renderApp('/orders');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
  });
});
```

We need to import cleanup from '@testing-library/react'.

Potential errors: The bar's root element has className "active-session-bar". The test uses resumeBtn.closest('.active-session-bar') which uses DOM API .closest, which works in jsdom. That's fine.

Potential issue: resumeBtn may be inside the button element itself; .closest will find the nearest ancestor with that class.

Potential issue: The test may fail because there are multiple elements with the same name 'Close session' (the bar close button and confirm dialog's confirm button) after we click close, we need to locate bar's button before dialog appears. That is done.

Now after clicking confirm button, the confirm dialog disappears; then we check that bar's resume button is gone.

Potential race conditions: after confirm, the mutation may cause active session query to be invalidated and refetch, leading to loading state and eventually null. The bar may temporarily show loading text "Loading active session…" before disappearing. Our waitFor will assert that the resume button is not present, which will pass when it's removed.

Potential need for extra waiting: waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument());

Now test passes.

Now we need to ensure the test environment has userEvent imported; userEvent is from '@testing-library/user-event'.

Now final modifications.

Now think about any other files that may import useSession or useCloseSession. Changing useSession to include useQueryClient import may need to import that.

Already imported useQueryClient in file earlier; we need to ensure the import list includes it.

Now check for any lint errors: In queries.ts, the function useSession now uses useQueryClient but it's already imported at top: import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'; So fine.

Now in useActiveSession we need to import useQuery (already imported).

Now check that we added export of useActiveSession.

Now check if any file uses sessionKeys.active directly; not before. The ActiveSessionBar component uses sessionKeys.active().

Now check imports for Badge, Button, ConfirmDialog etc.

Now check that we imported useNavigate from 'react-router-dom'.

Now test file uses screen, waitFor, within, cleanup. All imported.

Now adjust any TS errors.

Now confirm that the code meets spec: active session bar appears on authenticated screens (AppLayout). The bar shows name, status badge, elapsed time ticking (via useElapsed). It offers Resume and Close session (with confirm). Closing empties the bar (active session query invalidated). Opening another session from list will replace active session; due to useSession onSuccess updating active session query. When there are unsaved notes (dirty flag), navigation away from detail screen is blocked via blocker; bar's resume action may navigate away from detail screen; blocker will intercept navigation attempt if dirty and show confirm; this is already handled by the router blocker because bar's Resume button triggers navigation. So that will trigger the ConfirmDialog from blocker. So the spec about confirm before replacing is satisfied.

Active session persists across refresh: state activeSessionId is persisted in mock server, active session query fetches it on mount.

Pending and error states: In ActiveSessionBar we display messages for loading and error.

Now ensure that error handling for GET /sessions/active: In case of 401 unauthorized (user not logged in), isError will be true, and we show "Failed to load active session." But this component is only rendered after authentication.

Now check that after logout, query client is cleared, and AppLayout unmounted. Not needed.

Now check that no regression in list filters/pagination: unchanged.

Now check that deep linking works: Already works.

Now check that test environment's server resets handlers after each test; state may not be reset (activeSessionId may remain). Our beforeEach resets it.

Now consider that login is bypassed by setting state.user directly. But the auth context's useEffect will call api.me() to fetch user. This will use GET /auth/me which returns state.user. Since we set state.user before renderApp, the query will succeed.

Now consider that after we open session via GET /sessions/:id, state.activeSessionId is set by the handler. However, when we call useSession query, we need to ensure that onSuccess runs after the request resolves and after the server sets activeSessionId. This is correct.

Now we need to ensure that the query client does not already have a stale active session query with null before opening session, and that useSession's onSuccess will set query data to session. The useQuery in active session bar may have already fetched null and is considered fresh for 30 seconds. However after setting query data manually via setQueryData, the query's data will be updated. That's fine.

Now consider scenario: When the app loads at initial route '/sessions', the active session query may be loaded (null) initially. Then the user opens a session. The useSession onSuccess updates the active session query to the session. So the bar will appear after navigation to detail screen (or perhaps before if the bar is rendered on the list screen after navigation? But after navigation, the bar should display. Good.

Now verify that the active session query data is set with setQueryData to the session, which is correct.

Now check potential TypeScript errors: useActiveSession returns a query of type Session | null, but we need to type generic: useQuery<Session | null>. But type inference may infer any. It's okay.

Now ensure that the active session bar's useActiveSession may have isError property with type unknown; we need to import from react-query types; but we can just use any.

Now ensure that the import path for sessionKeys is correct: In ActiveSessionBar.tsx we import { sessionKeys, useActiveSession, useCloseSession } from './queries'; Since queries.ts is in same folder, that's correct.

Now check for import cycles: queries.ts imports useCloseSession (which is in same file), no issues.

Now ensure that the bar's component does not cause infinite loops due to setInterval updating state; the interval runs every second and updates elapsed string. That's fine.

Now check that the bar's component returns a <div> with className; fine.

Now update AppLayout import.

Now run tests.

Potential missing import of useNavigate in ActiveSessionBar, but we imported.

Potential missing import of React types for JSX; not needed.

Potential missing import of 'Badge' from '../../components/ui/Badge' which is correct.

Now adjust any relative import path differences: ActiveSessionBar is in src/features/sessions. The components folder is src/components/ui. So relative path is '../../components/ui/Badge'.

Now adjust that accordingly.

Now commit changes.

Now ensure that any TypeScript strictness warnings resolved.

Spec about using no client-only persistence of server facts: We aren't using localStorage; we rely on server.

Now we might need to update any lint rule about default exports; not required.

Now final answer: Provide files:

- src/app/AppLayout.tsx (modified)
- src/features/sessions/queries.ts (modified)
- src/features/sessions/ActiveSessionBar.tsx (new)
- src/features/sessions/ActiveSessionBar.test.tsx (new)

We might need to adjust import path of ActiveSessionBar from AppLayout: It is in '../features/sessions/ActiveSessionBar'.

Now confirm file names: All paths relative to repo root.

Now produce final answer with all four files.
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
      {/* Persistent active session bar, visible on every authenticated screen */}
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

/**
 * Fetch a single session.
 * On success we also update the active‑session cache, because the server marks
 * the session as active when it is fetched (unless it is closed).
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (data) => {
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

### src/features/sessions/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession, sessionKeys } from './queries';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Formats a millisecond difference as HH:MM:SS.
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}`;
}

/**
 * Returns a ticking string representing the elapsed time since `startedAt`.
 */
function useElapsed(startedAt: string): string {
  const [elapsed, setElapsed] = useState(() => formatElapsed(Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsed(Date.now() - new Date(startedAt).getTime()));
    }, 1_000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return elapsed;
}

/**
 * Persistent bar that shows the active session (if any) on every authenticated screen.
 * Handles loading / error states distinctly from “no active session”.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  if (isLoading) return <p>Loading active session…</p>;
  if (isError) return <p>Failed to load active session.</p>;
  if (!session) return null;

  const elapsed = useElapsed(session.startedAt);
  const isClosing = closeSession.isPending;

  const handleClose = () => {
    setConfirmClose(false);
    closeSession.mutate(session.id, {
      onSuccess: () => {
        // Refetch active‑session; the server will now return null.
        qc.invalidateQueries({ queryKey: sessionKeys.active() });
      },
    });
  };

  return (
    <div className="active-session-bar">
      <div className="active-session-info">
        <span>{session.name}</span>
        <Badge tone={session.status}>{session.status}</Badge>
        <span>{elapsed}</span>
      </div>
      <div className="active-session-actions">
        <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
          Resume
        </Button>
        <Button variant="danger" disabled={isClosing} onClick={() => setConfirmClose(true)}>
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={handleClose}
      />
    </div>
  );
}
```

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
    const bar = resumeBtn.closest('.active-session-bar');
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
