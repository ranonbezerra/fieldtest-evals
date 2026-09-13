# solution

## reasoning

```
We need to implement persistent active-session bar in the backoffice React app, per spec. This is a front-end change. We have an existing React app with auth, query client, routes, layout.

The active session bar should be visible on every authenticated screen, i.e., inside AppLayout, above the Outlet (or somewhere). It must show active session (if any). Should show its key fields: name, status, elapsed time ticking. It also offers resume (navigate to detail) and close session (calls close endpoint after confirm). If closing session succeeds, the bar empties.

Only one active session at a time; opening another session (by clicking session in list?) should replace it, with confirm if current one has unsaved notes (dirty flag). The detail screen already tracks dirty flag. So need to intercept navigation from list to session detail: when clicking a session link, if there is an active session and that session is dirty (i.e., unsaved notes), we need to confirm before proceeding. The detail screen already implements a block for dirty flag using router blocker.

Alternatively, they may want to show a confirm dialog on the active session bar's behavior when a user tries to open another session via the list or other navigation? Actually spec says "Opening another session while the first has unsaved notes → confirm before replacing". The only place to open a session is SessionsListScreen where each row has a Link to /sessions/:id. So we need to intercept that Link click: if active session exists and is dirty, we need to present a confirmation before navigation, which then should open the new session (and set active session accordingly). The detail screen tracks dirty flag and uses useBlocker, but that only triggers on navigation away from detail screen (i.e., using router's navigation). But clicking a link in list is navigation away from detail page (or from list page) to detail page: If currently on detail page with unsaved notes, clicking a link in the list to open another session would cause navigation from detail to list (maybe? Actually the user is on the detail page, and the UI shows the list maybe? The list screen is separate path; not shown at the same time). But the confirm needed is when the operator is on the detail page with unsaved notes and tries to open a new session (by clicking back to list and then a new link). However spec says "Opening a session from the list makes it the active session; the bar shows its key fields (name, status, elapsed time ticking) on ALL screens." So active session is set when a session is opened. The list shows session name, etc. Clicking a session row sets active session via the GET /sessions/:id endpoint: In the handler, when GET /api/sessions/:id is called, it returns the session and also updates state.activeSessionId = s.id if s.status !== 'closed' else keep unchanged. So the active session is set server-side when fetching details. That implies that after navigation to session detail screen, the active session is set automatically on the server. The client should fetch the active session via GET /sessions/active (api.getActiveSession) to display bar. The bar should be a component that queries that endpoint.

Thus we need to add a component (ActiveSessionBar) that uses useQuery for active session, handles loading, error states. Shows bar with session name, status badge, elapsed time (since startedAt). Should tick (update displayed time). For elapsed time, we can compute difference between now and startedAt (if status not closed). Should update each second perhaps via setInterval.

Bar also offers "Resume" button to navigate to session detail (i.e., navigate to /sessions/:id). And "Close session" button that triggers confirm dialog (existing ConfirmDialog) and upon confirm calls closeSession mutation, and on success empties bar. The closeSession mutation already exists (useCloseSession) which calls api.closeSession and updates query caches via onSuccess.

We also need to ensure that when active session is closed, the bar empties (i.e., shows no active session). So after close, the server returns the updated session (status closed), and active session query should refetch? Possibly we need to update the active session query data: after closing, state.activeSessionId is set to null in server handler. The close mutation onSuccess updates session detail and caches but does not directly update active session query. The active session query would still hold the old session data unless refetched or invalidated. But we can manually set active session query data to null. Or we can rely on the server's response: after close, active session is null. We can call queryClient.invalidateQueries for sessionKeys.active (maybe). Since we have query client.

Alternatively we can call useMutation with onSuccess to remove active session: after close, we can set query data for sessionKeys.active to null. But we also need to refetch maybe.

Better: In useCloseSession mutation's onSuccess we should also update the active session query. However the spec says "Close session ... empties the bar on success." That suggests we need to ensure that after closing session, active session query returns null, causing bar to hide.

We could modify useCloseSession's onSuccess to set query data for sessionKeys.active to null. Or to invalidate it. Since the active session query is separate. Let's inspect existing useCloseSession (in src/features/sessions/queries.ts). It sets query data for session detail, and calls patchLists. It does not touch active. We'll need to adjust it.

But we must ensure we don't break other parts. Possibly we need to adjust useCloseSession accordingly.

Also we need to implement the bar component and integrate into AppLayout. Add necessary imports.

Furthermore, we need to handle opening a second session while first has unsaved notes: The confirm before replacing. Implementation details: The active session is stored server-side; to replace it we need to load a new session (via GET). But the active session is set on server when GET /sessions/:id is called (except closed). When a user clicks on a session link, they navigate to that detail page and GET that session. If there is a currently active session that is dirty, we need to confirm before proceeding to new session. The detail screen already has a blocker that uses useBlocker(dirty) for unsaved notes. The user navigating away from a dirty detail page triggers blocker (router navigation). But the confirm for opening another session would be triggered on navigation away from the dirty session. Since useBlocker(dirty) sets a blocker that intercepts navigation and shows a confirm dialog. That confirm dialog is already present in SessionDetailScreen (the second ConfirmDialog). The confirm dialog uses blocker.state === 'blocked' to open. So the user will see a confirmation "Leave with unsaved notes?" If they confirm, navigation proceeds to new location (the list page or new session detail). So that covers unsaved notes warnings when trying to navigate away. However spec says "Opening another session while the first has unsaved notes → confirm before replacing". That seems to already be covered by useBlocker. So maybe we just need to make sure that the active session bar's "Resume" button uses the same logic (i.e., if unsaved notes in current session, clicking resume should respect the same blocker). Actually "Resume" navigates to detail; but if currently no detail open (i.e., on some other screen), clicking "Resume" just navigates to active session detail, not interfering with any dirty session. However if the operator currently has unsaved notes in some other session, that session may be active (since they opened it earlier). But they might also have opened another session detail screen? Actually they'd have only one active session at a time. The dirty flag only applies to the currently opened session's detail screen, not other screens. So maybe the unsaved notes confirm is covered.

But there is another scenario: While on a detail screen with unsaved notes (dirty), the operator might click on "Resume" button in the active session bar. However the active session bar likely shows the same session as the currently opened detail (if any). So clicking "Resume" while on same detail is redundant, no change.

Nevertheless, we need to implement the confirm for "Close session" using existing ConfirmDialog. We also need to make sure the confirm for unsaved notes when clicking "Close session"? Actually close session button is on detail screen, not on bar. The bar also offers close session. The bar's close should also confirm via ConfirmDialog. That is required.

Potentially we could reuse the ConfirmDialog component.

The bar also needs to show "elapsed time ticking". Implementation: We need a component that calculates elapsed time based on startedAt and maybe status. If session is closed, maybe show total time? Or just not show. But spec says "elapsed time ticking". So we need to display time since startedAt (maybe as HH:mm:ss). We'll implement a simple component that uses useEffect with setInterval (1000ms) to update elapsed seconds.

Implementation details:

ActiveSessionBar component:

- useQuery to get active session: const { data: session, isLoading, isError } = useQuery({ queryKey: sessionKeys.active(), queryFn: api.getActiveSession, staleTime: 0 })? Maybe default staleTime is 30 seconds. But we need to keep it fresh. We can set refetchInterval to something? Or just rely on refetch on window focus (disabled). Probably not needed; we just need to tick the elapsed time locally.

- While loading: show nothing? Or maybe placeholder? Could show nothing. The spec says handle pending and error: a failed fetch must not render as "no active session" — those are different states and the operator can tell them apart. So if error occurs, we should show some error state in the bar. So we need to render something indicating error. Could render a div with "Error loading active session" with perhaps the error message. Or we can display a bar that says "Error loading active session". The spec mentions "error envelope". However this is front-end.

We need to ensure that on logout, all state cleared and bar disappears (since auth context's logout clears query cache). That's already happening.

The bar appears only on authenticated screens: we can add to AppLayout component (inside the header perhaps). Since AppLayout is the authenticated shell. The spec says the bar should be visible on every authenticated screen, not just in header but maybe below header. We'll add a component inside <main> before <Outlet /> maybe, to be at top of main. Or inside the header.

Simplify: add after header: <ActiveSessionBar />.

Implementation steps:

1. Create src/features/sessions/ActiveSessionBar.tsx (maybe within sessions feature). Contains component.

2. Import necessary UI components: Button, Badge, ConfirmDialog. Also useNavigate for resume.

3. Use useQuery for active session.

4. If loading: return null (maybe show nothing). If error: show bar with error message and a retry button? Could show "Failed to load active session". Provide button to retry (invalidate queries?). Or just show error.

Spec says "Handle pending and error on the active-session query. A failed fetch must not render as "no active session" — those are different states and the operator can tell them apart even when the code cannot." So we need to differentiate between "no active session" (session is null) vs "error". So if session is null, hide the bar? Actually if no active session, bar should be empty; probably hide it entirely. But we may want to show a placeholder (maybe nothing). We'll hide it.

If error, we should show some error indicator. We'll implement simple error display: a div with text "Failed to load active session". Possibly also show a "Retry" button that calls refetch. Good.

If session present, display a bar: show session name, status badge, elapsed time, resume button, close button. Show "Close session" triggers confirm.

We need to implement elapsed time tick. Compute using startedAt. Use a state for elapsed seconds updated each second via setInterval. Use useEffect.

Potential issues: When session status changes (like after close), session may become closed, and we want to hide bar (or show still? maybe still show closed session but no active). Since after close active session becomes null, but we might need to handle the case where the server hasn't been refetched yet. We'll set mutation for close to invalidate active session query, ensuring the bar hides. In useCloseSession, after success we can call qc.setQueryData(sessionKeys.active(), null). Or we can call qc.invalidateQueries({ queryKey: sessionKeys.active() }). We'll need to add to useCloseSession.

Let's examine sessionKeys.active() function: returns ['sessions', 'active']. So we can call qc.setQueryData(sessionKeys.active(), null). The type for query data is Session | null (as per API). So we can set it to null.

We need to import sessionKeys from queries.

We'll modify src/features/sessions/queries.ts accordingly. We can add after close session mutation's onSuccess: also update active session query. Let's modify useCloseSession.

But ensure we also keep existing patchLists etc.

Alternatively, we can create a separate hook for closing session that also updates active. But easiest: modify useCloseSession.

Now integrate ActiveSessionBar into layout.

Implementation details:

AppLayout currently:

```
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
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

We need to import ActiveSessionBar and include it somewhere. Perhaps after header and before <Outlet />. Eg:

```
<main>
  <ActiveSessionBar />
  <Outlet />
</main>
```

Also need to import.

Potential design: <ActiveSessionBar /> may need to be positioned with CSS. Not needed for tests.

Now tests:

We need to write new tests for the bar's behavior. Existing test suite includes sessions list tests. Need to add tests for:

- Bar appears after opening a session (i.e., navigate to session detail, then navigate back to list, should still see bar with session name etc.)

- Bar persists after page refresh (i.e., simulate reload by re-render with same state? Since we use msw, active session is stored in server's state.activeSessionId. After navigation to session detail, the GET /sessions/:id sets state.activeSessionId. Then if we render the app with a different path (or re-render?) and the active session query runs again, bar should display.

- Bar shows elapsed time ticking.

- Resume button navigates to detail.

- Close button triggers confirm dialog, and after confirming, the bar disappears.

- Confirm before opening second session if current is dirty: This behavior is already in SessionDetailScreen's useBlocker. So maybe we need test that dirty flag prevents navigation away and prompts confirm. But that's existing behavior. However the new spec says we need to ensure that opening another session while unsaved notes prompts confirm. Since this is already covered by detail screen's confirm on navigation, maybe test that when notes are edited and user clicks a session link in list, the confirmation appears.

Given we need to add tests for new behavior, focusing on bar.

Test approach: Use renderApp and userEvent to simulate. Use state to set user. Use waitFor for session list. Then click on session link to go to detail. Wait for detail screen. Then verify that ActiveSessionBar appears (maybe check presence of session name in bar). Then verify that clicking "Resume" leads to detail (maybe already on detail). For close session: In bar, click "Close session", confirm, and then verify bar disappears.

Also test page refresh: Simulate re-mount of component. For example, after navigating to detail and confirming active session set, we can unmount and re-render. However easier: After navigation to detail, we can change path to /sessions (list). The ActiveSessionBar should still be there because active session persisted in server; the query client may have cached the active session data. But we want to test that after a full page refresh (i.e., the query client cleared, but we can't clear). Actually full page refresh is not possible in test environment without reloading the entire app. But we can simulate by clearing query client caches and re-mount the app. Or we can manually clear the query client via queryClient.clear() which is same as logout behavior. But in real reload, the page reload would start with fresh query client; active session is fetched from server via GET /sessions/active. So we can simulate by rendering a new instance of the app (renderApp) after the session is set active. Since state.activeSessionId remains set in the mock server (global variable). So we can call renderApp again to new render. Or we can call cleanup and re-run.

Simplify: Write test that after opening a session (set active), we call renderApp('/sessions') again (i.e., new render). Then wait for bar to show session name.

Test for error handling: Could simulate server error for active session endpoint, but maybe not needed.

Implementation plan:

Add tests in src/features/sessions/ActiveSessionBar.test.tsx (or maybe within SessionsListScreen tests). Use vitest with @testing-library/react.

Test 1: Bar appears after opening a session

- Set state.user

- renderApp('/sessions'); wait for session list (e.g., "Inspection 1").

- Click link to first session (use getByText('Inspection 1') maybe a link). Since link text is the session name.

- Wait for detail screen (check presence of session name in <h1>).

- The ActiveSessionBar should be visible. Find element containing the session name (maybe there is a bar with class "active-session-bar"? We'll need to add a wrapper element with a data-testid attribute for easy selection. Since we cannot modify test expectations unknown, but we can create a data-testid.

Add to ActiveSessionBar component a container element with data-testid="active-session-bar". Inside show details.

Then test findByTestId('active-session-bar') and within check text.

Test 2: Bar persists after re-render (simulate page refresh). After step above, we can unmount the render (via the return from renderApp) and then call renderApp('/sessions') again. But renderApp returns the result of render (including unmount). Actually render returns object with unmount method. So we can store const result = renderApp('/sessions'); after actions, call result.unmount(); then call renderApp('/sessions'); Then wait for the active session bar.

But need to ensure state.activeSessionId persists across renders (server state). The mock server sets activeSessionId when GET /sessions/:id is called. So after initial navigation to detail, activeSessionId is set. When we re-render the app, getActiveSession query should fetch that. So bar appears.

Test 3: Close session via bar

- On the same page after active session bar is present, find "Close session" button. It may be inside ConfirmDialog? Actually the bar includes "Close session" button which triggers confirm dialog. We'll need to find button text 'Close session' (maybe with variant?). Then click it; expect confirm dialog to appear (maybe by checking text "Close this session?"). Then click confirm button (maybe with confirmLabel "Close session" or default?). The ConfirmDialog component renders a button with confirmLabel text inside the confirm button. In the bar's close flow, we should open ConfirmDialog. We'll design accordingly.

- After confirming, the mutation runs and active session becomes null. Need to wait for bar to disappear. Wait for query to reflect null: expect query not to have bar.

- Also ensure that the server state changes: state.activeSessionId becomes null.

Test 4: Resume navigation works (optional). In bar, clicking "Resume" should navigate to session detail. We could test that when on list page, click "Resume", and then wait for detail screen heading.

Test 5: Unsaved notes confirm before opening another session. This is more complex: from a dirty detail screen, click on another session link (maybe a different session). Should show confirm dialog ("Leave with unsaved notes?") as per SessionDetailScreen. Already present. So we need to test that the confirm appears. We need to simulate editing notes: type into textarea, then click another session link. The blocker should block navigation, showing ConfirmDialog. Then after confirming, navigation proceeds. Ensure that after confirming, the active session bar updates to new session? Possibly.

Let's locate confirm text in SessionDetailScreen: ConfirmDialog with open={blocker.state === 'blocked'}, title="Leave with unsaved notes?" body ... confirmLabel="Leave". So we can test that.

Test 4: Actually unsaved notes confirm test may already exist? No test for this currently.

Thus we need to add at least tests for bar features. Possibly combine a few tests.

Now implement ActiveSessionBar component.

Consider useQuery: useQuery({ queryKey: sessionKeys.active(), queryFn: api.getActiveSession }). It may need to have staleTime maybe 0? Default is 30 sec. For our purpose okay.

We'll also need useMutation for closing session. Already have useCloseSession hook.

ActiveSessionBar will maintain local elapsed time display.

Implementation:

```
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession, sessionKeys } from './queries';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { sessionKeys as sk } from './queries'; // import

export function ActiveSessionBar() {
  const { data: session, isLoading, isError, error, refetch } = useQuery({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
  });
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const [elapsed, setElapsed] = useState<string>('');

  // compute elapsed time string
  useEffect(() => {
    if (!session) {
      setElapsed('');
      return;
    }
    const start = new Date(session.startedAt);
    const update = () => {
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      const totalSec = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      setElapsed(`${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (isLoading) return null; // or loading placeholder
  if (isError) return (
    <div data-testid="active-session-bar-error">
      <p>Failed to load active session.</p>
      <Button onClick={() => refetch()}>Retry</Button>
    </div>
  );
  if (!session) return null;

  const handleClose = () => {
    closeSession.mutate(session.id);
    setConfirmClose(false);
  };

  // closeSession mutation may need to update active query
  // We'll modify useCloseSession accordingly

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsed}</span>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)} disabled={session.status === 'closed'}>
        Close session
      </Button>

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

Note: We'll need to import useQuery from '@tanstack/react-query'.

Now modify useCloseSession in queries.ts: Add to onSuccess: after patchLists, also set active session query to null if session is closed; also maybe refetch. But spec says close sets status to closed and active session becomes null. So we need to update accordingly.

Implementation: In useCloseSession's onSuccess:

```
onSuccess: (updated) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  // If closed, clear active session query
  if (updated.status === 'closed') {
    qc.setQueryData(sessionKeys.active(), null);
  } else {
    // Might still be active? But after close it is closed, so always null.
    qc.setQueryData(sessionKeys.active(), null);
  }
}
```

But we need to import sessionKeys.

Also maybe we need to ensure that after close, the active session query will be refetched to reflect null, but setting to null is fine.

Potential race: The active session query may be stale; but setting to null forces UI to hide.

Edge Cases: When a session is closed from detail screen (existing close button on detail), it also uses useCloseSession mutation. That will also clear active session bar. Good.

Now integrate ActiveSessionBar in AppLayout. Add import.

Potentially need CSS classes for layout, but not required for tests.

Now tests.

Write test file at src/features/sessions/ActiveSessionBar.test.tsx.

We'll need to import renderApp, screen, waitFor, userEvent.

Test 1: Show bar after opening session.

Implementation:

```
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('shows after opening a session and persists after refresh', async () => {
    // set user
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    // render at sessions list
    const { unmount } = renderApp('/sessions');

    // Wait for list to load
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Click first session link
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    // Wait for detail to load
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Bar should appear
    const bar = await screen.findByTestId('active-session-bar');
    expect(bar).toHaveTextContent('Inspection 1');

    // Simulate page refresh by unmount and re-render
    unmount();
    renderApp('/sessions');

    // Bar should still appear with same session name
    const bar2 = await screen.findByTestId('active-session-bar');
    expect(bar2).toHaveTextContent('Inspection 1');
  });
```

Potential issues: The first renderApp call returns the result of render, but we don't capture the return. renderApp returns void (it calls render but returns nothing). Actually renderApp is defined as:

```
export function renderApp(initialPath = '/sessions') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(...)
}
```

It returns the result of render (which is RenderResult). So we can capture result.

Thus:

`const result = renderApp('/sessions'); const { unmount } = result;`

Ok.

Now test closing session via bar:

```
it('can close active session via bar', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  renderApp('/sessions');

  // Wait for list, open session
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

  // Bar appears
  const bar = await screen.findByTestId('active-session-bar');
  expect(bar).toBeInTheDocument();

  // Click close session button
  await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
  // Confirm dialog appears
  const confirmButton = await screen.findByRole('button', { name: 'Close session' });
  // But there are two "Close session" buttons: one in bar, one confirm. The confirm button is inside dialog, but same text; but we can query the dialog by title: findByText('Close this session?')
  await waitFor(() => expect(screen.getByText('Close this session?')).toBeInTheDocument());
  // Click confirm button inside dialog
  await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
  // Wait for bar to disappear
  await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
});
```

But there's risk of ambiguous button text 'Close session' - the bar button and dialog button share same label. When clicking the bar's close button, the confirm dialog opens, the confirm button also says "Close session". That's fine. After clicking the bar button, the confirm appears, then we click confirm.

But need to target the correct confirm button after the dialog appears. Since the first click triggers open, and we need to wait for the confirm dialog to appear, then click confirm.

Potential test to also verify that after close, active session is removed, state.activeSessionId is null.

After the mutation, we can check `expect(state.activeSessionId).toBeNull();` But state.activeSessionId is internal to mock server's DB. The close mutation updates it. The test can import state from '../../mocks/db' and check.

Now test unsaved notes confirm.

```
it('prompts when navigating away with unsaved notes', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  renderApp('/sessions');

  // open session
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

  // Edit notes
  const textarea = screen.getByLabelText('Notes');
  await userEvent.clear(textarea);
  await userEvent.type(textarea, 'new notes');

  // click another session link from sessions list? But we are on detail page; we need to navigate to list first. Let's navigate back to sessions list via a link in nav? There's nav links: in AppLayout header, there are links to "/sessions" and "/orders". So we can click link to "/sessions". Since it's a link, navigation attempt will trigger blocker and show confirm dialog "Leave with unsaved notes?".

  // Click Sessions link in header:
  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  // Expect confirm dialog appears
  await waitFor(() => expect(screen.getByText('Leave with unsaved notes?')).toBeInTheDocument());
  // Confirm leaving
  await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
  // Expect navigation to sessions list
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument()); // maybe still on list
});
```

Need to locate the "Sessions" link text in header; it's "Sessions". That should be found.

The confirm dialog's confirm button is labeled "Leave". So we click that.

Potentially the list may show the same "Inspection 1" which also appears in list, making the expectation ambiguous. But after leaving, the page should be SessionsListScreen, which displays "Sessions" heading. So we can check for the heading "Sessions". The list screen has `<h1>Sessions</h1>`. So after navigation, we should see a heading with text "Sessions". Use getByRole('heading', { name: 'Sessions' }). So we can use waitFor.

Test passes.

Now we need to ensure that the blocker's ConfirmDialog is still used; that test ensures unsaved notes confirm works.

Now add ActiveSessionBar component file.

Add necessary imports.

Now adjust useCloseSession mutation.

Potentially need to import sessionKeys inside queries.ts. Already sessionKeys is defined at top, includes active. So we can modify useCloseSession to set active query to null.

Implementation modifications:

Current useCloseSession:

```
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

We change to:

```
onSuccess: (updated) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  // Clear active session if it was the closed session
  if (updated.status === 'closed') {
    qc.setQueryData(sessionKeys.active(), null);
  }
}
```

Import sessionKeys (already in scope) and use active.

Now we need to ensure that after close, the active session bar disappears. The ActiveSessionBar component's query will get null and render nothing.

Edge case: In onSuccess, we need to also maybe setQueryData for active session to null. That's enough.

Now we need to ensure that the active session query is refetched after opening a session (via GET /sessions/:id). The API's GET /sessions/:id updates state.activeSessionId on server side, but the client does not fetch active session query again automatically. However the active session query may still be stale. On opening a session, we would want the bar to appear quickly. The session detail screen uses useSession which queries session detail. The active session bar will separately query getActiveSession. It may initially have null or stale. To show bar after opening a session, we need to ensure that the active session query refetches after GET /sessions/:id completes (i.e., after useSession fetch). The simplest is to let the active session bar query have a short staleTime; it will refetch after some time if stale. But we want immediate update. Could we use queryClient.invalidateQueries(sessionKeys.active()) after navigating to session detail? But we can also set the active session query data manually in useSession's onSuccess. However useSession currently uses useQuery without any side-effects. There's no onSuccess. So we might need to add a side-effect to set active session query after fetching a session (if it's not closed). That would make the bar appear immediately.

Alternatively, rely on the fact that the active session GET will be called when the bar component mounts (e.g., after navigation to detail). Since we add the bar to the layout (which is always present), after navigating to detail screen, the bar component is already present and its query will have executed earlier. Let's think about timeline:

- Initially on /sessions list, ActiveSessionBar mounts and performs getActiveSession. Since no active session, returns null. The query returns null, and the bar renders nothing.

- Then user clicks on a session link. The navigation to /sessions/:id loads SessionDetailScreen. However the ActiveSessionBar component is already mounted and its query result may be stale. It previously returned null. After navigation, useSession fetches session details, which triggers server to set state.activeSessionId to this session's id. But the active session query is not refetched. However after navigation, the ActiveSessionBar component might still hold cached data (null). Since the query's staleTime is 30 seconds by default, after staleTime passes or if we manually trigger a refetch (e.g., useQuery with refetchOnWindowFocus disabled), it may not automatically refetch.

Thus the bar might not appear immediately after opening a session, unless we add logic to refetch active session when the detail is loaded. Since the spec says "Opening a session from the list makes it the active session; the bar shows its key fields on ALL screens." So we need to ensure bar appears after opening. So we need to ensure that active session query updates when we open a session.

Possible approaches:

- In SessionsListScreen, we could set active session by calling an API endpoint, but GET /sessions/:id does that automatically.

- In the click handler for the session link, we could prefetch the active session. But better is to use react-query's query invalidation when session detail is fetched.

Add a useEffect in SessionDetailScreen after data loaded to trigger invalidation of active session query: but this will cause refetch and update.

Or modify useSession query to have onSuccess side-effect that sets active session query data.

Given the pattern in code: for list queries and updates they use patchLists to update caches. But they didn't implement setting active session anywhere else. We'll need to implement a small side-effect: In useSession hook, we can add an options object with onSuccess to update active session query.

Implementation:

```
export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (data) => {
      // If session is not closed, update active session query
      if (data.status !== 'closed') {
        const qc = queryClient; // but we need to get queryClient
        // cannot get queryClient directly here; need to import useQueryClient and call inside hook.
    },
  });
}
```

But useSession is a custom hook, we can call useQueryClient inside it.

Better approach: modify useSession hook to call useQueryClient and set active session query data on success.

Implementation:

```
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      } else {
        // ensure active session cleared
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}
```

This will ensure that when a session detail is fetched (including initial load for detail screen), the active session query is set to that session.

Potential conflict: useCloseSession also updates active session to null on close. So it's consistent.

One caution: The query client is used inside useSession, which is a hook; fine.

Now need to import useQueryClient at top of queries.ts.

Thus modify queries.ts accordingly.

Potentially need to adjust imports for type.

Now need to adjust imports accordingly.

Now implement ActiveSessionBar component, import sessionKeys and useCloseSession.

Now add data-testid attributes for easy test selection: "active-session-bar" for the main container; also for error "active-session-bar-error". Provide also maybe "active-session-elapsed" for elapsed time.

Now run through test logic.

Testing details:

- When opening a session, after navigation, ActiveSessionBar's onSuccess of useSession will set active session query to the session; ActiveSessionBar's query will be updated to have session data (setQueryData triggers query data update). That will cause the bar to render.

- The test will wait for bar to appear.

Now for the persisted after refresh test: After unmounting and re-rendering the app, the active session query will be fetched anew via GET /sessions/active. Since server has state.activeSessionId set to the active session id, it will return the session (including its fields). The bar will render.

Now for close session test: Using bar's close button triggers confirm, then closeSession.mutate. On success, useCloseSession's onSuccess will set active session query to null. The bar component will see session null and render null. Test will check that bar is not in the document.

Potential nuance: When we click close, we need to wait for the mutation to complete. The mock handler for POST /sessions/:id/close updates status to closed and clears activeSessionId. The mutation returns updated session. Our onSuccess updates active session to null. So after confirming, the bar should disappear quickly.

Now test for unsaved notes confirm before navigating away. Already covered.

Potential modifications needed to handle the confirm dialog in SessionDetailScreen that may already block navigation. Already there.

Now we need to import ConfirmDialog component for bar.

Now update the imports.

Now run through code.

Now check all imports.

File: src/features/sessions/queries.ts

We need to import useQueryClient, useQuery, useMutation already imported.

We'll modify useSession to include queryClient.

Implementation:

```
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      } else {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}
```

Potential problem: The query client may be a stale instance due to closure. But fine.

Now useCloseSession's onSuccess should also update active session.

Add import for sessionKeys.active if not needed.

Now add ActiveSessionBar component file.

Implementation: src/features/sessions/ActiveSessionBar.tsx

Let's write code.

Now integrate into AppLayout.

Modify src/app/AppLayout.tsx to import ActiveSessionBar and include it.

Implementation:

```
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
...
<main>
  <ActiveSessionBar />
  <Outlet />
</main>
```

Make sure relative path is correct: AppLayout is in src/app/AppLayout.tsx. So import from '../features/sessions/ActiveSessionBar'.

Now we need to add any required UI components styling? Not needed.

Now test file.

Add src/features/sessions/ActiveSessionBar.test.tsx

Now we need to ensure test imports: state from '../../mocks/db' relative path.

Note: test file located at src/features/sessions/ActiveSessionBar.test.tsx. The relative path to state: '../../mocks/db' (since test file is two levels deeper: features/sessions, then ../.. leads to src/). In other tests they use `import { state } from '../../mocks/db';` as seen in SessionsListScreen.test.tsx (which is in src/features/sessions). So correct.

Similarly renderApp import: '../../test/render'.

Now we need to make sure the test file is included by vitest (via test folder). It will be compiled.

Potential test dependencies:

- In test for close session confirm, after clicking close button, we need to select the confirm button. However there may be multiple confirm dialogs: one in bar, one in detail. The confirm dialog in bar has title "Close this session?" and confirmLabel "Close session". The confirm dialog is shown after clicking bar button. There's also a confirm for unsaved notes in detail but that has title "Leave with unsaved notes?" So we can find the dialog by text "Close this session?" and then find button with text "Close session". That's fine.

One nuance: When clicking the close button in bar (Button variant="danger"), the button's text is "Close session". However there may also be a close session button in detail screen, but we are not on detail screen? Actually the bar close button is also "Close session". So after clicking, we need to find confirm dialog.

Now implement.

Potential issues with query client and React strict mode causing double mounting. But tests likely okay.

Now check imports: ActiveSessionBar uses useQuery from '@tanstack/react-query', Badge, Button, ConfirmDialog, useNavigate, useCloseSession, useState, useEffect.

Also need to import sessionKeys maybe for type. However active session query returns Session | null; we don't need to import sessionKeys if we only use the hook to set active query. Actually we need sessionKeys.active() to set query data in useCloseSession, which we already added.

ActiveSessionBar may import sessionKeys but not needed.

Now add type for API: use api.getActiveSession.

Now adjust the default import paths: src/api/client exports api and SessionQuery etc. So we can import { api } from '../../api/client'.

Now code.

Potential type errors: In useQuery for active session we need to type generic: useQuery<Session | null> perhaps. But TS can infer.

Now adjust imports: import { useQuery, useQueryClient } maybe for mutation? Actually ActiveSessionBar uses useCloseSession which already uses query client. No need to import useQueryClient here.

Now final step: add any needed test cleanup. The test environment will automatically reset msw handlers etc.

Now implement modifications.

Potential issues with TypeScript strict: The ActiveSessionBar component uses session?.startedAt which is a string; date parse works.

Define state for elapsed as string; when session changes, effect resets.

Edge Cases: When session has status 'closed', maybe we still show elapsed but not needed; bar may be hidden after close; but after close it's null, not closed.

Now implement the code modifications.

Now go through each file to be changed.

We will produce a diff as full files: We'll need to supply the entire content of modified files. Since we cannot produce diff, we must output entire files after modifications.

Thus we need to output these files:

- src/app/AppLayout.tsx (modified)
- src/features/sessions/queries.ts (modified)
- src/features/sessions/ActiveSessionBar.tsx (new)
- src/features/sessions/ActiveSessionBar.test.tsx (new)

Potentially we need to adjust any imports in other files (e.g., the path in AppLayout). We'll modify accordingly.

Now produce final output with proper headings.

Before proceeding, let's examine any other parts that may be needed.

The AppLayout currently imports { Link, Outlet } from 'react-router-dom', and uses Button, useAuth. We'll add import for ActiveSessionBar. Ensure path correct: AppLayout is under src/app, and ActiveSessionBar is under src/features/sessions. So import path: '../features/sessions/ActiveSessionBar'.

Now queries.ts modifications:

Add import useQueryClient if not already. It's already imported: `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';`. So fine.

Modify useSession as described.

Also modify useCloseSession's onSuccess.

Potentially we also want to modify patchLists signature? Not needed.

Now ActiveSessionBar component:

We need to import Badge from '../../components/ui/Badge', Button from '../../components/ui/Button', ConfirmDialog from '../../components/ui/ConfirmDialog', useNavigate from 'react-router-dom', useQuery from '@tanstack/react-query', api and sessionKeys from '../../api/client'? Actually sessionKeys is exported from queries.ts, not from client. Let's import it from './queries'. Use import { useCloseSession, sessionKeys } from './queries'.

Need to import useQuery: `import { useQuery } from '@tanstack/react-query'`.

Now code.

Potential need for type Session imported from '../../api/types', for type inference.

Now test file.

Potential issues: When using renderApp, after navigation to detail screen, the app's header still includes "Sessions" link etc.

Test for unsaved notes confirm before navigation away: We'll use the header link to "Sessions". That triggers navigation and blocker.

One nuance: In the test, after editing notes, the blocker will cause navigation to be blocked, showing confirm dialog. In that confirm, the confirm button label is "Leave". So we need to find it. ConfirmDialog's cancel button text is "Cancel", confirm button text is confirmLabel which we set to "Leave". Good.

After confirming, we should see navigation to sessions list (heading "Sessions").

Potential risk: The "Leave" button may appear also elsewhere (maybe the close session confirm in bar also uses "Close session"). So no conflict.

Now test code.

Now ensure we import proper userEvent. Use import userEvent from '@testing-library/user-event'.

Now implement tests.

Potential need to adjust waitFor timeouts? Should be okay.

Now we also need to make sure that the ActiveSessionBar component is visible after navigation. The test can find by role button "Resume"? Or test that bar container is present. Use findByTestId.

Now we need to set data-testid attribute on bar container. Use data-testid="active-session-bar". For error container use "active-session-bar-error". Ensure these are added.

Now ensure that the confirm dialog in bar uses ConfirmDialog component which renders null if open false. When confirmClose state true, it shows confirm dialog with title "Close this session?" So test for that.

Potential conflict: When we click "Close session" button on bar, confirmClose becomes true, and ConfirmDialog is rendered. The confirm button has label "Close session". So we need to find by role button with name "Close session" inside the dialog. However there is also the same label for the bar button that we clicked initially, but after clicking the bar button, it stays open and we may need to wait for dialog. The test will find the dialog title "Close this session?" and then find the confirm button.

Potential scenario: findByText('Close this session?') returns the title element. Then we find button "Close session". But there might be two such buttons (the original bar button and the confirm). However after clicking the bar button, the bar's button remains in the DOM (the button that opened the dialog). The confirm button is also there with same text. The query for getByRole('button', { name: 'Close session' }) would match the first (the bar button). So to avoid ambiguous selection, we could find the button inside the dialog by using getByRole('button', { name: 'Close session', hidden: false })? That still ambiguous. Better to query for the confirm button inside the dialog container: We can get the dialog by its role "dialog" with aria-label "Close this session?" then query within that container. Use within from @testing-library/react.

So import { within } from '@testing-library/react'.

Implementation:

```
const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
await userEvent.click(confirmBtn);
```

Now after confirming, wait for bar to disappear.

Potential issue: After close, active session is null, but the bar component returns null. The query may still have isLoading false, isError false, data null. So screen.queryByTestId('active-session-bar') returns null. Good.

Now test for persist after refresh: We'll unmount and re-render.

Implementation:

```
const { unmount } = renderApp('/sessions');
// do actions
unmount();
renderApp('/sessions');
await screen.findByTestId('active-session-bar');
```

But renderApp returns RenderResult. We'll capture.

Potential risk: The unmount of the previous render also clears the query client used by that instance. However the second renderApp will create a new query client, which will fetch active session again from server.

Now ensure that after unmounting, we wait for the server state to be set. It should be set after the previous GET /sessions/:id, which we already performed. So second render should show the bar.

Now implement test for unsaved notes confirm.

Implementation details:

- Render app, open a session detail.

- Find textarea label "Notes". In SessionDetailScreen, the label is `<label>Notes <textarea... /></label>`. The label text "Notes". Using getByLabelText('Notes') returns the textarea.

- Use userEvent.clear(textarea), then type new notes.

- Click the header link "Sessions" (in AppLayout header). Use screen.getByRole('link', { name: 'Sessions' }).

- After clicking, wait for confirm dialog. Use screen.getByRole('dialog', { name: 'Leave with unsaved notes?' }). Then find confirm button with name "Leave". Click it.

- After confirming, wait for the SessionsListScreen heading.

Now we may also need to verify that after leaving, the active session bar still persists (since the session remains active). But not required.

Now ensure test imports correct components.

Now run through all files to see if any other code modifications needed.

Potential missing import for useQuery in ActiveSessionBar. Add.

Potential need to set staleTime or refetchOnMount? The active session query may be called initially with null and staleTime of default 30 secs. After we set active session query data via setQueryData in useSession's onSuccess, the query will be updated and the bar will re-render accordingly. That should happen immediately.

Potential need to set initial data for active session query? Not needed.

Now ensure that setQueryData on active session query does not conflict with any query key usage. sessionKeys.active() returns ['sessions', 'active']; consistent.

Now ensure that patchLists updates lists but not needed for active.

Now ensure import path for sessionKeys inside queries is correct: sessionKeys is defined in same file. So within useCloseSession we can just reference sessionKeys.active().

Now modify queries file accordingly.

Now final check: test for close session via bar may also need to ensure that after closing, the bar disappears and the server state activeSessionId is null.

Add assertion: `expect(state.activeSessionId).toBeNull();`

Potential need to import state from '../../mocks/db'.

Now test for resume navigation: After opening a session, close the bar? Actually test for resume may not be needed for acceptance but could be added.

But we might include test that clicking Resume button navigates to same session (maybe no change). Could be optional.

Now consider the test for error handling: not required.

Now commit modifications.

Now produce final answer with the new files and modified files.

We must not repeat unchanged files.

List of files to output:

- src/app/AppLayout.tsx (modified)
- src/features/sessions/queries.ts (modified)
- src/features/sessions/ActiveSessionBar.tsx (new)
- src/features/sessions/ActiveSessionBar.test.tsx (new)

Potentially also modify import in src/features/sessions/queries.ts to import useQueryClient (already present). Use of useQueryClient in useSession.

Also need to import useQueryClient in queries.ts for useSession (already imported). Already imported at top.

Now we should double-check the content of src/features/sessions/queries.ts after modifications.

Current content (provided earlier) is:

```
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

We'll modify useSession and useCloseSession.

Now we need to add onSuccess to useSession, and modify useCloseSession.

Implementation:

```
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      // Update active session query if session is not closed
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      } else {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}
```

Now useCloseSession:

```
export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // Clear active session if it was closed
      if (updated.status === 'closed') {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}
```

Now import for useQueryClient already present.

Potential additional imports needed: not.

Now implement ActiveSessionBar component file.

Now add test.

Now final step: Ensure that any code referencing useSession elsewhere (SessionDetailScreen) will get the extra onSuccess effect but unchanged usage.

Now check that the SessionDetailScreen's useSession hook may also need to return query data that includes updated data after close; but they already use useSession. The close action uses useCloseSession, which also updates session detail.

Potentially the ActiveSessionBar also uses useCloseSession mutation and will use its onSuccess to clear active.

Now check for possible infinite loops: useSession onSuccess calls qc.setQueryData for active session. This may cause a query update for active session which triggers the ActiveSessionBar to re-render. That's fine.

Potential problem: useSession may cause a double fetch for active session if active is also refetched after session detail fetch, but okay.

Now check for test for unsaved notes confirm uses useBlocker. The blocker's confirm is in SessionDetailScreen, not in bar. So test will verify confirm works.

Now ensure that we imported `useBlocker` from `react-router-dom`. That's already used.

Now ensure that the new ActiveSessionBar component's ConfirmDialog is imported correctly. It is located at '../../components/ui/ConfirmDialog'.

Now check that there is no circular import: ActiveSessionBar imports useCloseSession from './queries' which itself imports useQuery etc. No issues.

Now verify that we added data-testid attributes.

Now consider that the bar may need to be placed inside main element before Outlet. But AppLayout currently has main containing <Outlet/>. We'll add <ActiveSessionBar/> before Outlet.

Potential CSS issues: Not needed.

Now check for any TypeScript errors due to missing imports or types.

ActiveSessionBar code:

```
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api, sessionKeys } from '../../api/client';
import { useCloseSession } from './queries';
```

But sessionKeys is not exported from client. It's exported from queries.ts. So import from './queries'.

Actually we want to import from './queries'.

Thus adjust:

```
import { useCloseSession, sessionKeys } from './queries';
```

But sessionKeys is exported from queries.ts (as const). So correct.

Now we need to import useQuery from '@tanstack/react-query'.

Now the query for active session: `useQuery({ queryKey: sessionKeys.active(), queryFn: api.getActiveSession })`. However we also need to import the type for Session. Not necessary.

Now define useQuery return type: It infers.

Now define isLoading, isError.

Now we need to import the error type for error handling, but not needed.

Now need to implement refetch for error case.

Now we need to use useQuery's `refetch` method.

Now final code.

Now test file.

Write test import path: import { renderApp } from '../../test/render'.

Now test file location: src/features/sessions/ActiveSessionBar.test.tsx

Now write tests as described.

Now double-check that the code for ConfirmDialog uses `open` boolean and expects confirmLabel prop. In ActiveSessionBar, we call ConfirmDialog with confirmLabel "Close session". Good.

Now we need to ensure that ConfirmDialog's onCancel resets state. In ActiveSessionBar's onCancel we setConfirmClose(false). Good.

Now test for close: after clicking confirm, the bar disappears. Use waitFor.

Now test for resume: optional.

Now unsaved notes confirm test: Use getByRole('link', { name: 'Sessions' }) to click nav link.

Now confirm dialog appears.

Now click confirm.

Now check that heading "Sessions" is present.

Now note that after confirming leaving, we may also have to handle that the active session bar stays visible. Not needed.

Now run through code to see if any missing imports.

ActiveSessionBar imports useQuery from '@tanstack/react-query', but useQuery is imported in other files as `import { useQuery, useMutation, ... }`. Good.

Now confirm that we have proper imports for Button, Badge, ConfirmDialog.

Now confirm that sessionKeys.active is a function, not property. So we call sessionKeys.active().

Now confirm that in useSession's onSuccess we call qc.setQueryData(sessionKeys.active(), session). This sets the active session query.

Now ensure that useCloseSession's onSuccess sets active to null.

Now verify that the initial active session query will fetch server state. After close, server returns closed session and clears state.activeSessionId. So even if we didn't set null, the query could refetch on staleTime expiration and become null. But we set null to clear bar immediately.

Potential nuance: In useCloseSession's onSuccess we also update session detail. If the status is closed, patchLists will replace session in list.

Now confirm that the query for active session may have stale data; we set it to null to clear.

Now ensure that the active session bar component's useQuery is configured with default staleTime. If we set active session query data to null manually, it will reflect instantly.

Now for the test to close session via bar, after clicking confirm, the bar disappears. The query's data changed to null.

Potential race condition: The close session mutation might be async; we need to await its completion. The mutation returns a Promise. In test, after clicking confirm button, we need to wait for the bar to disappear.

Now check that we used "await userEvent.click(confirmBtn)" which returns void.

Now need to wait for bar to be removed: use waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument()).

Now also check that state.activeSessionId is null.

Now test unsaved notes confirm:

- After editing notes, we click header link. The navigation is blocked by blocker (router block). Confirm dialog appears. Confirming "Leave" will proceed to navigation.

We need to make sure that after leaving, the bar remains (should show same session). Not needed.

Now test that after clicking "Leave", we are on sessions list: heading "Sessions".

Now we need to import `within` from '@testing-library/react'.

Now implement.

Now final code.

One more file: src/app/AppLayout.tsx will now import ActiveSessionBar.

Now run through any other code that may be impacted.

Potential for lint errors: In AppLayout, we have a stray semicolon after import? No.

Now run through the code with TS strict.

Potential missing type for `api.getActiveSession`: In client.ts we have `getActiveSession: () => request<Session | null>('/sessions/active')`. So query returns Session | null.

In ActiveSessionBar, useQuery can infer generic type of data: Session | null. However isError can be true. But isLoading and isError are boolean. If we call isError, TypeScript may need to infer type for error. No type needed.

Now implement component.

Now we need to import `useQueryClient`? Not used in component. Not needed.

Now final check.

Now generate final answer with code blocks.

Potential need to add default export? Not needed; the component is exported as named.

Now proceed to output final answer.
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
      <main>
        <ActiveSessionBar />
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
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      // Synchronise the active‑session query with the fetched detail.
      if (session.status !== 'closed') {
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

### src/features/sessions/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api } from '../../api/client';
import { useCloseSession, sessionKeys } from './queries';

/**
 * Persistent bar showing the currently active session (if any). It appears on
 * every authenticated screen, displays key fields, ticks elapsed time, and
 * offers resume / close actions.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError, refetch } = useQuery({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
  });

  const navigate = useNavigate();
  const closeSession = useCloseSession();

  const [confirmClose, setConfirmClose] = useState(false);
  const [elapsed, setElapsed] = useState<string>('');

  // Compute and tick elapsed time while the session is active.
  useEffect(() => {
    if (!session) {
      setElapsed('');
      return;
    }

    const start = new Date(session.startedAt);
    const update = () => {
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      const totalSec = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      setElapsed(
        `${hours.toString().padStart(2, '0')}:${minutes
          .toString()
          .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      );
    };
    update(); // initialise immediately
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (isLoading) return null;

  if (isError) {
    return (
      <div data-testid="active-session-bar-error" className="active-session-bar error">
        <p>Failed to load active session.</p>
        <Button onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }

  if (!session) return null;

  const handleClose = () => {
    closeSession.mutate(session.id);
    setConfirmClose(false);
  };

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsed}</span>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)} disabled={session.status === 'closed'}>
        Close session
      </Button>

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
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('appears after opening a session and persists after a refresh', async () => {
    // Authenticate
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    const { unmount } = renderApp('/sessions');

    // Load the list and open the first session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Bar should now be visible
    const bar = await screen.findByTestId('active-session-bar');
    expect(bar).toHaveTextContent('Inspection 1');

    // Simulate a full page refresh by unmounting and mounting a fresh app instance
    unmount();
    renderApp('/sessions');

    // The bar should still show the previously active session
    const barAfterRefresh = await screen.findByTestId('active-session-bar');
    expect(barAfterRefresh).toHaveTextContent('Inspection 1');
  });

  it('can close the active session via the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    renderApp('/sessions');

    // Open a session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Ensure the bar is present
    const bar = await screen.findByTestId('active-session-bar');
    expect(bar).toBeInTheDocument();

    // Click the "Close session" button on the bar
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));

    // Confirm dialog should appear
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
    await userEvent.click(confirmBtn);

    // Bar should disappear and server state cleared
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
    expect(state.activeSessionId).toBeNull();
  });

  it('prompts when navigating away with unsaved notes', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    renderApp('/sessions');

    // Open a session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Edit the notes field to make the form dirty
    const notesField = screen.getByLabelText('Notes');
    await userEvent.clear(notesField);
    await userEvent.type(notesField, 'Unsaved changes');

    // Attempt to navigate away via the header link
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));

    // Blocker dialog should appear
    const blockerDialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    const leaveBtn = within(blockerDialog).getByRole('button', { name: 'Leave' });
    await userEvent.click(leaveBtn);

    // After confirming, we should be back on the sessions list
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  });
});
```
