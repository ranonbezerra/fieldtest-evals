# solution

## reasoning

```
We need to adapt existing code to implement persistent active-session bar in a back-office React app.

First, understand the code base structure. The existing code is a simple React app with authentication context and queries for sessions and orders. The feature we need to add is a bar that appears on every authenticated screen, showing the active session (if any) with its key fields (name, status, elapsed time ticking). The bar should have "resume" button (navigate to detail) and "close session" button (calls existing close endpoint, with confirm). Only one active session at a time; opening another replaces it, with confirm if the current one has unsaved notes – the detail screen already tracks a dirty flag.

Active session must survive full page refresh by calling GET /sessions/active. Must not cache locally beyond react-query.

The existing code already has API client with getActiveSession, session queries with active: () => ['sessions', 'active'] query key. However there is no UI component for active session bar; no useActiveSession hook; no functionality for setting active session when opening a session from list (when clicking a row). Also need to incorporate confirm logic when opening another session while current active has dirty notes.

The detail screen already fetches session details and updates state.activeSessionId when GET /sessions/:id is called (in mock handler). The mock handler for GET /sessions/:id sets state.activeSessionId = s.id if not closed. So the active session is stored server-side: when retrieving a session detail, the server marks it as active. Also the GET /sessions/active returns that session. The client must query getActiveSession to know which session is active.

But there is no UI for showing active session bar.

Also need to add a UI component that goes in AppLayout, maybe after header, before main? Probably below header but above Outlet. The spec: "persistent active-session bar, visible on every authenticated screen". The AppLayout wraps all authenticated screens. Should render the bar within the layout, maybe inside header or above main.

We must also handle opening a session from the list to make it active. The list currently displays rows with a link to session detail. So clicking a link will navigate to detail, and on that page, the GET /sessions/:id will set active session on the server. That's already happening. So just clicking will open the session and make it active. However if you open another session while current has unsaved notes (dirty flag), we need to confirm before navigating to that new session. This may involve intercepting navigation from list row when clicking a link, using maybe the same block logic as the detail screen's dirty detection (useBlocker?). The detail screen uses useBlocker(dirty) and useBlocker is from react-router-dom's navigation blocker (v6?). Actually useBlocker is part of react-router-dom, it's an internal? In v6.4+ there's useBlocker? I need to check. The spec mentions useBlocker used in SessionDetailScreen. So we can also use that to block navigation when dirty.

But in SessionsListScreen, clicking on a row currently navigates via onClick: navigate(`/sessions/${s.id}`). That's a programmatic navigation; we could intercept it with a check for unsaved notes, but the detail screen is where we have the dirty flag. The list does not have access to the current dirty flag. However we need to know when clicking a session row to navigate to another session, if there is a dirty flag in the detail screen, show confirm. This could be done using the useBlocker in the detail screen itself: if the user navigates away (including via link click from list while the detail is still mounted) the blocker will catch navigation attempt. The blocker is active only when the detail screen is mounted (user is on detail). But clicking a link from the list would only happen when they are on the list screen, not on detail screen. Actually the scenario: Operator opens a session from list → active session, bar shows. Then they navigate away from the detail (maybe to orders screen) and lose context. Now they want to open another session from the list. However they might have unsaved notes in the detail screen (if they left the detail unsaved and still had dirty notes). But if they navigated away, the blocker would have prevented navigation away (unsaved notes). That is already implemented: SessionDetailScreen has a blocker that intercepts navigation away if dirty. So they cannot leave the detail screen with unsaved notes unless they confirm. So the scenario of opening a second session while current has unsaved notes may not happen because they'd be forced to confirm leaving the detail. However the spec says "Opening a second session while the first has unsaved notes → confirm before replacing". That may refer to the situation where they are on the list screen, and active session is set to a session but not on its detail page. The active session bar shows the active session, but the detail screen may not be visible. The unsaved notes tracking only exists in the detail screen. If they open a session from the list while the bar shows an active session (which may have unsaved changes that are not saved because they never opened detail?), that seems contradictory.

Actually the bar is always visible, but the dirty flag only applies when editing notes on the detail screen. So unsaved notes exist only when the user is on the SessionDetailScreen, and they have dirty notes. If they navigate away, they will see the confirm dialog because of useBlocker, which is set up in SessionDetailScreen. So they'd confirm leaving (or cancel). So they can't navigate away (or open another session) without dealing with dirty notes. So maybe we don't need to handle the confirm when opening a new session from the list. But spec explicitly says "Only one active session at a time; opening another replaces it (with confirm if the current one has unsaved notes — the detail screen already tracks a dirty flag)." So it expects that the confirm will be shown when you try to open a new session (by navigating to another session detail) while unsaved notes exist. This will be handled by the blocker on the detail screen automatically. So we might not need to add anything extra.

Therefore the core tasks:

1. Add a new UI component, say ActiveSessionBar.tsx, which uses a query to fetch active session (api.getActiveSession) and display appropriate UI.

2. The component must handle loading and error states separately. According to spec: "Handle pending and error on the active-session query. A failed fetch must not render as 'no active session' — those are different states and the operator can tell them apart even when the code cannot." So we need to differentiate states: loading (pending), error (error), and success (active session maybe null). On success with null, we should render nothing (no bar). On error, maybe show a bar with error message? Or maybe show an error indicator. The spec says not to render as "no active session". So we need to display something like "Error loading active session". Let's design a UI: maybe just a placeholder with a class 'active-session-bar' and showing error text.

3. The bar must show key fields: name, status, elapsed time ticking. For elapsed time, we need to compute elapsed time from session.startAt to now, or if session closed, maybe not show. Probably show timer that updates every second. We'll implement a component that uses a useEffect with setInterval to compute elapsed time. The session object includes startedAt and possibly closedAt. The bar should show elapsed time for active sessions (not closed). We'll compute delta.

4. The bar offers "Resume" (navigate to detail) and "Close session" (calls close endpoint behind confirm). Use the ConfirmDialog component for confirmation.

- The "Resume" button should navigate to `/sessions/${session.id}`.

- The "Close session" button triggers confirm dialog; upon confirm, call `closeSession` mutation. On success, the bar empties. Since we have the active session query, after closing, the server active session will be cleared (state.activeSessionId set to null). The query should refetch. We can either invalidate or let mutation update caches accordingly. There is no mutation for closing session in the bar; we can reuse useCloseSession from session queries. That mutation's onSuccess patches session details and list caches. It does not automatically refetch active session query, but after closing, the active session query result might still be old; we need to either set active session query data to null, or invalidate. Simpler: after closing session, we can call queryClient.invalidateQueries(active). Or we can also setQueryData for active to null.

5. Show bar only on authenticated screens (i.e., within AppLayout). The AppLayout currently contains header and main with <Outlet/>. We'll add <ActiveSessionBar/> somewhere, maybe within header after nav or maybe after header before main. But we need to ensure it appears on all authenticated pages.

6. Ensure that after logout, everything clears, including the bar: the AuthProvider logout clears query client (queryClient.clear()). That will clear active session query.

7. Ensure active session persists after page refresh: the active session query should fetch from GET /sessions/active and display.

8. Tests: we need to write tests for the new behavior, in the same style as existing tests. Tests for: bar appears after opening a session and remains visible across navigation; shows correct name, status, elapsed time increments; clicking "Resume" navigates to detail; clicking "Close session" triggers confirm dialog and on confirming closes session and bar disappears; error handling (maybe we simulate error in active session fetch); unsaved notes confirmation (test that if you navigate away from detail screen while dirty, the confirm appears). Already have detail screen tests? Let's inspect test files.

Search for existing tests. In the repository, there is a test file for SessionsListScreen.test.tsx, maybe others. Let's open all test files.

Search for test files. There's SessionsListScreen.test.tsx. There might be tests for SessionDetailScreen? Let's search.

There is no reference for SessionDetailScreen.test.tsx in the read-only. Let's search other test files:

Search all src/test:

No more test files in the provided reference besides SessionsListScreen.test.tsx and maybe other tests for orders? There's no order tests in reference.

But we need to add tests for new behavior.

Potential tests:

- Test that after logging in and loading sessions list, clicking a session row opens its detail and bar appears with correct information.

- Test that after clicking "Close session" on the bar, confirm appears; after confirming, the bar disappears and the session list reflects closed state? But we can focus on bar disappearing.

- Test that the elapsed time increments: we can test that the timer text changes after some time.

- Test that active session persists after page refresh: simulate page reload by re-rendering the app with initial path /orders (or any screen) after setting active session via some action, then check that bar shows after initial load, without interacting. Or simply set the state in the mock db: we can simulate that the server has an active session after login (maybe by performing GET /sessions/:id or by manually setting state.activeSessionId). However, after login we might not have an active session until we open a session. For the test, we can open a session, then unmount and remount the app, ensuring that active session persists.

- Test error handling: we can mock GET /sessions/active to return 500 error with ApiError code. Since the error handling is supposed to display some error UI (not as no active session). We need to write a test that overrides the handler using server.use().

- Ensure that while the active session is loading (pending), some loading indicator appears (maybe "Loading active session...").

We also need to test unsaved notes confirm: but that is existing behavior, not required for new tests maybe.

But we need to write tests for the new behavior. We must also consider that there are existing tests (SessionsListScreen.test.tsx) that rely on the original behavior. They should continue passing. So our changes must not break them.

Implementation details:

Add new component ActiveSessionBar.tsx. It will use:

- useQuery to fetch active session: queryKey sessionKeys.active(), queryFn api.getActiveSession.

- useMutation to close session: useCloseSession from queries (which uses useMutation). Might call closeSession.mutate.

- Use useNavigate from react-router-dom.

- Use useState for confirm dialog open.

- Use useEffect for elapsed time: compute elapsed time (maybe using Date.now - new Date(startedAt)). We'll need to store elapsed time as string, or compute on render.

Simplify: we can display minutes:seconds using simple format. The timer should tick.

Implement a function formatElapsed(startedAt) => string. It calculates diff to now in seconds and returns format: `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`.

Set interval to update every second, using useState and setInterval.

Edge cases: session closed? But the bar is only visible for active session. The server may not set active session for closed session; the mock GET /sessions/active returns null if no active. So active session will always be open or paused. We can compute elapsed time only for those.

Implement error handling: if isLoading => show loading indicator maybe "Loading active session…". If error => show error UI, maybe just text "Error loading active session". The spec says not to render as "no active session". So we can render a bar with error message.

When active session is null (no active), render null (no bar).

UI layout: The bar can be a div with class "active-session-bar". Within it:

- Show name, status badge, elapsed time.

- "Resume" button linking to session detail.

- "Close session" button opens confirm.

Maybe also show a spinner while closing.

Implementation details: Use the Badge component for status.

Simplify: Use <Button> for resume, <Button variant="danger"> for close.

Implement confirm dialog: Use ConfirmDialog component, open via state.

When confirm close, call closeSession.mutate(activeSession.id). On success, we need to update active session query. We'll set active query data to null.

Implement using mutation's onSuccess: setQueryData for active to null, maybe invalidate.

We can call queryClient.invalidateQueries(sessionKeys.active()). Actually need to get query client from useQueryClient.

Alternatively, after close session, we can just do nothing because after close, the server sets active session null, but our cache still has previous session. So we need to update it manually. So in mutation options, we can add onSuccess: (updated) => { qc.setQueryData(sessionKeys.active(), null) }.

But closeSession mutation is defined in queries.ts with onSuccess updating detail and list caches, but not active. So we may need to extend useCloseSession to also clear active query. But we can just handle in bar component using useMutation separate from queries useCloseSession; but we want to reuse the mutation logic. We can get closeSession = useCloseSession() (which returns a mutation). Then we can add onSuccess handler locally using closeSession.mutate, but the mutation already has onSuccess defined. We can't add more onSuccess there unless we create a new mutation. Perhaps we can use useCloseSession from queries (which updates caches but not active). In the bar, we can use closeSession.mutate; after it's settled (onSuccess), we can call queryClient.invalidateQueries(sessionKeys.active()); Or set null.

Better: in bar component, after closeSession.mutate, we can add a callback via .then? Actually useMutation returns mutate function that accepts variables and optionally options for onSuccess override? The mutate function can accept options: mutate(variables, { onSuccess: ... }). According to react-query v5, the mutate function signature is mutate(variables, options?). In v5, useMutation returns { mutate: (variables: Variables, options?: MutateOptions) => void, ... }. So we can pass onSuccess. But simpler: just call queryClient.invalidateQueries(sessionKeys.active()) after closing.

Ok.

Now we need to integrate ActiveSessionBar into AppLayout. Currently AppLayout returns:

<div className="shell">
  <header>...</header>
  <main>
    <Outlet />
  </main>
</div>

We need to place <ActiveSessionBar/> somewhere after header, maybe above main, or inside main before Outlet. For layout, we can put inside <main> above Outlet or before main. I think before <main> or maybe within <header>. Let's decide: The bar should be visible on every authenticated screen, maybe as a separate stripe under the header. So we can render it after <header> and before <main>. Something like:

<header>...</header>
{ <ActiveSessionBar /> }
<main> <Outlet/> </main>

Implementation: In AppLayout import ActiveSessionBar component and include it conditionally (if not logged in maybe not show, but AppLayout only rendered for authenticated screens). So no extra check needed.

Now we need to create the component file: src/components/ActiveSessionBar.tsx maybe under src/app or src/components. Given conventions: UI components go under src/components/ui, but this is a feature component, may go under src/features/sessions or src/app. But maybe better under src/features/sessions/ActiveSessionBar.tsx. There's already features/sessions folder. So create src/features/sessions/ActiveSessionBar.tsx.

Now we need to write tests.

Test file: src/features/sessions/ActiveSessionBar.test.tsx.

Test scenarios:

1. "Active session bar appears after opening a session and shows details".

- Set state.user to a user.

- RenderApp('/sessions').

- Wait for the sessions list to load, find a session row e.g., "Inspection 1" and click it (or simulate clicking the link). That triggers navigation to detail, the GET /sessions/:id will set active session server side.

- After navigation (session detail page), we should see the ActiveSessionBar (maybe at top). Ensure that it shows the session name "Inspection 1", status badge "open" (or whatever), and an elapsed time. For elapsed time, we can check that the text matches pattern like "00:??". But better to test that the elapsed time updates. Use fake timers to control setInterval, or we can just check that the element exists.

- Also test that clicking "Resume" button navigates to the same detail page (maybe no navigation). Or we can test that clicking "Close session" opens confirm dialog.

2. "Close session confirm works and bar disappears".

- Continue from previous test: Click "Close session" button. Confirm dialog opens. Click "Close session" confirm button. Wait for mutation to finish. Then ensure the ActiveSessionBar is no longer in the document.

3. "Active session persists after full page refresh". Simulate reload: After closing the session, but for persistence test, we need to open a session, then unmount and re-render App with same location maybe '/orders' and verify bar appears again.

Simplify: Write a test that after opening a session, then re-render the entire app to simulate page refresh, but maintain state.user and server state. Use renderApp('/orders') after unmount. Since server state holds activeSessionId, the active session will persist. The active session query will fetch it and show bar.

Implementation: In test, after opening a session, we can call renderApp('/orders') again (maybe using the same renderApp function, but need to cleanup previous render). Use `renderApp` again after we call `cleanup` from testing library? Usually `render` returns utilities that include `unmount`. We can capture the returned result, then call `unmount` then render again.

Better: Use Vitest's `afterEach` to clean up. The test can just call `renderApp('/orders')` after clicking a session, but then the previous component might still be in the DOM. For simplicity, we can use `renderApp` with initial path '/orders' after we set active session manually via direct API call: we can call api.getActiveSession? Actually we need the server's activeSessionId to be set. In mock, GET /sessions/:id automatically sets state.activeSessionId to that session. So we can directly make a request to fetch a session (e.g., using api.getSession) inside test to set active session. However the active session bar query uses server state.

Simplify: In test, after login and initial render, we can call api.getSession('s-001') via fetch? But we want to use the same client (api). However we need to make a fetch request with the session cookie? The mock server sets state.activeSessionId when GET /sessions/:id is called, but the request will be made via the fetch call in the app. So we could navigate to the session detail screen, or we could programmatically call api.getSession. But this would need the authentication cookie; login flow sets state.user and cookie is simulated via fetch include. For simplicity, we can simulate the same as a user navigating to detail.

Thus for persistence test, we can renderApp('/sessions'), click a session to open detail, then call cleanup/unmount and re-renderApp('/orders'), expecting the bar shows. Ensure that bar shows after new render. That simulates page refresh, though not exactly page reload but the component re-instantiation.

Alternatively we could use `renderApp('/orders')` after the session is opened and after the navigation to detail, we navigate away to '/orders' by clicking a nav link and then ensure bar persists. That's already happening because the bar is global.

But the spec explicitly says "Full page refresh → the bar comes back from `GET /sessions/active`". So need to test that after closing and reopening the page (unmount+remount) the bar appears.

We'll write a test that:

- Set state.user.

- RenderApp('/sessions'), click session row to open detail (e.g., "Inspection 1").

- Ensure bar appears.

- Unmount using result.unmount().

- RenderApp('/orders') again (simulate page refresh). Because the query client is fresh for each render (renderApp uses makeQueryClient). In the app's real page refresh, there would be a new query client but server state persists. So after unmount and new render, the active session query should fire and bar should appear.

Now test for error handling: Simulate server error on GET /sessions/active. Use server.use() to add a handler that returns 500. Then renderApp('/orders') and expect to see error UI. We'll need to import server from src/mocks/server. Write test:

import { server } from '../../mocks/server'; import { http } from 'msw'; and add a handler for GET /api/sessions/active with 500.

The error UI could be something like "Error loading active session". We'll design the bar component to render a <p> with that text.

But need to coordinate with other tests to not cause failures: we need to reset handlers after each test (setup already does server.resetHandlers). So OK.

Potential issues: The active session bar component may be rendered for all authenticated screens, including login screen? No, because AppLayout is under RequireAuth. The bar will only be rendered inside AppLayout, which is only used for authenticated routes. So login screen not display it.

Now other code modifications:

- AppLayout: import ActiveSessionBar and place it.

- Possibly need to add some CSS classes, but not required.

- Types: need to import sessionKeys and api, etc.

- Ensure query key import: import { sessionKeys } from './queries' (or from './queries' relative path). Since the component resides in src/features/sessions, the path is './queries'.

- Use useQuery to fetch active session: useQuery({ queryKey: sessionKeys.active(), queryFn: api.getActiveSession, staleTime: ...? default staleTime 30 seconds defined in query client; that's fine.

- The query can return Session | null. We'll type accordingly.

- Implementation of time ticking: Use useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []); and compute elapsed time based on now and session.startedAt. Use useState for now.

- Ensure to handle when session is null -> return null.

- Loading state: query.isLoading -> show <p>Loading active session…</p> maybe with a subtle style.

- Error state: query.isError -> show error UI with query.error maybe. Since the request throws ApiError, the error object is an instance of ApiError. For display, we could show error.message or error.code.

- The spec says "A failed fetch must not render as 'no active session' — those are different states and the operator can tell them apart even when the code cannot." So we need to display something different from no active session. So we could show a bar with "Error loading active session". We'll implement that.

- When session is null (no active), we should render null (no bar). That ensures bar is absent.

Now additional modifications: The list screen currently uses <Link> to session detail; clicking link triggers navigation without confirmation. Since we have the blocker in detail screen, this is okay.

Now we need to adjust session queries to handle active session caching? The getActiveSession query has key sessionKeys.active(). The getActiveSession query may need to be used in other components. There's no code referencing it now, but adding ActiveSessionBar will.

We also need to ensure that active session query data is invalidated when session is closed, updated, or active session changes due to selecting another session. The close session mutation does not currently invalidate active query. We'll add an effect in the bar: after close, we invalidate.

Also for opening a new session (clicking a link to another session detail), the active session query will be automatically updated because server sets activeSessionId when GET /sessions/:id is called, but we need to refetch active session query to get updated session. The query client might automatically refetch? It will not automatically refetch just because we navigated. The active session query is a separate query; it will have staleTime 30s, after clicking a session within that time, the cached active session query may still hold previous session. The detail screen will fetch the session via useSession, and that may update caches for session detail (sessionKeys.detail). It will also cause state.activeSessionId to be set on server, but the client won't know until it refetches active query. So we need to trigger a refetch when navigating to a new session. Options:

- In SessionDetailScreen after loading the session, we could call queryClient.invalidateQueries(sessionKeys.active()). But we want to avoid modifying many screens.

- Instead, we can adjust the active session bar to subscribe to queryClient events? Or simply use useEffect with dependencies on query data. The active session bar could use a query that has refetchOnWindowFocus false (default). But it may not automatically refetch after navigation.

Better approach: In SessionsListScreen, when clicking a session, we could navigate and also prefetch active session. But we can also add the active query to automatically refetch on each navigation using useQuery with option refetchOnMount: true? By default react-query will fetch on mount if data is stale. Since staleTime is 30_000, after opening a new session within that period, the active query will be considered fresh and not refetched. That would cause the bar to still show old session. To solve this, we should set staleTime to 0 for active session query, so it always refetches on mount. Alternatively, we can use queryClient.invalidateQueries in useEffect when location changes. Or we can set the active query's queryFn to getActiveSession and set staleTime to 0.

Check query-client config: default queries staleTime is 30_000 (30 seconds). If we need immediate freshness for active session, we could set staleTime: 0 in the query options for active session.

Thus in ActiveSessionBar component, we can call useQuery({ queryKey: sessionKeys.active(), queryFn: api.getActiveSession, staleTime: 0 }). That ensures that each mount refetches and also each time component re-renders? Actually staleTime: 0 means data becomes stale immediately after fetching, so subsequent refetches when component remounts or when the window refocuses will happen. It won't automatically refetch on each navigation, but component may re-render due to location change? The component remains mounted across navigation; it's inside AppLayout, not inside the screens. So when we navigate from session detail to another route, ActiveSessionBar remains mounted; it won't refetch automatically because it's not being remounted. However we can add useEffect that watches location (useLocation) and triggers refetch of active session when location changes, to catch when a new session becomes active. Or we can have a separate query that refetches on intervals; but not required.

Simplify: In ActiveSessionBar, we can use `useEffect` with `useLocation` to watch for route changes; when location changes, we call activeQuery.refetch(). This will cause bar to update after navigation to new session. That may be the simplest solution.

Implementation steps:

- import useLocation from 'react-router-dom'.

- In component, const location = useLocation();

- useEffect(() => { activeQuery.refetch(); }, [location.pathname]); However this would refetch on any navigation, even to other routes, which is okay: we just need to keep up-to-date.

Potential issue: The refetch may be unnecessary but fine.

Now confirm that after closing a session via bar, the active session becomes null, so refetch may update to null.

Now implement confirm dialog for close.

Potential concurrency: When closeSession mutation is in progress (pending), the close button should be disabled.

Now we need to import necessary modules.

Now implement tests for time ticking: Might be tricky. We can use vi.useFakeTimers to control time. But we need to ensure that setInterval uses the jest/vitest fake timers. Use `vi.useFakeTimers()`.

Test:

- RenderApp with a session open.

- Wait for bar to appear with elapsed time showing something like "00:00". Then advance timers by 5 seconds and expect time to update.

Potential problem: The component uses setInterval that updates state on each tick; using fake timers requires that we call `vi.advanceTimersByTime` and run pending timers.

We need to use Vitest's built-in fake timers: `vi.useFakeTimers()`. Also need to call `vi.runAllTimers()` after advancing maybe.

But ensure that after test we restore timers with `vi.useRealTimers()`. Use afterEach.

Now final code.

Now we need to write tests in style: use screen, waitFor, userEvent.

Test 1: Bar appears after opening session.

Pseudo steps:

- Set state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

- renderApp('/sessions');

- Wait for list to load: screen.getByText('Inspection 1').

- Click on the first session row: maybe find row containing 'Inspection 1' and click. Since SessionsListScreen uses <Link> for name cell: <Link to={`/sessions/${s.id}`}>{s.name}</Link>. So we can click the link text.

- After navigation, wait for session detail screen to load: screen.getByText('Inspection 1') maybe appears inside h1. Actually the detail screen shows <h1>{session.name}</h1>. So wait for that.

- Then check that ActiveSessionBar shows: find the session name in bar, maybe use screen.getByText('Inspection 1') but there will be two copies: one in detail header and one in bar. To differentiate, we can find using getByRole('button', { name: 'Resume' }) or find the bar container by role? Maybe we add a data-testid attribute to the bar container like <div data-testid="active-session-bar">. The spec didn't mention test id but we can add for testability.

Let's add a data-testid attribute for easier testing: <div data-testid="active-session-bar" ...>. Also add some unique text for error case.

Thus tests can check for element with test ID.

Implement in component.

Test steps continue:

- Ensure bar contains session name and status badge (maybe using getByText('open') within bar). The badge is a span with class 'badge'.

- Click "Close session" button; confirm dialog appears with title "Close this session?" and confirmLabel "Close session". Use screen.getByText('Close this session?').

- Click confirm: the confirm button text is "Close session". Use userEvent.click.

- Wait for bar to disappear: waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument()).

Test for resume button: Another test can verify that clicking "Resume" navigates to detail screen; but already on detail screen. Let's test on a different route: After opening session, navigate to '/orders' (via nav link), then click resume button. It should navigate to detail.

Implementation: After bar appears, click nav link "Orders" (in header). Then bar remains. Then click resume button and expect detail screen with session name.

Test for error handling: Use server.use to add a handler for GET /api/sessions/active that returns error. Then renderApp('/orders'), wait for error UI.

We need to import server and http from msw.

The error handler should return something like HttpResponse.json({ code: 'error' }, { status: 500 }). Let's do that.

Now tests for elapsed time: After opening a session, find the elapsed time element (maybe have a test id). We'll add a span with data-testid="elapsed-time". The component will render elapsed time. The test will use fake timers.

Implementation: In component, include a <span data-testid="elapsed-time">{elapsed}</span>. The elapsed string may be like "0:00" or "00:00". We'll match format.

Test steps:

- vi.useFakeTimers();

- Render app and open a session.

- Wait for bar, get elapsed time value via getByTestId('elapsed-time').

- Store initial text.

- Advance timers by 5000ms (5 seconds). Run timers.

- Expect the elapsed text to change.

But need to run pending timers after advancing.

Implementation details: Use `vi.advanceTimersByTime(5000);` then maybe `await waitFor(() => ...)` for updated.

Potentially we need to call `await vi.runOnlyPendingTimersAsync();` but not sure.

Simplify: Use `act(() => { vi.advanceTimersByTime(5000); })` from @testing-library/react's act.

Import act from '@testing-library/react'.

Now we need to adjust component to use setInterval that updates every second. It will work with fake timers.

Now implement test.

Potential obstacles: The useLocation effect to refetch active session will fire on navigation; need to ensure that after we open a session, the active query refetch occurs and bar shows after request resolves. Since we opened session detail which sets active on server, but the active query may still have stale data (null) if we only load bar after navigation? However we include useEffect that refetches when location changes; after navigation to detail screen (location pathname changes), the active query will refetch and get the active session. So that ensures bar shows.

But also need to fetch active session initially on app start: when rendering AppLayout after login, the bar will also fetch and may be null initially.

Now we need to ensure that the active query has a unique query key and doesn't conflict with other queries.

Potential race condition: When we navigate to detail screen, the detail screen also fetches session data, which triggers server to set activeSessionId. The active query may be triggered by location change after navigation to detail, but the order may be that active query is already in use and stale, with null. When location changes, we refetch, but need to ensure server state has been updated by the time the active query fetch occurs. Since the GET /sessions/:id request completes before navigation ends (the detail screen query), and the active query refetch is triggered after location change (immediately). The active query might fire before the GET /sessions/:id request finishes (depending on timing). But given our code is synchronous (the useEffect after location change runs after rendering of new location, which includes the new component). The order might be: navigation triggers router to render new route; ActiveSessionBar useEffect runs after component mount; it calls refetch, which triggers GET /sessions/active request. Meanwhile, the SessionDetailScreen's useSession query also started; it may finish after the active query. The active query may get null because server hasn't yet set activeSessionId. However the GET /sessions/:id handler sets state.activeSessionId immediately on request, not after response? In the handler, it receives a GET request for /sessions/:id, sets state.activeSessionId = s.id (if not closed) and then returns the JSON. So the GET /sessions/:id request's handler runs, sets active session id before returning response. So when the client receives the response, active session id is set. The active query refetch runs concurrently; if it runs after GET request started but before handler sets state, the handler will run and set active session id, then respond. So whichever request finishes later will reflect the updated state. If active query finishes before GET /sessions/:id request, it would get old active session id (null) and then the active query data would be null. Then later GET /sessions/:id finishes, active session id is set, but active query not refetched. However our active query is set to staleTime 0 and could be set to refetch on window focus but not automatically. So to handle this, we could invalidate active query when session detail query succeeds (i.e., after loading a session). That would guarantee update. The simplest approach: In SessionDetailScreen, after receiving session data, we can call queryClient.invalidateQueries(sessionKeys.active()). This is a minimal change to ensure active query updates.

But modifying SessionDetailScreen is acceptable, but we should not add business logic to controller; but it's a UI screen. It's okay.

But if we incorporate a location change effect that refetches active query, we might still get stale. However the race condition could cause the bar to temporarily show null (no bar) for a moment until active query refetch completes after GET /sessions/:id finishes. The user may not notice. However tests may fail if they expect bar to appear after some time, but we can wait for bar to appear using waitFor.

In test, we will waitFor bar to appear. If the first refetch returns null, the bar will be hidden; then after GET /sessions/:id finishes and active session is set, the active query will still be stale (data null). But not refetched again. So we need to trigger refetch after the session query finishes.

Better approach: In ActiveSessionBar, we can use queryClient to subscribe to changes in session detail caches and refetch when they change. Or we can use useEffect to listen for changes in the `session` query cache? Not easy.

Simplify: We modify SessionDetailScreen to invalidate active session query after session data loads. Add after the data fetch: maybe useEffect(() => { if (session) qc.invalidateQueries(sessionKeys.active()); }, [session]).

But session detail screen is already a screen; adding this effect is fine.

Alternatively, we could use `onSuccess` option for the useSession query. In queries.ts, we could add that but that would be across all usages; not needed. Simpler to add effect in SessionDetailScreen.

Let's add import { useQueryClient } from '@tanstack/react-query' and sessionKeys, then after data loads (when not loading and session present), we call queryClient.invalidateQueries(sessionKeys.active()).

Potential issue: This may cause extra network request, but fine.

Now the bar will show after invalidation and refetch.

Now we also need to handle the scenario when opening a session from list but not navigating to detail, e.g., just clicking link and staying on list? Actually the link navigates to detail, so we always go to detail.

Thus this approach is acceptable.

Now we must ensure that we import sessionKeys in SessionDetailScreen.

Now we need to modify SessionDetailScreen accordingly.

Open SessionDetailScreen code (provided). Let's add after the query: after retrieving data, we can add a useEffect. Also need to import useQueryClient.

Potential concurrency: The data loading may be triggered multiple times; the effect will invalidate each time, but that's fine.

Now add a useEffect that runs when session is defined: invalidates active query.

Implementation:

const queryClient = useQueryClient();

useEffect(() => {
  if (session) {
    queryClient.invalidateQueries(sessionKeys.active());
  }
}, [session, queryClient]);

Now this will cause active session query to refetch after detail loads.

Now we need to import sessionKeys: import { sessionKeys } from './queries' (the relative path is same file). Also import useQueryClient.

Now we also need to ensure that the bar component does not cause infinite loops: When bar refetches and updates active session data, the session detail screen may have a query that also invalidates active query, leading to loops? But the invalidation is only in SessionDetailScreen after session loads; after that, active query changes will not affect session detail unless the session detail query is keyed separately. There's no subscription from active query to session detail. So fine.

Now we need to ensure that the active session bar updates when closing session.

- When closeSession mutation succeeds, we need to clear active session query. In bar component, after calling closeSession.mutate, we can add onSuccess: () => queryClient.invalidateQueries(sessionKeys.active()).

But we have closeSession mutation from queries (useCloseSession) which doesn't clear active. In bar component we can call closeSession.mutate(session.id, { onSuccess: () => queryClient.invalidateQueries(sessionKeys.active()) }). That is possible.

Alternatively, we can manually set query data to null using setQueryData. Simpler: after closeSession.mutate, call queryClient.invalidateQueries(sessionKeys.active()).

Now we need to import useQueryClient, useNavigate, ConfirmDialog, etc.

Implementation details for Close confirmation:

- state confirmClose boolean.

- When clicking close button, setConfirmClose(true). Show ConfirmDialog with open=confirmClose.

- In ConfirmDialog onConfirm: closeSession.mutate(activeSession.id); setConfirmClose(false); Then after mutate, we need to invalidate active query. Use closeSession.mutate(activeSession.id, { onSuccess: () => { queryClient.invalidateQueries(sessionKeys.active()); } }).

Potentially also update other caches (the close mutation already patches session details and list caches). So after invalidation, active query will refetch returning null.

Now we need to handle disabled state of close button while closeSession.isPending.

The bar's close button should be disabled if close mutation is pending.

Now implement resume button:

- On click: navigate(`/sessions/${session.id}`).

Now we need to decide where to import sessionKeys and other utilities.

Now ensure to import ConfirmDialog component.

Now we need to style: not required.

Now add test files.

Potential issues: In tests, we need to use `renderApp` for rendering the whole app; we need to ensure that after login we set state.user. The login is required; the app expects logged in user via API call to /auth/me. In tests, they set state.user manually (see SessionsListScreen.test.tsx). In those tests, they set state.user = { ... } before rendering. That bypasses login step: the auth context effect calls api.me() which returns user if authed, else null. The mock GET /auth/me returns state.user if authed (if state.user not null). So setting state.user before render ensures user is set.

Thus we will use same approach.

Now test implementation details:

Test 1: "active session bar appears after opening session".

Implementation:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
```

We need to import `state` from src/mocks/db.

Set state.user accordingly.

Then `renderApp('/sessions')`.

await waitFor(() => screen.getByText('Inspection 1'));

Click on the link 'Inspection 1': userEvent.click(screen.getByRole('link', { name: 'Inspection 1' })); or simply screen.getByText('Inspection 1') and click.

Wait for detail: waitFor(() => screen.getByRole('heading', { name: 'Inspection 1' })); Actually the heading is h1, maybe getByText.

Now expect the bar: screen.getByTestId('active-session-bar').

Within that bar, expect to find text 'Inspection 1', maybe using within(bar).getByText('Inspection 1'); also expect a badge with text of status: can find by role? Since badge is a span with class badge; easier: within(bar).getByText(session.status). We can also get resume button by getByRole('button', { name: /Resume/i }). Then test that resume button works.

But we need to verify that resume button navigates to detail. Already on detail, but for test we can navigate away first. For simplicity, test close functionality.

Test close: within(bar).getByRole('button', { name: 'Close session' }) maybe label is "Close session"? Actually we may label the button "Close session" directly. Or "Close session" is the text for the button.

Our bar will have a Button with text "Close session". The confirm dialog appears with title "Close this session?" and confirmLabel "Close session". After clicking confirm, bar disappears.

Implementation: Click close button: userEvent.click(screen.getByRole('button', { name: /Close session/i })). Wait for confirm dialog: screen.getByText('Close this session?'). Then click confirm: screen.getByRole('button', { name: 'Close session' })? But there are two buttons with same label: one is in bar, other is in confirm dialog. But the confirm dialog confirm button also has same label "Close session". To differentiate, we can query within the dialog. Since ConfirmDialog renders a <div role="dialog"> with aria-label set to title (title is "Close this session?"). We can find the dialog via `screen.getByRole('dialog', { name: 'Close this session?' })`. Then within that dialog, find button with name 'Close session'.

Implementation:

```tsx
const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
await userEvent.click(confirmBtn);
```

Then wait for bar to disappear:

await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());

Now test that after close, the session status in list page is updated to 'closed'? Not required.

Now test persistence after reload:

Test: "Active session persists after page reload".

Implementation:

- Set state.user.

- renderApp('/sessions').

- Click first session as before to open detail.

- Wait for bar.

- Then unmount and re-render on a different route.

Use:

```tsx
const { unmount } = renderApp('/sessions');
...
unmount();
renderApp('/orders'); // re-render fresh app.
```

Now wait for bar to appear again: waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument()).

But need to ensure that after re-render, query client fresh, but server active session persists, so bar should fetch and show.

Now test error handling:

Test: "Active session bar shows error on fetch failure".

Implementation:

- Set state.user.

- server.use(http.get('/api/sessions/active', () => new HttpResponse(null, { status: 500 })));

- renderApp('/orders').

- Wait for error UI: e.g., screen.getByText('Error loading active session').

Our bar component will render <p>Failed to load active session</p> maybe. We'll decide.

Now test elapsed time ticking:

Implementation:

- vi.useFakeTimers();

- Set state.user.

- renderApp('/sessions').

- Click first session.

- Wait for bar and get elapsed element: screen.getByTestId('elapsed-time').

- Store initial text.

- Advance timers by 5000ms within `act(() => { vi.advanceTimersByTime(5000); })`.

- Expect elapsed text to be later, maybe initial "00:00" then after 5 sec "00:05".

Implementation details: Format may be "0:05" or "00:05". We'll ensure test is robust: check that after advancement, the text matches a regex for increased seconds.

Potential complication: The elapsed time starts from session's startedAt, which is a pre-defined date from mock data. For Inspection 1, startedAt is new Date(Date.UTC(2024, 3, 1 + (i % 20), 8, 0)). For i=0, startedAt is 2024-04-01T08:00:00Z. The test's current time (Date.now()) is probably the real system time when test runs; the mock fetch returns the session data with startedAt set to that date. So elapsed time at start of test may be many seconds (maybe days). Hard to predict. We cannot assume initial value. But we can test that after advancing 5 seconds, the elapsed string changes (increase by 5 seconds). Since startedAt is a fixed timestamp far in the past, the elapsed time will be large and will increase accordingly. For test, we can capture the initial string, then after advancing timers, capture new string, and assert that they differ.

But using fake timers may affect Date.now used inside component for computing elapsed. In component we will use Date.now() directly; setInterval will tick, but Date.now() will still return real time unless we mock Date. If we use fake timers, the system time does not advance. In jest's fake timers, Date.now is also mocked to use the virtual timer. However, in Vitest, vi.useFakeTimers() does mock timers and Date.now as well, so that's okay.

But the startedAt is a fixed timestamp. At initial render, the elapsed time will be now - startedAt, which depends on the current fake time, which starts at 0 (or actual Date.now?). Usually fake timers start at 0 and advance accordingly. In Vitest, using vi.useFakeTimers() changes the time to a base 0 (or maybe use real Date?). Actually Vitest's fake timers start at the current Date.now value (the real value) when setFakeTimers is called, and then you can manually advance. So the initial elapsed time will be (realNow - startedAt). If we run test at any time, it will be a large number. After advancing 5 seconds, it will increase by 5 seconds. So we can compare string values and they should differ. That's sufficient.

Implementation:

```tsx
vi.useFakeTimers();
...
const elapsedElem = screen.getByTestId('elapsed-time');
const initial = elapsedElem.textContent;
act(() => {
  vi.advanceTimersByTime(5000);
});
await waitFor(() => {
  expect(elapsedElem.textContent).not.toBe(initial);
});
vi.useRealTimers();
```

Potential issue: The interval may be 1000ms, but after advancing 5000ms, the component's state update may be asynchronous; need to run pending timers. Using act may flush updates.

Now ensure we import act from '@testing-library/react'.

Now write the test file accordingly.

Now modifications to import path:

ActiveSessionBar component at src/features/sessions/ActiveSessionBar.tsx.

Add tests at src/features/sessions/ActiveSessionBar.test.tsx.

Now modifications to AppLayout:

Add import.

Add component rendering.

Potential style: We need to be careful to not break existing layout. Add ActiveSessionBar component below header.

Implementation:

```tsx
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
...
<div className="shell">
  <header>...</header>
  <ActiveSessionBar />
  <main>...</main>
</div>
```

Alternatively, wrap inside main? Better to place above main.

Now import path: In AppLayout.tsx located in src/app. The relative path to sessions/ActiveSessionBar: from src/app/AppLayout.tsx to src/features/sessions/ActiveSessionBar.tsx is '../../features/sessions/ActiveSessionBar'? Wait location: src/app/AppLayout.tsx -> relative path to src/features/sessions/ActiveSessionBar.tsx is `../features/sessions/ActiveSessionBar`? Since both are in src, one in app, one in features/sessions. The relative path: AppLayout at src/app/AppLayout.tsx. The sessions folder is src/features/sessions/ActiveSessionBar.tsx. So path is `../features/sessions/ActiveSessionBar` (since app is sibling to features). So import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar'.

Now update.

Now modify SessionDetailScreen to invalidate active session query on success.

Implementation modifications:

Add imports: import { useQueryClient } from '@tanstack/react-query'; import { sessionKeys } from './queries';.

Add effect after data loading:

```tsx
useEffect(() => {
  if (session) {
    queryClient.invalidateQueries(sessionKeys.active());
  }
}, [session, queryClient]);
```

Place after other useEffects; ensure queryClient defined earlier.

Now ensure to add `queryClient` variable: const queryClient = useQueryClient();

Now we need to ensure that infinite loops are avoided: Invalidating active session query may cause active session bar to refetch. But the bar's query is separate, and its refetch may cause stale data changes; but it doesn't cause a new session detail query. So safe.

Now confirm that we didn't break any TypeScript types.

Now check the code for any missing imports.

Now add test file.

Now think about other required modifications.

Potential missing import: In ActiveSessionBar component, we need to import useQuery, useMutation, useQueryClient, useNavigate, useLocation.

We need to import useQuery from '@tanstack/react-query'.

Also import api and sessionKeys.

Now confirm that the active session query will fetch Session | null. Type for query result: `useQuery<Session | null>( ...)`. Optionally, we can provide generic.

Now need to handle loading: render a small placeholder maybe <p>Loading active session…</p>. Use a container but spec says "Handle pending and error on the active-session query. A failed fetch must not render as 'no active session'". So we need to display loading and error UI. We'll include them.

Implementation details: The bar may show a placeholder when loading: maybe a div with text "Loading active session…". For error: display a div with error message.

Now define the UI layout:

```tsx
export function ActiveSessionBar() {
  const { data: active, isLoading, isError, error } = useQuery({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
    staleTime: 0,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const closeMutation = useCloseSession();

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const location = useLocation();

  // Refetch active on location change to capture changes.
  useEffect(() => {
    // Slight delay not needed
    queryClient.refetchQueries({ queryKey: sessionKeys.active(), exact: true });
  }, [location.pathname, queryClient]);

  if (isLoading) {
    return <p>Loading active session…</p>;
  }

  if (isError) {
    // error may be ApiError, but just show message
    return (
      <div className="active-session-bar error" data-testid="active-session-bar">
        <p>Error loading active session</p>
      </div>
    );
  }

  if (!active) {
    // No active session
    return null;
  }

  const elapsed = (() => {
    const start = new Date(active.startedAt).getTime();
    const diff = Math.floor((now - start) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  })();

  const handleResume = () => {
    navigate(`/sessions/${active.id}`);
  };

  const handleClose = () => {
    setConfirmOpen(true);
  };

  const handleConfirmClose = () => {
    setConfirmOpen(false);
    closeMutation.mutate(active.id, {
      onSuccess: () => {
        queryClient.invalidateQueries(sessionKeys.active());
      },
    });
  };

  const handleCancelClose = () => {
    setConfirmOpen(false);
  };

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <span>{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="elapsed-time">{elapsed}</span>
      <Button variant="primary" onClick={handleResume}>
        Resume
      </Button>
      <Button variant="danger" onClick={handleClose} disabled={closeMutation.isPending}>
        Close session
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />
    </div>
  );
}
```

We also need to import Badge and Button from ui components.

Now need to import types: Session for typing maybe not needed.

Now some minor adjustments: the queryClient.refetchQueries method signature in react-query v5: queryClient.invalidateQueries takes options, but we want to refetch. Instead of refetchQueries, we can call queryClient.invalidateQueries(sessionKeys.active()). But we only need to refetch when location changes. We can call queryClient.invalidateQueries(sessionKeys.active()).

But we also used location to trigger, but we could also rely on invalidate rather than refetch.

Simplify: useEffect(() => { queryClient.invalidateQueries(sessionKeys.active()); }, [location.pathname]); This will cause refetch.

Now need to ensure that when active session changes due to navigation to detail, active query invalidates and refetch.

Potential: The location change also triggers for navigation away to other pages, which may cause unnecessary refetch, but fine.

Now the closeMutation.isPending check disables close button. Since closeMutation is the mutation returned by useCloseSession. That's fine.

Now adding import statements at top.

Now we need to add proper typings for useQuery. In TypeScript, we can pass generic param: useQuery<Session | null>.

Now we need to ensure that `api.getActiveSession` returns Session | null; but the query's data can be null.

Now confirm that useCloseSession returns a mutation with mutate that takes id. closeMutation.mutate(active.id, { onSuccess: ... }). This is correct.

Now adjust the confirm dialog: We need to ensure that ConfirmDialog's onConfirm is called. Our ConfirmDialog will render with `open` boolean.

Now after close, the bar should disappear. In onSuccess, we invalidated active query, causing refetch which returns null, making component return null.

Now test for close: after clicking confirm, we wait for bar to be removed.

Potential need to wait for server response: The mock close endpoint returns session after setting closedAt and status, but activeSessionId is set to null. Invalidate active query triggers fetch getActiveSession, which will return null.

Now confirm that the close mutation updates caches accordingly; but for the bar we rely on active query.

Now need to adjust any import path in component file.

Now create new file src/features/sessions/ActiveSessionBar.tsx.

Now adjust AppLayout.

Now adjust SessionDetailScreen.

Now adjust tests.

Now tests might need to import server and http for error handling.

Now we also need to import from msw.

Now write test files accordingly.

Potential updates to imports: Need to import necessary modules for the test file.

Now let's write test file.

### src/features/sessions/ActiveSessionBar.test.tsx

We'll write three test cases:

- "shows active session bar after opening a session and can close it"

- "active session persists after page reload"

- "shows error when fetching active session fails"

- "elapsed time updates"

Maybe combine active session persist and elapsed time into separate tests.

Write test code:

```tsx
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { server } from '../../mocks/server';
import { http } from 'msw';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure logged in user before each test
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  });

  it('appears after opening a session and can be closed', async () => {
    renderApp('/sessions');

    // Wait for sessions list to load and click a session link
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    // Wait for detail screen to load
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Active session bar should appear
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    // Close the session via the bar
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    // Bar should disappear
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('persists after a full page refresh', async () => {
    const { unmount } = renderApp('/sessions');

    // Open a session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Ensure bar is present
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    // Simulate page refresh by unmounting and rendering fresh app on a different route
    unmount();
    renderApp('/orders');

    // Bar should reappear based on server state
    const barAfterRefresh = await screen.findByTestId('active-session-bar');
    expect(within(barAfterRefresh).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('shows an error state when fetching active session fails', async () => {
    server.use(
      http.get('/api/sessions/active', () => {
        return new Response(null, { status: 500 });
      }),
    );

    renderApp('/orders');

    const errorMsg = await screen.findByText('Error loading active session');
    expect(errorMsg).toBeInTheDocument();
  });

  it('updates elapsed time every second', async () => {
    vi.useFakeTimers();

    renderApp('/sessions');

    // Open a session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    const elapsed = await screen.findByTestId('elapsed-time');
    const first = elapsed.textContent;

    // Advance timers by 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(elapsed.textContent).not.toBe(first);
    });

    vi.useRealTimers();
  });
});
```

We need to ensure that in the error test, using `new Response(null, { status: 500 })` returns a Response object; msw's HttpResponse class may be easier: `HttpResponse.json(null, { status: 500 })`. But we haven't imported HttpResponse. Simpler: Use `HttpResponse.json({ code: 'unknown' }, { status: 500 })`. But we imported http from msw; HttpResponse is not imported but can be imported. Let's use HttpResponse.

Add import { HttpResponse } from 'msw'.

Implementation:

```tsx
server.use(
  http.get('/api/sessions/active', () => {
    return HttpResponse.json({ code: 'unknown' }, { status: 500 });
  }),
);
```

Now need to import HttpResponse.

Now for the confirm dialog test we need to verify that after clicking close, the bar disappears.

Potential issue: After clicking "Close session" button, the confirm dialog open. The ConfirmDialog's confirm button label is "Close session". The find by role may match both the button in the bar and confirm. However using within(dialog) we restrict.

Now ensure the button text "Close session" inside bar is not also considered as within dialog; they are separate.

Now test might need to consider that after confirming close, the mutation may be pending for a short time. Use waitFor to wait for bar removal.

Now after tests, we must ensure that after each test the server handlers are reset (setup does this). Also state.activeSessionId is reset in logout handler but not automatically. We should also clean up after each test maybe, but the server resetHandlers resets the state? Actually the state.activeSessionId is a variable in the mock DB, not automatically reset. In afterEach, we could set `state.activeSessionId = null`. To avoid interference between tests. The test setup doesn't reset state. Let's check other tests: SessionsListScreen.test.tsx sets state.user before rendering but does not set state.activeSessionId. They rely on server's default state (null). The server's handlers modify state.activeSessionId when GET /sessions/:id is called. The tests they run probably don't call GET /sessions/:id, only list sessions. So state.activeSessionId remains null. In our tests, we open a session, which sets activeSessionId. For subsequent tests, we might need to reset it. afterEach, we can set state.activeSessionId = null. But test framework's afterEach may not be set up; we can add a afterEach in our test file.

Add:

```tsx
import { afterEach } from 'vitest';
afterEach(() => {
  state.activeSessionId = null;
});
```

But we also need to reset state.user? Not necessary as we set user each test.

Now we need to import afterEach.

Now ensure that we reset timers after each test: use afterEach(() => vi.useRealTimers()); but we already call vi.useRealTimers in the test.

Now ensure that the test file imports correct path for server: '../../mocks/server' relative to test file location src/features/sessions. Path is '../../mocks/server'? The test file path is src/features/sessions/ActiveSessionBar.test.tsx. So relative to that, the server path is '../../mocks/server' (go up two levels to src, then mocks). Let's confirm: file path: src/features/sessions/ActiveSessionBar.test.tsx -> goes up to src/features/sessions -> ../.. = src. Then mocks is src/mocks. So path '../../mocks/server' is correct.

Now import HttpResponse: from 'msw'.

Now check that jest environment includes msw; it's used elsewhere.

Now ensure the test for error state expects to find 'Error loading active session' text. The component's error UI should have that text.

Now implement ActiveSessionBar with that text.

Potential modifications to code:

- In error case, we will render <div> with <p>Error loading active session</p>. Good.

Now need to import Button and Badge.

Now we need to import necessary React hooks.

Now ensure to export component.

Now check for missing modules: In ActiveSessionBar we import useCloseSession from './queries' but the file is in same folder (sessions) so import path is './queries' from that file.

Now file location: src/features/sessions/ActiveSessionBar.tsx. So path to queries file is './queries'.

Now we need to import `sessionKeys` maybe to invalidate queries.

Now we need to import useCloseSession: it's exported from './queries'.

Now check `useCloseSession` implementation: useMutation with mutationFn id => api.closeSession(id). It updates detail and lists but not active. So we will call mutate with id and pass options for onSuccess to invalidate active. Should be fine.

Now compile errors may arise: In TypeScript we need to type the onSuccess options. The mutate signature: mutate(variables, options?). Option type may be MutateOptions. We can pass an object with onSuccess. The onSuccess type expects a function that receives the result. That is fine.

Now within the component we also need to check for isPending property of the close mutation: in react-query v5, the mutation object returned by useMutation contains `isPending` property (like isLoading?). In the order code they used `approve.isPending` and `reject.isPending` for mutate status. Indeed they use `approve.isPending`. In the queries for orders, they defined `useMutation` and they use `isPending` property. So we can use `closeMutation.isPending`.

Now ensure to import the confirm dialog. Use ConfirmDialog.

Now note that the ConfirmDialog component takes props: open, title, body, confirmLabel, onConfirm, onCancel.

Now need to define onCancel setConfirmOpen(false).

Now handle Resume button navigation.

Now finalize.

Now potential import cycles: ActiveSessionBar imports useCloseSession from './queries'; queries.ts imports api and sessionKeys etc. No cycle.

Now modify SessionDetailScreen to import useQueryClient and sessionKeys.

Add import statements at top:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { sessionKeys } from './queries';
```

Add effect after main.

Now we need to ensure that we place effect after data loading; maybe after isLoading check. Use:

```tsx
if (!isLoading && session) {
  // effect runs to invalidate active
}
```

But we need to place hook calls before any early returns (can't conditionally call hooks). Use `useEffect(() => {...}, [session])`.

Make sure we define queryClient earlier:

```tsx
const queryClient = useQueryClient();
```

Add effect:

```tsx
useEffect(() => {
  if (session) {
    queryClient.invalidateQueries(sessionKeys.active());
  }
}, [session, queryClient]);
```

Now add imports at top.

Now adjust AppLayout import.

Now write tests.

Now we need to check that all code compiles with strict TS.

Potential TypeScript errors:

- In ActiveSessionBar, the type for query: useQuery<Session | null>.

Add generic: `useQuery<Session | null>({ queryKey: ..., queryFn: api.getActiveSession, staleTime: 0 })`.

- For useCloseSession, type of mutate: (id: string) => void.

So closeMutation.mutate(active.id, { onSuccess: () => { ... } }) works.

- The error handling: `error` type unknown. Not needed.

- useLocation returns a location object with pathname.

- queryClient.refetchQueries method signature: In v5, queryClient.refetchQueries(options). Actually I think it's `queryClient.invalidateQueries`. We'll use invalidate.

Now need to adjust import paths for the component. In AppLayout import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar'; but path from src/app/AppLayout.tsx to src/features/sessions is '../../features/sessions'? Let's double-check: AppLayout is in src/app/AppLayout.tsx, which is at folder src/app. The sessions folder is src/features/sessions. So from src/app to src/features/sessions: go up one level to src (`..`), then into features/sessions. So path is `../features/sessions/ActiveSessionBar`. Yes.

Now open AppLayout code and add import.

Now we need to add some CSS maybe but not required.

Now we need to add test for error case: We used HttpResponse.json but need to import HttpResponse from 'msw'.

Make sure to include that import.

Now I think we have all changes.

Now we need to think about any other code that may refer to sessionKeys active query. Maybe there are other components that might need to import sessionKeys, but they exist.

Now ensure that after modifying SessionDetailScreen, we import `sessionKeys` from './queries'.

Potential naming conflict: In SessionDetailScreen file, they already import useCloseSession, useSession, useUpdateSessionNotes from './queries'. We'll just add import of sessionKeys.

Now we need to think about any uses of useCloseSession in other screens, e.g., the bar and detail.

The SessionDetailScreen already uses useCloseSession mutation to close session, with same confirm dialog already built. It also updates caches and maybe active session not cleared.

Now adding invalidation for active session query after loading detail may cause a race: For the initial navigation to detail, active session query may be refetched and get the session; but the bar's own fetch might have been triggered earlier; but with invalidation, the active query will refetch again. But that's okay.

Now test for persist after refresh: after we close the app and re-render, the bar's useQuery will call getActiveSession with staleTime 0, fetch the server. Good.

Now test for error: The component shows error bar. Ensure that it returns non-null UI element and that we render error UI distinct from hidden.

Now confirm that the code builds.

Potential import cycles:

- ActiveSessionBar imports useCloseSession from './queries'. queries.ts imports api and uses types.

- SessionDetailScreen imports sessionKeys from './queries'.

All good.

Now test files need to import `server` and `http`. The test file may need to import HttpResponse from 'msw'.

Now confirm that the test file imports afterEach from vitest.

Now ensure we import `act` correctly: `import { act, screen, waitFor, within } from '@testing-library/react';` Actually `act` is exported from '@testing-library/react'.

Now note that `screen` is imported from '@testing-library/react'.

Now all good.

Now final step: Provide all changed files content with proper path.

Let's enumerate changed files:

- src/app/AppLayout.tsx (modified to include ActiveSessionBar)

- src/features/sessions/ActiveSessionBar.tsx (new file)

- src/features/sessions/SessionDetailScreen.tsx (modified to invalidate active query)

- src/features/sessions/ActiveSessionBar.test.tsx (new test file)

Possibly we need to adjust any other imports for other components, but likely not.

Now let's re-open the existing AppLayout file for context and modify.

Current AppLayout:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';

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
        <Outlet />
      </main>
    </div>
  );
}
```

We need to import ActiveSessionBar and add it.

Add import:

```tsx
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
```

Now add component after header and before main:

```tsx
<header>...</header>
<ActiveSessionBar />
<main>...</main>
```

Now update file.

Now open SessionDetailScreen:

Current code:

```tsx
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

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

We need to add imports: useQueryClient, sessionKeys.

Add after imports:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { sessionKeys } from './queries';
```

Add const queryClient = useQueryClient();

Add useEffect after the existing useEffect (maybe after that) that invalidates active session query when session is present.

Let's place after existing useEffect that sets notes.

Implementation:

```tsx
  useEffect(() => {
    if (session) {
      queryClient.invalidateQueries(sessionKeys.active());
    }
  }, [session, queryClient]);
```

Now adjust component.

Now add ActiveSessionBar component.

File: src/features/sessions/ActiveSessionBar.tsx

Write content as described.

Now test file: src/features/sessions/ActiveSessionBar.test.tsx

Add test code.

Potential import paths for test file: Since test files are in src/features/sessions, we import { state } from '../../mocks/db', renderApp from '../../test/render'.

Now check relative paths:

- test file is src/features/sessions/ActiveSessionBar.test.tsx

- To import from mocks/db: '../../mocks/db' (go up two levels: src/features/sessions -> src/features -> src). Yes.

- To import renderApp from '../../test/render' (go up two levels to src, then test folder). Yes.

- To import server from '../../mocks/server'.

Now code accordingly.

Now add `afterEach` resetting state.activeSessionId.

Now we need to ensure that after each test, we also clear the queryClient? Not necessary; each renderApp creates a fresh query client.

Now write final diff.

Let's produce final answer with all modified files.

Now double-check imports: In ActiveSessionBar component we need to import `useCloseSession`. The path: import { useCloseSession } from './queries'; but the file is in same folder, so './queries' is correct.

Also need to import `sessionKeys` for invalidating.

Now consider that ActiveSessionBar's refetch on location change may cause infinite loop if location changes due to active query updating? But location doesn't change in that case. So safe.

Potential need to pass `exact: true` to invalidate queries: In v5, `invalidateQueries({ queryKey: sessionKeys.active() })` may not be valid. Let's check documentation: `queryClient.invalidateQueries({ queryKey: ['foo'] })` in v5 uses an object. Could also be `queryClient.invalidateQueries({ queryKey: sessionKeys.active() })`. However simpler is `queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true })`. To avoid invalidating other queries with prefix.

We'll use:

```tsx
queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
```

Now regarding refetch on location change: We'll use `queryClient.invalidateQueries` there.

Now check queryClient.refetchQueries vs invalidate. In v5, there is `queryClient.invalidateQueries` which marks queries as stale and triggers refetch if they are rendered. Since the bar component is mounted, after invalidation it will refetch.

Now we need to import `useLocation` for location change detection.

Now we need to ensure we have proper imports: `import { useLocation } from 'react-router-dom';`.

Now confirm that we imported everything.

Now test for error: In the error case we need to ensure that GET /api/sessions/active returns 500; `HttpResponse.json` expects a second param for status; we must import HttpResponse.

Now final checks.

Potential error: In the close handler, we use closeMutation.mutate(active.id, { onSuccess: ... }). However `closeMutation` may already have onSuccess defined (which updates caches). We can still pass options that override onSuccess, but we need to preserve existing success behavior. But we can pass options with onSuccess that calls the original onSuccess and then invalidates. But we can't easily get the original onSuccess. But it's okay if we just invalidate; the mutation's onSuccess (inside useCloseSession) will still run because it's defined inside the mutation config, and passing options to mutate merges on top? In react-query v5, the mutate options are merged, and onSuccess from mutate options is called after original onSuccess? Actually in v5, mutate options are called on top and will get the same effect. According to docs, `mutate(variables, { onSuccess })` will be called after the mutation function resolves, and they are combined with the default options defined in the mutation. It triggers both? I'm not certain. But to be safe, we can manually call queryClient.invalidate after mutation resolves using `closeMutation.isSuccess` effect. Simpler: Use an effect:

```tsx
useEffect(() => {
  if (closeMutation.isSuccess) {
    queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
  }
}, [closeMutation.isSuccess, queryClient]);
```

But that requires checking isSuccess. Or use onSuccess of the mutate call.

I think the mutate options onSuccess runs after the default onSuccess but before the mutation settles; so fine.

We'll implement as:

```tsx
closeMutation.mutate(active.id, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
  },
});
```

Now there might be a TypeScript error: mutate expects second argument of type MutateOptions<Session, unknown, string, unknown> or similar; onSuccess expects a function with (data: Session) => void. Our function doesn't accept data param but can ignore; we can write `onSuccess: () => { ... }` which matches type but will get data argument ignored. That's fine.

Now ensure to disable the close button while closeMutation.isPending.

Now check that the ConfirmDialog component uses `confirmLabel` default 'Confirm', we pass 'Close session'.

Now implement.

Now test for confirm close: After clicking close button, the confirm dialog appears and we click confirm. Then the bar disappears. After confirming, the session detail page is still displayed maybe; but we test only bar.

Now there may be a race: The close mutation may be pending and bar may not disappear instantly; we need to wait.

Now test for error handling: Our component returns error UI inside a div with testid. Ensure the error UI appears: findByText('Error loading active session').

Now implement test file accordingly.

Now we need to import `vi` for fake timers; need to import from 'vitest'.

Now we need to import `act` from '@testing-library/react'.

Now we need to import `afterEach` from 'vitest' for resetting activeSessionId.

Now path imports for test file: check relative paths.

Now let's write final content.

Now ensure that any file not changed should not be repeated, as per instructions.

Now list all files we need to output:

- src/app/AppLayout.tsx (modified)

- src/features/sessions/ActiveSessionBar.tsx (new)

- src/features/sessions/SessionDetailScreen.tsx (modified)

- src/features/sessions/ActiveSessionBar.test.tsx (new)

That's all modifications needed.

Now final answer: Provide the content of these files.

Let's craft each file with correct code.

### src/app/AppLayout.tsx

Add import and component.

### src/features/sessions/ActiveSessionBar.tsx

Write component.

### src/features/sessions/SessionDetailScreen.tsx

Add imports and useEffect.

### src/features/sessions/ActiveSessionBar.test.tsx

Write test.

Now ensure that the imports for ActiveSessionBar are correct: In AppLayout, import path is `../features/sessions/ActiveSessionBar`. Because relative from src/app to src/features/sessions.

Now produce final answer.
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

### src/features/sessions/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { sessionKeys } from './queries';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession } from './queries';

export function ActiveSessionBar() {
  const { data: active, isLoading, isError } = useQuery<api.AuthUser | null>({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
    staleTime: 0,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const closeSession = useCloseSession();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update the “now” timestamp every second to make the elapsed time tick.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  // Refetch the active session whenever the route changes (e.g. after opening another session).
  const location = useLocation();
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
  }, [location.pathname, queryClient]);

  if (isLoading) return <p>Loading active session…</p>;

  if (isError) {
    return (
      <div className="active-session-bar error" data-testid="active-session-bar">
        <p>Error loading active session</p>
      </div>
    );
  }

  if (!active) return null;

  const elapsed = (() => {
    const start = new Date(active.startedAt).getTime();
    const diff = Math.floor((now - start) / 1_000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  })();

  const handleResume = () => {
    navigate(`/sessions/${active.id}`);
  };

  const handleClose = () => {
    setConfirmOpen(true);
  };

  const handleConfirmClose = () => {
    setConfirmOpen(false);
    closeSession.mutate(active.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
      },
    });
  };

  const handleCancelClose = () => {
    setConfirmOpen(false);
  };

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <span>{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="elapsed-time">{elapsed}</span>
      <Button variant="primary" onClick={handleResume}>
        Resume
      </Button>
      <Button variant="danger" onClick={handleClose} disabled={closeSession.isPending}>
        Close session
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />
    </div>
  );
}
```

### src/features/sessions/SessionDetailScreen.tsx
```tsx
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession, useSession, useUpdateSessionNotes } from './queries';
import { useQueryClient } from '@tanstack/react-query';
import { sessionKeys } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Invalidate the active‑session query when a session is loaded.
  // This forces the bar to refetch the current active session.
  useEffect(() => {
    if (session) {
      queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
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

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server } from '../../mocks/server';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure an authenticated user for every test.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  });

  afterEach(() => {
    // Reset active session between tests to avoid cross‑test contamination.
    state.activeSessionId = null;
  });

  it('appears after opening a session and can be closed', async () => {
    renderApp('/sessions');

    // Load the list and open a session.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    // Wait for the detail screen.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // The bar should now be visible.
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    // Close the session via the bar.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    // The bar disappears after the close succeeds.
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('persists after a full page refresh', async () => {
    const { unmount } = renderApp('/sessions');

    // Open a session.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Verify the bar is present.
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    // Simulate a page reload by unmounting and mounting a fresh app.
    unmount();
    renderApp('/orders');

    // The bar should reappear based on server state.
    const barAfterRefresh = await screen.findByTestId('active-session-bar');
    expect(within(barAfterRefresh).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('shows an error state when fetching active session fails', async () => {
    server.use(
      http.get('/api/sessions/active', () => {
        return HttpResponse.json({ code: 'unknown' }, { status: 500 });
      }),
    );

    renderApp('/orders');

    const errorMsg = await screen.findByText('Error loading active session');
    expect(errorMsg).toBeInTheDocument();
  });

  it('updates elapsed time every second', async () => {
    vi.useFakeTimers();

    renderApp('/sessions');

    // Open a session.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    const elapsed = await screen.findByTestId('elapsed-time');
    const first = elapsed.textContent;

    // Advance virtual timers.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    await waitFor(() => {
      expect(elapsed.textContent).not.toBe(first);
    });

    vi.useRealTimers();
  });
});
```
