# solution

## reasoning

```
Let me understand the task. I've been given a React + TypeScript back-office app (ops-backoffice) using react-query and react-router. The task is to build the active session bar (Variant A):

1. The bar should be displayed on all authenticated screens.
2. Opening a session from the list makes it active, and the bar shows name, status, and a counting-up elapsed time.
3. The bar offers "Resume" (navigate to detail) and "Close session" (call the close endpoint, confirm; on success the bar empties).
4. Only one active session at a time; opening another one replaces it (if there are unsaved notes on the current session, confirm — using the detail screen's dirty flag).
5. The active session persists after a full page refresh via `GET /sessions/active` as the single source of truth.

Must not regress: list filtering/pagination; detail editing + dirty flag warning; logout clears all state; deep links.

Key constraints from the ladder spec:
- The bar belongs in the layout that already wraps authenticated screens (AppLayout).
- Server state goes through react-query.
- Reuse the existing ConfirmDialog.
- Handle the pending and error states of the active-session query. A fetch failure must not be rendered as "no active session."
- Don't mirror to localStorage or a client store that outlives the query cache.
- Don't rewrite shared types/API modules.
- A consistent diff + tests in the repo's style.

Now, interesting mechanics to think through:

**How does opening a session make it active?** Looking at the MSW mock handler: `GET /api/sessions/:id` sets `state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;`. So on the server side, fetching a session detail makes it active (unless closed). The client's source of truth is `GET /sessions/active`. So when the user opens a session (navigates to detail), the detail screen's `useSession(id)` fires, the mock sets active, and then the active-session query needs to be refetched to reflect the new active session.

So the flow: detail screen fetches session → server marks active → active bar queries need to refetch. How to synchronize? Options:
- When the detail screen loads a session (not closed), invalidate/refetch the active query. But the detail screen should probably be minimal. Hmm.
- Alternatively, the active query uses `refetchOnMount`, or we invalidate the active query key when session detail data changes.

Actually, a cleaner approach: in `useSession`, or in a small hook in queries.ts, when session data arrives and is not closed, set/refetch the active query. But wait — the spec says "shared types and API modules are used, not rewritten." sessions/queries.ts can be modified (part of the diff).

Hmm, but there's a subtlety: the dirty-flag confirmation on replacement. "Opening another session while the current session has unsaved notes → confirm before replacing." The detail screen already tracks the dirty flag with `useBlocker`. If the operator is on the detail screen with dirty notes and clicks "next" in the list… no wait, they're on the detail screen; to open another session they navigate away (router blocker fires, "unsaved notes?" confirm, "leave"). Then on the list, clicking another session opens it — no second confirmation needed because they already confirmed leaving.

But the requirement says: "Only one active session at a time; opening another replaces it (if the current one has unsaved notes, confirm — the detail screen already tracks the dirty flag)." So the confirm-before-replacing happens through the existing route-change dirty flag blocker. In other words, we don't add new logic for this; the existing `useBlocker` already handles navigation away with dirty notes. Good — so "use it, don't add a second source of truth for the same fact" means: don't add a global dirty store; the blocker handles it.

Wait, but there's a subtle case: what if the operator is on the detail screen and the blocker fires? The blocker only fires when navigating away. Replacement happens when they navigate to another session's detail. So the existing behavior covers it.

So the real new work:
1. `useActiveSession` hook in `features/sessions/queries.ts` (or a separate file?). Convention: "one factory per feature," query keys are kept alongside queries. The active session belongs to the sessions feature. `sessionKeys.active` already exists: `active: () => ['sessions', 'active']`. So add:

```ts
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}
```

`api.getActiveSession()` returns `Promise<Session | null>`. A null data value is a valid value (no active session). Pending/error states are handled by the bar.

2. The `ActiveSessionBar` component. Where? The bar belongs in the layout. Feature components live in `src/features/sessions/`. Create `src/features/sessions/ActiveSessionBar.tsx` and import into AppLayout. AppLayout is in `src/app/`. That's fine — the layout uses feature components; the router already imports feature screens.

Bar behavior:
- Use `useActiveSession()`.
- `isPending`: show loading state (not "no active session"). Something like "Checking active session…" — a distinguishable state.
- `isError`: show an error state, e.g. "Could not load active session." with a retry button? The spec: "Handle the active-session query's pending and error. A fetch failure must not be rendered as 'no active session' — those are different states." So distinguishable rendering is needed. A retry button would be a nice touch; the app style is simple. Keep it simple: display a message. Retry button? The list screen just displays "Failed to load sessions." with no retry. Match the app style: display "Could not load the active session." No retry button — keep consistency. Hmm, but a retry would really be useful. The app style has no retry anywhere. Match the existing style: just a message.
- `isSuccess` and `data === null`: no bar (hide entirely? "The bar appears on every authenticated screen and nowhere else" — meaning on authenticated screens the bar region exists, but if no active session the bar itself should not display content. I think hide the bar entirely when there is no active session. Acceptance: "the bar appears on every authenticated screen and nowhere else" — my reading: on authenticated screens (as opposed to login). When no active session, the bar displays nothing (collapsed). That matches "on success the bar empties."
- Data: display name, status badge, counting-up elapsed time.
- Buttons: "Resume" → navigate to `/sessions/${id}`; "Close session" → ConfirmDialog → `closeSession` mutation → on success the bar empties.

**Counting-up elapsed time**: needs a ticking clock. A small `useElapsed` hook, or a `useNow(intervalMs)` hook that re-renders every second. Elapsed time from `session.startedAt` to now. Format? Something like "1h 23m 45s" or "01:23:45". Keep simple: hh:mm:ss format, or human format. Let's compute `Math.max(0, now - startedAt)` and format `d?h m s`. Simple: if less than 1 hour `Xm Ys`, else `Hh Mm Ss`. Even simpler: always `H:MM:SS`. Do a helper `formatElapsed(ms)`.

Ticking: `useEffect` with `setInterval` 1000ms, `useState(Date.now())`. Stop the tick on unmount. Also for closed sessions — the active session should not be closed (server clears active when closed, and GET detail doesn't make a closed session active). But could the server data temporarily be closed? Edge case; just display elapsed up to closedAt? Keep it simple: tick from startedAt to now; if closed, elapsed = closedAt - startedAt (no tick). Hmm, that's speculative. The mock only sets active for non-closed. But defensively: if `session.status === 'closed'` or `closedAt` exists, cap elapsed at closedAt. This is reasonable and cheap. Actually, let's not over-engineer, but capping is one line and clearly correct. Include it: `const end = session.closedAt ? new Date(session.closedAt).getTime() : now;` and elapsed = end - startedAt, and only tick when there's no closedAt.

**Close session from the bar**: use `useCloseSession()` from sessions/queries. On success: `qc.setQueryData(sessionKeys.active(), null)` — the bar empties. But wait: the close handler in the mock sets `state.activeSessionId = null` when the closed session was active. The `useCloseSession` mutation's onSuccess currently patches the detail + list. To empty the bar, either:
- The bar itself does `qc.setQueryData(sessionKeys.active(), null)` after the mutation succeeds. But the mutation is defined in queries.ts; we can add `qc.setQueryData(sessionKeys.active(), (old) => (old && old.id === updated.id ? null : old))` — hmm, but the returned `updated` is a closed session; active should be null. Actually simpler and more robust: in the bar, after close success, set the active query data to null. But the layering is… this is React, not the NestJS layering. The convention in this repo: mutation onSuccess writes into the cache. Add handling in `useCloseSession`'s onSuccess: if the closed session was the active one, clear the active cache. `updated` doesn't tell us directly whether it was active, but we can check the existing active cache:

```ts
onSuccess: (updated) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  qc.setQueryData(sessionKeys.active(), (old) => (old && old.id === updated.id ? null : old));
}
```

Wait — is `old` a `Session | null`? `setQueryData` with an updater: `qc.setQueryData<Session | null>(sessionKeys.active(), (old) => ...)`. TS: setQueryData infers the type from the key… actually `setQueryData(dataKey, updater)` — the updater type is `(old: T | undefined) => T | undefined`. The T here is inferred from context… with no annotation it might be inferred as unknown. The existing code does `qc.setQueryData(sessionKeys.detail(id), updated)` and `qc.setQueriesData<Page<Session>>(...)`. For the active one, annotate: `qc.setQueryData<Session | null>(sessionKeys.active(), (old) => (old && old.id === updated.id ? null : old))`. That works.

Hmm, but should the active-clearing logic be in `useCloseSession` (shared) or in the bar? The detail screen also uses `useCloseSession` for closing. If you close from the detail screen and it was active, the bar should also empty. So putting it in the mutation's onSuccess is correct and DRY.

But wait — there's a subtlety: the close endpoint in the mock clears `state.activeSessionId` server-side. The returned session is the closed one. Client-side, setting active cache to null matches the server. But what if the active session was a *different* session? In that case, keep it. The `old.id === updated.id` check handles that. But edge: the active cache is stale (old null) but the server had an active one… we can't do more without a refetch. Fine.

Also, after closing from the detail screen, the detail screen shows the closed status; fine.

**When does the active query refetch to pick up a newly active session?** Scenario: user on list, clicks session A → navigates to detail → `useSession(A)` fires → mock sets active to A → bar needs to show A. The bar's `useActiveSession` query: if it was previously fetched (staleTime 30s), it won't refetch on mount… actually the bar stays mounted (in AppLayout, always mounted on authenticated screens). So the active query was fetched once on login/navigation; with staleTime 30s and no refetch triggers, it will show stale null for up to 30s… actually, once fetched, a query doesn't refetch while the component stays mounted unless invalidated or refetched. So the bar stays stale. Need synchronization.

Options:
1. In `useSession`'s queryFn, after fetching, trigger a refetch of the active query. The queryFn is async; we can access the queryClient there. But mixing hooks in a queryFn is iffy; can be passed via closure. Example:

```ts
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async () => {
      const s = await api.getSession(id);
      // Opening a session makes it active on the server; the bar's source of
      // truth is GET /sessions/active, so refetch it once the row is in hand.
      if (s.status !== 'closed') void qc.refetchQueries({ queryKey: sessionKeys.active() });
      return s;
    },
  });
}
```

Hmm, but `refetchQueries` returns a promise; `void` is fine. But is this clean? It's a side effect in a queryFn. Alternative: a `useEffect` in the detail screen that refetches active when the session loads. But the spec says the bar should appear everywhere; the detail screen is where "opening" happens. But "opening" only happens through the detail screen.

2. Use `refetchOnMount: 'always'` for the active query. That way, every time the bar mounts (i.e. every navigation? no — the bar stays mounted across routes in AppLayout). AppLayout stays mounted across child route changes (Outlet swap). So refetchOnMount only helps on first mount.

Hmm, wait — does AppLayout remount on route change? No, the same element stays; only the Outlet's children swap. So the active query mounts once and stays.

3. In the detail screen, `useEffect` on `session`: if session loaded and not closed, `qc.refetchQueries({ queryKey: sessionKeys.active() })` or `qc.invalidateQueries`. This is explicit and testable. But it adds a cross-cutting concern to the detail screen.

4. Do it in `useSession` as in option 1. I think option 1 is actually the most coherent: "opening a session makes it active" is a property of the GET detail endpoint itself (the mock does exactly this: the server marks active on detail fetch). So the client hook `useSession` knows that this fetch has the side effect of setting active, and keeps the active query in sync. Encapsulated in queries.ts where the keys live.

But a subtlety: with staleTime 30s, if you open the same session twice, or open a different session within 30s… `refetchQueries` always refetches (refetches regardless of staleness). Good.

Also: deep link directly to detail URL — page load → detail fetch → sets active → refetch active → bar appears. Good. But note: on fresh page load, the active query also fires on mount (bar). Order: both fire nearly simultaneously. The detail fetch sets active server-side, then refetches active. The initial active fetch might race: the initial active fetch could happen *before* the detail fetch completes and return null, and then the refetch picks up the session. Fine. But with staleTime 30s and both in flight, does refetchQueries dedupe? refetchQueries forces a refetch. OK.

Another race: the bar's initial `useActiveSession` fires, returns null (no active). User clicks session A: detail fetch, server sets active, `refetchQueries(active)` → bar shows A.

User navigates to a different session B: detail B fetch, server sets active to B, refetch active → bar shows B. But the dirty flag: if the user was dirty on A's detail, the blocker fires first; on "leave," navigate; then opening B replaces. Matches spec: confirm before replacing (via the existing blocker).

Wait, actually a subtlety: the blocker fires when navigating away from the detail screen. If the user is on A's detail and clicks a link in the bar… the bar is in AppLayout, outside the detail screen. Does `useBlocker` block *all* navigations, including programmatic ones via useNavigate? Yes — `useBlocker` (from react-router v6.19+/6.26) blocks any navigation while the blocker is active (state 'blocked'). Clicking "Resume" on the same session → navigation to the same URL → does the blocker fire on same-location navigation? In the data router, `useBlocker(shouldBlock)` — a navigation to the current location… a click on the same path produces a new navigation attempt; React Router should fire the blocker with the same location. Hmm, actually with `useBlocker`, navigating to the same path — the blocker's shouldBlock is `dirty` (boolean). If true, it blocks. The user would see "unsaved notes, leave?" with "leave" as confirm — clicking proceed navigates (to the same place). Slightly weird UX but acceptable; and only if dirty.

Now, **where should the bar component live** — a new file `src/features/sessions/ActiveSessionBar.tsx`. AppLayout imports it.

**Resume**: `useNavigate` — the bar is inside AppLayout, which is inside the router context (AppLayout is rendered as a route element), so `useNavigate` works.

**Close from the bar**: `useCloseSession()` mutation + `ConfirmDialog` (reuse). Confirm body: "Closing is final." etc. On success: the mutation's onSuccess patches the cache including active (as above). "On success the bar empties" ✓.

Also, close from the bar when the detail screen for the same session is also open — the cache patching handles the status update.

**Logout clears everything**: `logout` does `queryClient.clear()` — clears the active query cache. The bar's local confirm state is inside the bar; on logout the user → RequireAuth redirects to /login, AppLayout unmounts, the bar unmounts. The elapsed timer also cleans up. ✓. But wait — after logout, the active query is cleared; on re-login, the bar refetches. ✓.

**Deep link**: direct to `/sessions/:id` — RequireAuth waits for me(); then the detail fetch; the mock sets active; refetch active; bar shows. ✓.

**Pending state of the active query**: on first authenticated screen load, `useActiveSession` is pending → the bar shows a pending indicator. Must not display as "no active session." Render a small bar with "Checking active session…". On error: "Could not load the active session."

Hmm, "the bar appears on every authenticated screen and nowhere else" — on login screen, AppLayout isn't rendered, so the bar doesn't appear. ✓.

Now — one more thought: should `useActiveSession` be in `features/sessions/queries.ts`? The bar is a sessions-feature thing; the key `sessionKeys.active` is already there. Yes.

Also `enabled` consideration: the active query should only run when authenticated. The bar is only rendered inside AppLayout (which is under RequireAuth, after user is set), so the query only mounts when authenticated. On logout, the component unmounts. Good. But there's a window: user logged in, on screen, clicks log out → `api.logout()` → setUser(null) → RequireAuth navigates to /login → AppLayout unmounts. During that, the active query might refetch on unmount? Queries don't refetch on unmount by default. Fine.

**Elapsed tick**: implement inside the bar:

```tsx
function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
```

Format:

```ts
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}h ${mm}m ${ss}s` : `${m}m ${ss}s`;
}
```

Or a fixed `H:MM:SS`. Go with the human form.

**Testing** — repo style: `SessionsListScreen.test.tsx` uses `renderApp`, MSW server, `state` from mocks/db, `waitFor`, `userEvent`, screen queries. Test files are colocated: `src/features/sessions/SessionsListScreen.test.tsx`. So I'll create `src/features/sessions/ActiveSessionBar.test.tsx` (or `ActiveSessionBar.test.tsx` next to the component).

Tests to write:
1. Bar shows the active session after opening it from the list: renderApp at `/sessions`, click a session link, wait for the bar to show the name/status; verify elapsed time display present; verify resume/close buttons.

Wait — but how do we *set* an active session in tests? The mock's GET detail sets `state.activeSessionId`. So:
- Test A: "opening a session from the list makes it active and shows it in the bar": renderApp('/sessions'), wait for 'Inspection 1', click the link 'Inspection 1' (it's a Link inside a td; `userEvent.click(screen.getByText('Inspection 1'))`? there's a Link wrapping the text. getByRole('link', { name: 'Inspection 1' })). After navigation, the bar should show 'Inspection 1' with status 'open' and a Resume link/button. Assert the bar region contains the name. But note: 'Inspection 1' appears in both the list and the bar → multiple elements. Use a query scoped to the bar. Give the bar a role/label: `role="status"`? or an `aria-label`? Hmm. Let's structure the bar:

```tsx
<div className="active-bar" role="region" aria-label="Active session">
```

Hmm, a `role="status"` region announces changes politely. Actually, `role="region"` with aria-label makes it queryable via `getByRole('region', { name: 'Active session' })`. Or simpler: `data-testid`? The repo style doesn't use data-testid anywhere; it uses roles/labels/text. Use aria-label on the bar container.

But note — when pending, the bar renders with a different message; when no active, renders null.

Test A flow:
```tsx
it('shows the active session in the bar after opening one from the list', async () => {
  state.user = {...};
  state.activeSessionId = null;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await waitFor(() => {
    expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent('Inspection 1');
  });
});
```

Hmm wait, `userEvent.click` on a Link does a client-side navigation. Then the detail screen loads, mock sets active, refetch active, bar updates.

Also need to reset `state.activeSessionId` in tests, since the module state persists across tests in the same file (and files run in separate workers, but within a file they share). The existing test sets `state.user` in each test. Reset `state.activeSessionId = null` at the start of each test. Note: `sessions` array items are mutated by the close/patch handlers across tests — e.g. a close test will permanently mark a session as closed in the module state. Existing tests don't mutate, but mine will. Must be careful with ordering/selection: pick a different session for the close test, or account for the mutation. Since `sessions` is a module-level array, mutations persist across tests in the same file. E.g. if one test closes s-001, a later test that asserts its status 'open' would fail. Design tests to be independent: the close test uses a session that other tests don't rely on. Or better: reset in the test? The db module only exports `sessions`, `orders`, `state`, `PAGE_SIZE`. We could mutate `sessions[i].status = 'open'` in test setup to restore… that's invasive but fine in tests. Hmm, cleaner: choose test fixtures that don't collide:

- Test 1 (open from list → bar shows, elapsed ticks, resume navigates): use Inspection 1 (s-001, status open). No close here.
- Test 2 (elapsed time ticks): could be merged into test 1: assert the elapsed text changes over time using fake timers? The repo has no fake timer usage; vitest supports `vi.useFakeTimers`. But mixing fake timers with userEvent/waitFor (real async) is tricky — MSW + fetch with fake timers can deadlock if timers are mocked while waiting for network… Actually MSW node uses real sockets/fetch; `vi.useFakeTimers` would break `waitFor`'s polling and MSW internals. Safer: use real timers with a short wait: assert initial elapsed text, `await new Promise(r => setTimeout(r, 1100))`, then assert it changed. That's a real 1.1s test; acceptable. Or use `vi.advanceTimersByTime` with fake timers only around the tick… risk. Let's do real-time 1100ms wait. Hmm, but flake-prone? Elapsed from startedAt (April 2024) to now (2025+) is huge — the seconds digit changes every second; a 1100ms wait guarantees at least one second boundary. Actually elapsed ~1.5 years, seconds always tick 0-59, 1100ms guarantees the visible seconds value changes (or minutes if crossing). Yes.

Alternatively, `container` assertion: `toHaveTextContent(/m \d+s/)` and then change. Compare two captured strings:

```ts
const bar = await screen.findByRole('region', { name: 'Active session' });
const first = bar.textContent;
await new Promise((r) => setTimeout(r, 1100));
expect(bar.textContent).not.toBe(first);
```

Careful: re-render updates the same DOM node; `bar` reference stays valid.

- Test 3 (resume navigates to detail): set state.activeSessionId = 's-002'; renderApp('/sessions'); wait for bar with 'Inspection 2'; click 'Resume'; wait for the detail heading h1 'Inspection 2'. Detail screen h1 is the name. Assert `screen.getByRole('heading', { name: 'Inspection 2' })`. Note: the list also has the link text 'Inspection 2', but the heading role is unique. ✓.

- Test 4 (close from bar calls endpoint and empties the bar): set active to s-003 (status? i=2 → status index 2 → 'closed'! Wait: status: (['open','paused','closed'])[i%3] → i=0 open, 1 paused, 2 closed, 3 open… so s-001 open, s-002 paused, s-003 closed. A closed session shouldn't be active per the mock (GET detail on closed doesn't set active). If I manually set state.activeSessionId = 's-003', the bar shows a closed session; closing it: the mock's close handler works on any session (sets to closed, sets closedAt). The "Close session" button on the detail is disabled when closed, but the bar's close button — should it be disabled for a closed active session? The server wouldn't have a closed active session; edge case. For test simplicity, use an open session: s-001 (i=0 open), s-004 (i=3 open). Use s-004 for the close test to avoid collision with test 1's s-001 (test 1 doesn't close, so s-001 is still open afterward). Close test: state.activeSessionId='s-004'; renderApp('/sessions'); wait for bar with 'Inspection 4'; click 'Close session' button; confirm dialog appears (role dialog, title "Close this session?"); click confirm button 'Close session' — wait, there are two 'Close session' buttons (bar + confirm dialog's confirmLabel 'Close session'). Scope: after clicking the bar's, get the dialog, `screen.getByRole('dialog')`, then `within(dialog).getByRole('button', { name: 'Close session' })`. Need `within` from testing-library. Then assert the bar is gone: `await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());` and assert the endpoint was called: the session s-004 status became 'closed' in the mock db: `expect(sessions.find(s => s.id === 's-004')!.status).toBe('closed')` — that verifies the endpoint was called (behavior). Also `state.activeSessionId` becomes null via the handler. Good behavioral assertion.

Wait — but the mutation's onSuccess sets the active cache to null only if the old active id === updated id. Old active = s-004, updated id s-004 → null. ✓ bar empties.

Also, after closing, `patchLists` updates the cached list if it includes s-004 (page 2 of the list has s-011..s-020; page 1 is s-001..s-010, which includes s-004 — the list was fetched on '/sessions' page 1, so the list cache gets patched; but we assert on db status anyway).

- Test 5 (survives refresh): "full page refresh → bar returns from GET /sessions/active." Simulate refresh = fresh renderApp at some path with state.activeSessionId preset, assert the bar shows from the query. E.g. set active to s-001, renderApp('/orders'), wait for the bar to show 'Inspection 1'. Also verify it doesn't depend on the client: that's the whole point — a fresh query client fetches GET /sessions/active. renderApp creates a fresh QueryClient per call. ✓.

- Test 6 (failed fetch renders error, not "no active session"): use MSW to override the handler: in the test file, `server.use(http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })))`. Need to import `server` from '../../mocks/server' and `http, HttpResponse` from 'msw'. The setup file has `server.resetHandlers()` in afterEach, so the override is scoped to the test. Then renderApp('/sessions'), and expect an error message like "Could not load the active session." and *not* an absence of the bar. Assert the bar region is present with the error text.

- Test 7 (no active session → bar absent): state.activeSessionId=null; renderApp('/sessions'); wait for list to load; assert `queryByRole('region', {name:'Active session'})` is null. Need to ensure the active query has resolved (not pending): the bar region shows pending text while loading, so waiting for absence requires the fetch to have completed. `await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());` — MSW responds fast, works. But race: the pending bar renders initially, then disappears. waitFor polls until it's gone — fine.

Hmm wait, actually — should the bar render the pending state? "Handle the active-session query's pending and error." Yes.

- Test: the bar is not shown on the login screen ("nowhere else"): renderApp('/login') without user → login form; assert no 'Active session' region. But note: AuthProvider's me() fails → 401 → user null → RequireAuth redirects. Render at '/login'. Assert `screen.queryByRole('region', { name: 'Active session' })` is null and login form is visible. Hmm — AppLayout doesn't mount at all, so trivially true. Still a good guard.

Also, a test that opening a second session replaces the first? That's essentially the same as the open flow (server replaces). Could add: open s-001, then click s-004 from the list (need to navigate back to the list first) → bar shows s-004. And the dirty-flag confirm case: the spec acceptance says "opening a second session while the current session has unsaved notes → confirm before replacing." That's the *existing* blocker behavior (unsaved notes warning on route change) — existing behavior must not regress, is it tested? There's no existing test file for SessionDetailScreen in the reference listing (only SessionsListScreen.test.tsx). The acceptance says "the existing suite continues to pass, unmodified" and "tests for the new behavior in the repo's already-used style." The dirty-confirm-on-replace is the composition of existing behavior + new behavior. Should I test it? "Tests for the new behavior" — the new behavior is the bar. The confirm-on-replace uses the existing blocker; a test that covers it end-to-end (edit notes, go to list, open another, confirm dialog appears, after leave, bar shows the new session) would be a strong test of the combined behavior. Let's include it:

- Test: "replacing the active session asks first when notes are dirty": set active to s-001 (open). renderApp('/sessions/s-001')? Wait — deep-linking directly sets active via the detail fetch (mock). Simpler: renderApp('/sessions/s-001') → detail loads, mock sets active to s-001. Edit the notes textarea (aria-label? the textarea is inside a `<label>Notes <textarea>` — label wraps → `getByLabelText('Notes')`). Type something → dirty. Then navigate to the list: click the 'Sessions' nav link → blocker fires (dirty) → dialog "unsaved notes, leave?" appears. Assert the dialog with title 'Leave with unsaved notes?'. Click 'Leave' → navigate to the list. Click 'Inspection 4' → detail loads, active becomes s-004; the bar now shows Inspection 4. Assert the bar's text.

Hmm wait — one issue: when clicking the 'Sessions' nav link while the blocker is active… the nav link is in AppLayout's header, outside the detail screen. The useBlocker blocks any navigation. On click, navigation is blocked, dialog appears. Click 'Leave' → `blocker.proceed()` → navigate to '/sessions'. Then click 'Inspection 4'.

But careful: after proceed, the detail screen unmounts (the blocker's dialog lives in the detail screen). Then on the list, click 'Inspection 4' link. Detail 4 loads; mock: s-004 is open (i=3 → status open) → active = s-004. Refetch active. Bar: 'Inspection 4'. ✓.

Note though — the notes edit: `useEffect(() => { if (session) setNotes(session.notes); }, [session])` — the initial notes for s-001: i=0 → i%4===0 → 'Awaiting parts.'. Typing appends → dirty. Good.

One more consideration — **the `useSession` refetch side effect and StrictMode double invocation**: in dev StrictMode, effects run twice; the queryFn might be called twice? React Query doesn't double-call queryFn on mount (it dedupes). Fine.

Another consideration: **refetching active in `useSession`'s queryFn** — if the user opens a *closed* session, the mock does *not* change active. Guard with `s.status !== 'closed'` before the refetch. But actually, refetching is harmless even when closed (the active doesn't change, we just refetch and get the same value). But skipping avoids a pointless refetch. Keep the guard.

Alternatively, a cleaner architecture: the detail screen does the active sync in a `useEffect`. But queryFn keeps it with the hook. Hmm, let me think about which the "repo style" prefers. The repo style in queries.ts has comments explaining the cache writes in onSuccess. A side effect in queryFn is somewhat unusual but justifiable. Alternatively, define in queries.ts:

```ts
/**
 * Opening a session makes it the active one on the server. The bar reads
 * GET /sessions/active as its source of truth, so the detail fetch keeps the
 * active cache in step instead of trusting a client-side assumption.
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async () => {
      const session = await api.getSession(id);
      if (session.status !== 'closed') {
        void qc.refetchQueries({ queryKey: sessionKeys.active() });
      }
      return session;
    },
  });
}
```

Wait, `refetchQueries` with `queryKey: sessionKeys.active()` — active key is `['sessions', 'active']`. But `refetchQueries` matches by prefix… `['sessions','active']` is exact; the list key `['sessions','list',q]` doesn't match the prefix `['sessions','active']`. Good.

Hmm, another thought: `refetchQueries` when the active query is *not yet mounted/fetched* (e.g. on first load, deep link, the bar is also fetching). `refetchQueries` will fetch the query if it doesn't exist? Yes — `refetchQueries` triggers a fetch for matching queries, and if the query doesn't exist, it creates it? Let me recall: `refetchQueries` "refetches all queries that match the filter, and if there are none, does nothing"… actually I believe refetchQueries only acts on *existing* queries in the cache. If no query has been fetched, `refetchQueries` resolves with 0 results and does nothing. Hmm. In the deep-link-first-load case: the bar mounts and `useActiveSession` starts a fetch (creates the query). Nearly simultaneously, `useSession`'s queryFn completes and calls refetchQueries — by that time the query exists (created by the bar's mount, which happens on the same render pass, and fetch starts synchronously on mount before the detail fetch's network round-trip completes). So the query exists. Edge: if the bar's fetch has already resolved with null *before* the detail fetch completes (no active server-side initially). Then refetchQueries refetches → picks up the new active. ✓.

But the race: the detail fetch completes → refetchQueries fires → but the detail fetch's server-side effect (setting active) happens *inside* the mock handler *before* the response is sent, so the subsequent refetch sees the updated active. ✓ (the mock is synchronous: sets state then responds).

Also the `enabled` flag: not needed.

Now — another important consideration: **the bar's close mutation and the detail's close mutation both use `useCloseSession`**. If the bar is closed, onSuccess patches the detail cache (good if the detail is open), the list, and the active. If the detail screen is currently showing the closed session, its `useSession` data is updated → status closed → the detail's "Close session" button is disabled. Good.

**Now the AppLayout change**: import ActiveSessionBar and render it in `<main>` above `<Outlet />` (or below the header). "The bar belongs in the layout that already wraps authenticated screens" and "the bar shows on all screens… the bar belongs in the layout" — put it between the header and the Outlet, inside main? Let me put it as the first child of `<main>`:

```tsx
<main>
  <ActiveSessionBar />
  <Outlet />
</main>
```

**Bar component details**:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

export function ActiveSessionBar() {
  const { data: session, isPending, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  if (isPending) {
    return (
      <div className="active-bar active-bar--pending" role="status">
        Checking the active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="active-bar active-bar--error" role="status">
        Could not load the active session.
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="active-bar" role="region" aria-label="Active session">
      <span className="active-bar__name">{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-bar__elapsed">…elapsed…</span>
      <div className="active-bar__actions">
        <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
        <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
          Close session
        </Button>
      </div>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final."
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

Hmm wait, `role="status"` for pending/error and `role="region"` + aria-label for the active one — in tests I query `getByRole('region', { name: 'Active session' })` only for the active case; for pending/error, query by text. That's fine. But should the pending/error bars also have the aria-label so that they're queryable as the same region? For the error test I want to assert the region is present with the error text: `getByRole('region', { name: 'Active session' })` and `toHaveTextContent('Could not load')`. It's simpler and more consistent to use one wrapper role for all three states: `role="region" aria-label="Active session"` on the bar container for all states. And the "no active" state renders nothing. Do that.

Actually, `role="region"` with aria-label is queryable. OK.

**Elapsed**:

```tsx
function ElapsedSince({ startedAt, closedAt }: { startedAt: string; closedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  const running = closedAt === null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const end = closedAt ? new Date(closedAt).getTime() : now;
  return <span className="active-bar__elapsed">{formatElapsed(end - new Date(startedAt).getTime())}</span>;
}
```

Hmm, or keep the hook in the same file. Fine.

**Now the `useActiveSession` hook**:

```ts
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}
```

Type: data is `Session | null`. react-query handles null data fine (data: `Session | null`).

**Update `useCloseSession`'s onSuccess** to clear the active cache:

```ts
onSuccess: (updated: Session) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  // The server drops a session from the active slot when it is closed; mirror
  // that into the active cache so the bar empties without a round-trip.
  qc.setQueryData<Session | null>(sessionKeys.active(), (old) =>
    old && old.id === updated.id ? null : old,
  );
},
```

Wait, TS for the updater: `setQueryData<Session | null>(key, updater?: (old: Session | null | undefined) => Session | null | undefined)`. Returning `null` is fine.

Hmm — but there's a problem: the *close from the detail screen* test (no existing test) — fine.

But wait, one more important interaction: **closing from the bar while on the detail screen of the same session** → the detail screen's "Close session" button becomes disabled; the notes state stays; fine.

**Now "only one active session at a time"** — the server enforces this; the client mirrors. ✓.

**Confirm on replacement when dirty** — via the existing blocker. But wait, there's a subtle gap: the blocker only exists on the *detail screen*. The "current session with unsaved notes" can only exist while the user is on its detail screen (the notes edit only exists there). So the blocker covers all replacement paths. ✓ — the spec explicitly says "the detail screen already tracks the dirty flag; use it, don't add a second source of truth." So zero additional code.

Now — **AppLayout**:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
import { useAuth } from '../auth/auth-context';

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

**Now let me write the test file** `src/features/sessions/ActiveSessionBar.test.tsx`.

Repo style from SessionsListScreen.test.tsx: imports from vitest (describe/expect/it), `screen, waitFor` from testing-library, userEvent, `state` from mocks/db, `renderApp` from test/render.

My tests need `within` (from @testing-library/react), `server` (from mocks/server), `http, HttpResponse` (from msw), `sessions` (from mocks/db) for asserting close.

Let me draft each test carefully, thinking about exact DOM:

Bar active DOM:
```html
<div class="active-bar" role="region" aria-label="Active session">
  <span class="active-bar__name">Inspection 1</span>
  <span class="badge" data-tone="open">open</span>
  <span class="active-bar__elapsed">182h 04m 11s</span>
  <div class="active-bar__actions">
    <button ...>Resume</button>
    <button ...>Close session</button>
  </div>
</div>
```

Wait — the "Resume" button: should it be a Link or a Button+navigate? The bar lives in the layout; a `<Link to=...>` is more idiomatic for navigation and matches the app (the list uses Link). Use `<Link to={`/sessions/${session.id}`}>Resume</Link>`? But the app's Buttons are styled; the nav uses plain Links. Hmm. In tests, `getByRole('link', { name: 'Resume' })` vs button. Either works. Use a Link — no JS handler needed, cleaner. Actually wait: a link for "resume" in a status bar is fine.

Hmm, but one consideration: with the detail's blocker active (dirty) and the user clicking Resume… we discussed, the blocker will catch it. Either way, fine.

Let me settle: `resume` = Link. `close` = Button (opens confirm).

Elapsed format: for a 2024-04-01 session in 2025+, hours is ~13000+? Let me compute: startedAt for i=0: Date.UTC(2024, 3, 1, 8) = April 1, 2024 08:00. Now ≈ 2025-… (test runs whenever) ~ 2025-06 → ~ 395 days → ~9500h. formatElapsed with h>0 → `9500h 12m 33s`. Fine. My format: `${h}h ${mm}m ${ss}s`. The tick test compares textContent change — the seconds part changes. ✓.

Now, let me write the tests with real timing. One concern: `userEvent.click` on a link triggers navigation; react-query fetches; the waitFor with default timeout 1000ms should be plenty (MSW node responds nearly synchronously).

Test 1: **the bar shows key fields of the active session after opening from the list**

```tsx
it('shows the active session in the bar after opening it from the list', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = null;
  renderApp('/sessions');

  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  expect(within(bar).getByText('open')).toBeInTheDocument();
  expect(within(bar).getByRole('link', { name: 'Resume' })).toHaveAttribute(
    'href',
    '/sessions/s-001',
  );
});
```

Wait — `findByRole('region', ...)` — after clicking, initially the bar is pending (if not yet fetched) or null (if previously resolved as null). Actually on '/sessions' first load, the bar's active query already fired on mount! The bar is in AppLayout, mounted on '/sessions'. So on first load, the active query is already in flight and resolves null (state.activeSessionId is null) → bar absent. Then we click the link → detail fetch → server sets active → refetchQueries → bar appears. findByRole waits. ✓.

Hmm wait, but a subtlety: does clicking the row's link work? The list renders `<Link to={...}>{s.name}</Link>` inside a td. `getByRole('link', { name: 'Inspection 1' })` — but 'Inspection 1' appears once in the list (page 1: s-001..s-010). The bar might also have 'Inspection 1' as a span (not a link) → getByRole('link') is unique. ✓.

Also note: after navigating to detail, the list unmounts. Fine.

The elapsed span should also exist: `within(bar).getByText(/h .*m .*s/)`? Format `9500h 12m 33s` — regex `/^\d+h \d{2}m \d{2}s$/`. Or just check for the presence of the `.active-bar__elapsed` class… repo style avoids testids; use the text regex. Include: `expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument();`

Test 2: **elapsed time ticks**

```tsx
it('ticks the elapsed time in the bar', async () => {
  state.user = {...};
  state.activeSessionId = 's-001';
  renderApp('/sessions');

  const bar = await screen.findByRole('region', { name: 'Active session' });
  await waitFor(() => expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument());
  const first = bar.textContent;
  await new Promise((r) => setTimeout(r, 1100));
  expect(bar.textContent).not.toBe(first);
});
```

Note: `within(bar)` re-queries each time; the bar's ref is the same DOM node. ✓. 1100ms real wait — acceptable.

Test 3: **resume navigates to the detail**

```tsx
it('resumes the active session', async () => {
  state.user = {...};
  state.activeSessionId = 's-002';
  renderApp('/sessions');

  const bar = await screen.findByRole('region', { name: 'Active session' });
  await userEvent.click(within(bar).getByRole('link', { name: 'Resume' }));

  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Inspection 2' })).toBeInTheDocument(),
  );
});
```

The detail h1: `<h1>{session.name}</h1>` → heading level 1 with name 'Inspection 2'. ✓. (Also the list shows 'Inspection 2' as a link, but the heading role disambiguates.)

Test 4: **close from the bar: confirm → endpoint → bar empties**

```tsx
it('closes the active session from the bar behind a confirm', async () => {
  state.user = {...};
  state.activeSessionId = 's-004';
  renderApp('/sessions');

  const bar = await screen.findByRole('region', { name: 'Active session' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

  const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
  );
  expect(sessions.find((s) => s.id === 's-004')?.status).toBe('closed');
});
```

ConfirmDialog: `aria-label={title}` on the dialog div → accessible name 'Close this session?'. ✓. The confirm button label 'Close session' (confirmLabel) — inside the dialog. The bar's own 'Close session' button is outside the dialog. Scoped within(dialog) → unique. ✓.

Note: s-004 (i=3): status open (3%3=0 → 'open'), notes: 3%4!==0 → ''. Good, closeable.

Wait — one thing: after closing, does the list (page 1) still show 'Inspection 4' with a closed badge (patchLists)? Not asserted; fine.

Also `waitFor` on the bar's disappearance: the mutation success sets the active cache to null → bar returns null → region gone. ✓.

Test 5: **survives refresh** — simulate by a fresh renderApp (fresh QueryClient) with state.activeSessionId preset:

```tsx
it('restores the active session from the API on a fresh load', async () => {
  state.user = {...};
  state.activeSessionId = 's-001';
  renderApp('/orders');

  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
});
```

This proves the bar comes from GET /sessions/active (a fresh query client with an empty cache fetches; the server state has activeSessionId). ✓. Render on '/orders' to show the bar on all authenticated screens (not just sessions screens).

Test 6: **a failed fetch is not "no active session"**:

```tsx
it('shows an error, not an empty bar, when the active session cannot be loaded', async () => {
  state.user = {...};
  state.activeSessionId = 's-001';
  server.use(
    http.get('/api/sessions/active', () =>
      HttpResponse.json({ code: 'boom' }, { status: 500 }),
    ),
  );
  renderApp('/sessions');

  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Could not load the active session.')).toBeInTheDocument();
  expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
});
```

Hmm — the region is present with error text. And the session name is *not* displayed. Also assert the session isn't shown. Good. Note: the pending state also renders the region — findByRole could match the pending state before the error resolves… `findByRole` resolves as soon as the region exists (even during pending!). Then `within(bar).getByText('Could not load...')` would fail because it's still pending. Fix: `await waitFor(() => expect(within(bar).getByText('Could not load the active session.')).toBeInTheDocument());` or find with text: `await screen.findByText('Could not load the active session.')` then assert it's inside the region. Simpler:

```tsx
await waitFor(() =>
  expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
    'Could not load the active session',
  ),
);
expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument();
```

Wait, but 'Inspection 1' would be shown in the list (page 1) anyway! The list displays sessions s-001..s-010 regardless. So `queryByText('Inspection 1')` would find the list row. Bad assertion. Instead assert the bar doesn't contain the name: `within(region).queryByText('Inspection 1')` is null. Let me do:

```tsx
const bar = await screen.findByRole('region', { name: 'Active session' });
await waitFor(() =>
  expect(bar).toHaveTextContent('Could not load the active session'),
);
expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
```

✓ (bar is a ref to the same node; content changes from pending→error).

Also, the retry:false default (query-client's defaultOptions retry: false) → one failure → isError. ✓. And MSW's onUnhandledRequest 'error' — our override is registered via server.use, fine; afterEach resetHandlers.

Test 7: **no active session → no bar**:

```tsx
it('shows no bar when there is no active session', async () => {
  state.user = {...};
  state.activeSessionId = null;
  renderApp('/sessions');

  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
  );
});
```

Note: the initial state is pending → the region exists briefly; after resolving null → gone. waitFor handles that. But is there any ambiguity with the pending text? The pending bar shows "Checking the active session…" inside the region; the region disappears after resolution. ✓.

Test 8: **the bar is not on the login screen**:

```tsx
it('does not render the bar on the login screen', async () => {
  state.user = null;
  state.activeSessionId = null;
  renderApp('/login');

  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument());
  expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
});
```

state.user = null → me() 401 → user null. Render /login directly. The login form shows. No AppLayout → no bar. ✓.

Test 9: **dirty notes → confirm before replacement**:

```tsx
it('asks before replacing the active session when its notes are unsaved', async () => {
  state.user = {...};
  state.activeSessionId = null;
  renderApp('/sessions/s-001');

  // s-001 loads and becomes active through the detail fetch
  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

  const notes = screen.getByLabelText('Notes');
  await userEvent.type(notes, ' (follow up)');

  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  const dialog = screen.getByRole('dialog', { name: 'Leave with unsaved notes?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

  await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 4' })).toBeInTheDocument());
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));

  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent('Inspection 4'),
  );
});
```

Wait — issue: clicking the 'Sessions' nav link while the blocker is active. The nav link is in AppLayout's header — clickable (not disabled). React Router's data router blocks the navigation: the `useBlocker`'s state becomes 'blocked', and the detail screen renders its ConfirmDialog. ✓.

Then 'Leave' → `blocker.proceed()` → navigate to '/sessions' → the list mounts. Find the 'Inspection 4' link (the list's page 1 has s-001..s-010, which includes s-004). Click → detail s-004 → the mock sets active (s-004 is open) → refetch active → bar shows Inspection 4. ✓.

Hmm — one more check: while on the detail s-001, is the bar's active query showing s-001? The flow: renderApp('/sessions/s-001') → RequireAuth loading… AuthProvider's me() resolves (user set) → RequireAuth renders Outlet → AppLayout (bar: active query fires → null initially since activeSessionId is null → bar absent) + detail s-001 (useSession fires → mock sets active to s-001 → queryFn's refetchQueries → bar refetches → shows s-001). Race: the bar's initial fetch and the detail's fetch happen nearly simultaneously. The bar's initial fetch could resolve *after* the detail fetch's refetch? If the bar's initial fetch starts and the detail's fetch completes first (setting active) and refetchQueries triggers a second fetch, the first fetch (already in flight) returns… MSW handles each request independently at request time. If the bar's initial request reached the handler *before* the detail fetch set active → returns null; then the refetch (after detail) returns s-001. React-query's resolution order: the last-started fetch's result is what's used? Actually, for a query with multiple fetches in flight, React Query uses the latest fetch's result (onSettled per fetch; data updates as each fetch resolves — could the earlier fetch's null resolve *after* the refetch's s-001, overwriting the data back to null?? Hmm. React Query: when a new fetch is started while one is in flight, the in-flight fetch continues; each fetch updates state on resolve… there's a mechanism: `fetch` sets `dataUpdateCount`? Let me think. In TanStack Query v5, each Query object has a single `fetch` promise at a time — a new `fetch` while one is in flight: the query tracks `state.fetchId`; on resolve, it only updates if the fetchId is still current. The refetch started by refetchQueries increments the fetchId; when the first (stale) fetch resolves, its fetchId is older → its result is *discarded*. Yes — v5 guards with fetchId. So the final data = s-001. ✓.

But even simpler: both are in flight; the order is nondeterministic; but the fetchId guard ensures the latest fetch wins. refetchQueries' fetch starts *after* the initial one (detail fetch completes → then refetch), so it's the latest → wins. ✓.

Edge: what if the detail fetch completes *before* the bar's query has started (bar mounts in the same commit — the query starts synchronously in the same render pass's effect). Both start in the same commit: the bar's useActiveSession and the detail's useSession both mount in the same render pass (AppLayout renders the Outlet in the same tree commit). Their queryFns both start as microtasks. The detail's mock handler sets active synchronously on request; the bar's handler reads active on request. Order of fetch dispatch: whichever's effect runs first… effects run children-first? The detail screen is a child of the layout (via Outlet). Effects: the child's effect runs before the parent's. The queries start in the hooks' render/effect — useQuery starts the fetch in an effect (v5 starts on mount via effect). The child (detail) effect runs before the parent (bar) effect → detail's fetch is dispatched first → the mock sets active → then the bar's fetch reads the updated active → the bar's initial fetch already returns s-001! Then the refetchQueries (from detail's queryFn) refetches again → s-001. Consistent. ✓. (MSW node intercepts async; request handling order follows dispatch order.)

Good.

One more: **`state.activeSessionId` reset across tests** — each test sets it explicitly. But the `sessions` array mutation (close) persists: the close test closes s-004. If test 9 runs after test 4 (in file order), test 9 clicks 'Inspection 4' → s-004 is now closed → the mock does *not* set active (status closed) → the bar still shows Inspection 1 → the test fails! Order dependency. Must avoid: in test 9, use a session that's still open. Which sessions are open? i%3==0: s-001, s-004, s-007, s-010, s-013… If test 4 closes s-004, test 9 should use s-007. But test order in the file: describe/it order. Also, does test 4's close affect test 3 (s-002 paused — close test doesn't touch it) either.

Plan (file order):
1. 'shows the active session after opening from the list' — s-001 (open). No close.
2. 'ticks the elapsed time' — s-001. No close.
3. 'resumes' — s-002. No close.
4. 'no bar when none active' — none.
5. 'error state' — s-001 (server override; no mutation).
6. 'restores on fresh load' — s-001, on /orders.
7. 'close from bar' — close s-004 (now closed in db).
8. 'asks before replacing when dirty' — start with s-001, replace with s-007 (still open).
9. 'no bar on login' — none.

Order 8's replacement target is s-007: the list's page 1 has s-001..s-010 → 'Inspection 7' is visible. ✓. s-007 status: i=6 → 6%3=0 → open. ✓. notes i%4: 6%4=2 → ''. Fine.

Hmm, but test 8 first opens s-001 via deep link — s-001 is still open (never closed). ✓.

Also test 1: after the test, s-001 is active; each test resets `state.activeSessionId` at the start. ✓.

Also — the `state.user` setup in each test mirrors the existing style.

Now — **the blocker dialog's title**: 'Leave with unsaved notes?' — from the existing detail screen. ✓.

**The Notes label**: `<label>Notes <textarea .../></label>` → `getByLabelText('Notes')`. ✓.

Now — let me also verify that **test 1's assert of Resume's href**: in jsdom, `Link` renders `<a href="/sessions/s-001">`. `toHaveAttribute('href', '/sessions/s-001')`. ✓.

**Potential issue: `findByRole('region', { name: 'Active session' })`** — the region has `aria-label="Active session"`. In test 1, the region only appears after the refetch. findByRole polls. ✓.

But wait — a subtle point about test 1: on '/sessions' mount, the bar's active query fires with activeSessionId=null → resolves null → the region is absent. Then we click. ✓.

Now, **vitest globals**: vite.config sets `globals: true`, and the tsconfig's types include "vitest/globals". Existing tests import `{ describe, expect, it }` from 'vitest' anyway. Follow that.

**Imports in the test file**:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../mocks/server';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
```

Now — **does `server.use` with the path '/api/sessions/active' match?** The client fetches `/api/sessions/active` (the request path `/api` + `/sessions/active`). MSW's node matches relative to the base… existing handlers use `http.get('/api/sessions/active', ...)`. So `server.use(http.get('/api/sessions/active', ...))` matches. ✓.

**Now let me re-verify the queries.ts change for `useSession`** — the refetch side effect. One concern: `refetchQueries`'s promise is unhandled → `void`. ESLint isn't configured; fine.

An alternative approach: `qc.invalidateQueries({ queryKey: sessionKeys.active() })`. invalidate marks as stale + refetches active queries. refetchQueries is more direct. Keep refetchQueries.

Also, should `useSession`'s refetch be conditioned on `session.status !== 'closed'`? If closed, the server leaves active as-is; a refetch is harmless but a no-op fetch. Keep the guard with a comment.

**Now the bar's "close" button while `closeSession.isPending`** — disabled. And the ConfirmDialog is reused. Also, if the close fails (mutation error) — the bar stays; the app style doesn't display mutation errors anywhere (the orders detail doesn't either). Keep consistent; no extra UI. Hmm, but the spec says "handle the active-session query's pending and error" — only the query. OK.

**Elapsed formatting function** — place in ActiveSessionBar.tsx (feature-local). Fine.

Let me also think about **`useNow`/ticking and tests**: in test 2, after `findByRole`, the region exists; get the text; wait 1100ms; compare. The interval is 1000ms → at least one tick → the seconds change. But what if the render updates are batched and the text changes exactly at the boundary… comparing the full textContent with 1100ms is safe.

Actually, hmm, one risk in test 2: `bar.textContent` includes the name, status, buttons ('Resume', 'Close session') — constant parts; only the elapsed changes. ✓.

**Now, one more important check: the `useBlocker` import** — already used in the existing detail screen; react-router-dom ^6.26.2 includes useBlocker (added in 6.19). The existing code uses it, so it's fine. I don't change the detail screen.

**Do I need to change SessionDetailScreen?** The dirty-flag replacement confirmation already exists via the blocker. When the user leaves with the "Leave" confirm, the navigation proceeds; opening another session replaces the active. No change needed. ✓ — "use it, don't add a second source of truth."

**Do I need to change AppLayout?** Yes, to include the bar.

**Files changed/created:**
1. `src/features/sessions/ActiveSessionBar.tsx` (new)
2. `src/features/sessions/ActiveSessionBar.test.tsx` (new)
3. `src/features/sessions/queries.ts` (modified: add `useActiveSession`, extend `useSession` with the active sync, extend `useCloseSession` with the active cache clear)
4. `src/app/AppLayout.tsx` (modified: render the bar)

That's a consistent, minimal diff. No changes to shared types/api/auth/router/mocks.

Wait — should I double-check that `api.getActiveSession` exists? Yes: `getActiveSession: () => request<Session | null>('/sessions/active')`. ✓.

Now let me write the complete file contents.

**queries.ts** (full):

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
 * Fetching a session makes it the active one on the server. The bar's source
 * of truth is `GET /sessions/active`, so keep that cache in step right here
 * instead of assuming the client knows which session just became active.
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async () => {
      const session = await api.getSession(id);
      if (session.status !== 'closed') {
        void qc.refetchQueries({ queryKey: sessionKeys.active() });
      }
      return session;
    },
  });
}

/** The server-side active session. `null` is a real answer: nothing is open. */
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
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
      // The server drops the closed session from the active slot; mirror that
      // so the bar empties without a round-trip.
      qc.setQueryData<Session | null>(sessionKeys.active(), (old) =>
        old && old.id === updated.id ? null : old,
      );
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

Wait, one TS check: `qc.setQueryData<Session | null>(sessionKeys.active(), (old) => ...)` — the updater parameter `old` is `Session | null | undefined`. `old && old.id === updated.id ? null : old` — returns `null | Session | null | undefined`. The signature is `Updater<Session | null>`: `(old: Session | null | undefined) => Session | null | undefined`. ✓.

`sessionKeys.active()` returns `readonly ['sessions', 'active']` — a valid data key. ✓.

Hmm, `refetchQueries({ queryKey: sessionKeys.active() })` — the filter's queryKey is a readonly tuple; fine.

**ActiveSessionBar.tsx** (new):

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * A wall-clock that advances once a second, so the elapsed time ticks.
 * Only the bar consumes it; the interval stops with the bar.
 */
function useTickingNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);
  return now;
}

export function ActiveSessionBar() {
  const { data: session, isPending, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const [confirmClose, setConfirmClose] = useState(false);

  const running = session !== undefined && session.closedAt === null;
  const now = useTickingNow(running);

  if (isPending) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Checking the active session…
      </div>
    );
  }

  if (isError) {
    // Different from "no active session": the fetch failed, and pretending the
    // slot is empty would hide a server problem from the operator.
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Could not load the active session.
      </div>
    );
  }

  if (!session) return null;

  const end = session.closedAt !== null ? new Date(session.closedAt).getTime() : now;
  const elapsed = end - new Date(session.startedAt).getTime();

  return (
    <div className="active-bar" role="region" aria-label="Active session">
      <span className="active-bar__name">{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-bar__elapsed">{formatElapsed(elapsed)}</span>
      <div className="active-bar__actions">
        <Link to={`/sessions/${session.id}`}>Resume</Link>
        <Button
          variant="danger"
          disabled={closeSession.isPending}
          onClick={() => setConfirmClose(true)}
        >
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final."
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

Hmm — `running = session !== undefined && session.closedAt === null`. During pending, session is undefined → running is false → the hook is fine. The hook is called unconditionally before the early returns — all hooks (useActiveSession, useCloseSession, useState, useTickingNow) are before the returns. ✓. But wait: `useTickingNow(running)` — the `running` computation uses `session` — fine.

Hmm, one wrinkle: the early return for pending/error happens *after* the hooks — all hooks are called, so hook order is consistent. ✓.

One design question: `role="region"` on the pending/error bar — the test queries the region by name in all states. OK.

`data-tone` on the Badge for the status — consistent with other screens. ✓.

**AppLayout.tsx** (modified):

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

**Test file** — let me finalize each test with attention to flakiness:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

describe('ActiveSessionBar', () => {
  it('shows the session it opens from the list, with its status and a ticking clock', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument();
  });
  ...
```

Wait — `within(bar).getByText('open')` — the badge text 'open'. But could there be other text 'open' in the bar? No. ✓. But note: the list's badge is also 'open' — scoped within the bar. ✓.

The elapsed regex: formatElapsed produces e.g. `9466h 04m 11s` (h>0 branch). At test time, always h>0 (since 2024-04). ✓.

  Test: ticks

```tsx
  it('ticks the elapsed time while the session is active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() =>
      expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument(),
    );
    const before = bar.textContent;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bar.textContent).not.toBe(before);
  });
```

  Test: resume

```tsx
  it('resumes the active session from the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('link', { name: 'Resume' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Inspection 2' })).toBeInTheDocument(),
    );
  });
```

  Test: fresh load / other screens

```tsx
  it('restores the active session from the API on a fresh page load, on any screen', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });
```

Hmm — but '/orders' renders OrdersListScreen; wait for the bar. Note: on a fresh load at '/orders', the active query fetches and returns s-001 → the bar shows. This simulates a refresh. ✓. Also proves the bar is on the orders screen (all authenticated screens).

  Test: no active → no bar

```tsx
  it('shows no bar while the pending check settles to "no active session"', ...)
```

Simpler title: 'shows no bar when there is no active session'

```tsx
  it('shows no bar when there is no active session', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
  });
```

Hmm, is the first waitFor enough to guarantee the active query has resolved? No guarantee — the list fetch and the active fetch are independent. The second waitFor handles it (the region exists while pending, then disappears). ✓.

  Test: error

```tsx
  it('shows a distinct error state when the active session cannot be loaded', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'internal_error' }, { status: 500 }),
      ),
    );
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() => expect(bar).toHaveTextContent('Could not load the active session.'));
    expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
  });
```

  Test: close

```tsx
  it('closes the active session from the bar behind a confirm and empties itself', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(sessions.find((s) => s.id === 's-004')?.status).toBe('closed');
  });
```

Also assert the bar's confirm is cancelled? Maybe add a small check: cancel keeps the bar. Optional; keep the suite tight. Actually, a cancel assertion is cheap and tests the dialog wiring:

Hmm, to keep it concise, skip cancel — or include it in the close test before confirm? Click cancel → dialog gone, bar still there, session still open. Then click close → confirm → empties. That tests both branches. Let's do it:

```tsx
  it('closes the active session from the bar behind a confirm and empties itself', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const second = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(second).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(sessions.find((s) => s.id === 's-004')?.status).toBe('closed');
  });
```

`screen.queryByRole('dialog')` — after cancel, no dialog anywhere. ✓.

  Test: dirty replacement

```tsx
  it('asks before replacing the active session when its notes are unsaved', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-001');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), ' (follow up)');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Inspection 7' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 7' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent('Inspection 7'),
    );
  });
```

Wait — potential problem: after `userEvent.type` into notes, the dirty flag is true. Click the 'Sessions' nav link → navigation blocked → dialog. But timing: is the dialog rendered synchronously on the blocked navigation attempt? `useBlocker` — the navigation attempt triggers the blocker's state change in the same render cycle; after `userEvent.click` (which awaits), the dialog should be present. `screen.getByRole('dialog', ...)` immediately — could need a waitFor. Safer: `await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' })`. Yes, use findByRole.

Another subtlety: `getByLabelText('Notes')` — is the label unique? The bar doesn't have a Notes label. The detail screen's label: `<label>Notes <textarea/></label>`. ✓.

Another: when we deep-link render at '/sessions/s-001', the detail screen's initial notes effect: `useEffect(() => { if (session) setNotes(session.notes); }, [session])`. s-001's notes: 'Awaiting parts.' Typing appends → dirty. ✓.

After 'Leave' → list '/sessions' loads → 'Inspection 7' link → click → detail 7. But wait: clicking 'Inspection 7' — is the list rendered? After proceed, we're at '/sessions'. The list fetches (fresh cache per renderApp, so the list cache is empty → fetch). Wait for the link, then click. Then the bar should update to s-007. Note: the active is currently s-001 (from the deep-link open). The mock sets active to s-007 (open). Refetch active. Bar shows 'Inspection 7'. ✓.

Assert the final bar text — `toHaveTextContent('Inspection 7')`.

Also — during this test, when we deep-link, does the bar show s-001 before we dirty? We assert `within(bar).getByText('Inspection 1')` — good, that also covers the deep-link activation path.

  Test: no bar on login

```tsx
  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = null;
    renderApp('/login');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

Now — **cross-test contamination check**:

- The close test (s-004) runs before the dirty test in file order. The dirty test uses s-001 and s-007 — unaffected by s-004's close. But wait: the dirty test's deep link '/sessions/s-001' — s-001 is still open ✓.
- The 'restores on fresh load' test uses '/orders' — orders aren't mutated anywhere. ✓.
- The error test overrides only /sessions/active. But that test's list fetch works (the '/sessions' list) — we don't assert on the list there; fine. Also `server.resetHandlers()` in afterEach restores. ✓.

- **The module `state` persists across tests** — each test sets `state.user` and `state.activeSessionId` at the start. ✓.

- One more: in test 1, after clicking 'Inspection 1', we land on the detail screen; the detail's blocker — not dirty (notes not touched). ✓.

**Now let me consider the `useSession` change's interaction with the *list* click navigation and the *blocker* test**: when we click 'Inspection 7' in the dirty test, the detail 7 fetch → refetch active. But the bar's active query — was the bar unmounted? No, the bar is in the layout, persistent. The active query's last value is s-001; the refetch → s-007. ✓.

**StrictMode double render**: the tests don't use StrictMode (render.tsx doesn't wrap in StrictMode — correct, the render helper has no StrictMode). ✓ no double effect.

**Now the potential problem: `findByRole('region', { name: 'Active session' })` when the bar is in the *pending* state** — in test 1, the region is initially *absent* (resolved to null) — wait no, on '/sessions' mount the active query fires; while pending, the region is present ("Checking…"). findByRole could match the *pending* region immediately! Then `within(bar).getByText('Inspection 1')` fails (still pending). Race!

In test 1: renderApp → the bar's active query starts; MSW responds fast; the region flips pending→absent(null)→(after click)→present(s-001). If findByRole catches the pending region, getByText('Inspection 1') throws immediately. Need a robust wait:

```tsx
await waitFor(() => {
  const bar = screen.getByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
});
```

This polls until the region *contains* the name. ✓. Use the waitFor pattern everywhere the content matters.

Similarly test 2 (s-001 preset): the bar could be pending momentarily; findByRole matches pending; then the waitFor for the elapsed regex handles it. But note: `bar` ref — during pending the region div exists; after resolution with data, does React reuse the same DOM node? The same component position returns the same `<div className="active-bar" ...>` element type/position → React keeps the DOM node and updates the children. So the `bar` ref stays valid across state flips. ✓. (Even if it remounted, we re-query via within(bar) — no, if remounted the ref would be stale. Since it's the same element at the same position, it's the same node. Fine.)

Actually, to be safer in test 2, capture the bar via waitFor after the content appears:

```tsx
await waitFor(() =>
  expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
    /\d+h \d{2}m \d{2}s/,
  ),
);
const bar = screen.getByRole('region', { name: 'Active session' });
const before = bar.textContent;
await new Promise((r) => setTimeout(r, 1100));
expect(bar.textContent).not.toBe(before);
```

Hmm, but `toHaveTextContent(/.../)` — the textContent is 'Inspection 1open 9466h 04m 11sResumeClose session'. The regex `\d+h \d{2}m \d{2}s` matches. ✓.

Test 3 (resume): similar — first wait for the region to contain 'Inspection 2' (to ensure data loaded), then click Resume:

```tsx
await waitFor(() =>
  expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent('Inspection 2'),
);
const bar = screen.getByRole('region', { name: 'Active session' });
await userEvent.click(within(bar).getByRole('link', { name: 'Resume' }));
```

✓.

Test 'restores on fresh load':

```tsx
await waitFor(() =>
  expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent('Inspection 1'),
);
```

✓.

Test 'no bar when none': the region could be pending→absent; waitFor absent. ✓.

Test dirty: `await waitFor(() => expect(screen.getByRole('region', ...)).toHaveTextContent('Inspection 1'))` before typing. ✓.

Test close: wait for the region to contain 'Inspection 4' first. ✓.

**Another potential race in the dirty test**: after the deep link, the detail screen shows 'Loading…' until the session loads; the bar appears after the refetch. The waitFor handles it.

Also `userEvent.type(screen.getByLabelText('Notes')...)` — the textarea is rendered only after the session loads (not during loading, since it early-returns). Need to wait for the textarea: `await screen.findByLabelText('Notes')`. Use findBy. ✓.

**Now — check the login test's 'Sign in' button**: `<Button variant="primary" type="submit">Sign in</Button>` → role button name 'Sign in'. ✓.

**Let me re-verify the `useCloseSession` change doesn't break the existing detail-screen close flow** (no existing test covers it, but the behavior): close from detail → onSuccess patches detail (status closed → the detail's "Close session" button is disabled ✓), the list, and the active cache. ✓.

**Edge: closing a session from the bar that isn't the active one?** The bar only shows the active one. The detail's close for a non-active session: the old active's id !== updated.id → active cache unchanged. ✓ correct (server doesn't clear it either).

**Now — `useActiveSession`'s typing**: `useQuery({ queryKey, queryFn: () => api.getActiveSession() })` → data type `Session | null`, `isPending` etc. In the bar, `session` is `Session | null | undefined` (undefined during pending). `running` uses `session !== undefined`. After the isSuccess guard, `!session` covers null. ✓.

**`formatElapsed` when the ms is negative** (clock skew): clamped to 0. ✓.

**Style**: the repo has no CSS file in the reference? The reference listing doesn't include a CSS file (maybe there's a src/index.css that's not shown — not in the reference). The components use className without CSS in the reference… the reference doesn't include any .css file, but index.html only references /src/main.tsx. Maybe the CSS is missing from the reference (not exhaustive? "the blocks above are reference material" — the file listing looks complete: no css). The components reference classes like .shell, .btn — presumably there's a stylesheet not shown, or the scaffold is class-less. In any case, I use classNames consistent with the existing convention (`active-bar`, BEM-ish like `dialog__actions`, `row--clickable`). Fine — no CSS file to modify (can't reference a file I wasn't shown; and creating a CSS file isn't called for. The instructions: don't create files not called for. Adding styles would be a new file; the existing app presumably has styles somewhere not shown… risky. The reference is what I have; it doesn't include a css file. But wait — main.tsx doesn't import any css. index.html has no link. So the scaffold really has no CSS. So the classNames are purely structural/for testing. Fine — consistent.)

**Now, one more reconsideration: the placement of the active-sync refetch in `useSession`.** Is there an issue with the `useSession` hook being used elsewhere? Only the detail screen. ✓.

But hmm — another scenario: **staleTime 30s on the active query + user opens a session, bar updates via refetch. Later (within 30s) the user logs in again… fine.**

**Scenario: the operator opens a closed session from the list** (click a closed row) → detail loads, closed → mock doesn't change active → the bar is unchanged (still the previous active or none). Spec: "opening a session makes it active" — the server decides (closed can't be active). Client mirrors. ✓.

**Now — think about whether the `refetchQueries` in queryFn could cause a loop**: refetching the active query doesn't trigger the detail query. No loop. ✓.

**The `void` before refetchQueries** to avoid floating-promise lint (no eslint here, but tidy).

**Also verify the imports of `useQueryClient`** — already imported in queries.ts. ✓.

**Test file name/location**: `src/features/sessions/ActiveSessionBar.test.tsx` — matches the repo style (`SessionsListScreen.test.tsx` colocated). ✓.

**Now — one more consideration for the error test**: the query's default `retry: false` (from makeQueryClient's defaultOptions). ✓ one attempt → isError.

And MSW's setup is `onUnhandledRequest: 'error'` — the active handler is overridden; all other requests are handled. ✓.

**Let me verify `within(bar).getByText('open')` in test 1** — the badge's child is text 'open'. But `getByText('open')` could also match if the name contained 'open'… it doesn't. ✓.

**Verify `getByRole('link', { name: 'Sessions' })` in the dirty test** — the nav has `<Link to="/sessions">Sessions</Link>`. After the navigation is blocked, the link is still there. ✓ unique (the list's heading is an h1 'Sessions' — role heading, not link). ✓.

**After proceed → '/sessions'**: the list renders; wait for the 'Inspection 7' link. ✓.

**Now — one more important check: the `useBlocker` dialog is inside the detail screen, which remains mounted while blocked** (the navigation is blocked so the route doesn't change). ✓. Click 'Leave' → proceed → the route changes → the detail unmounts.

**Let me re-verify the `ConfirmDialog`'s accessible name**: `<div role="dialog" aria-modal="true" aria-label={title}>` → `getByRole('dialog', { name: 'Close this session?' })`. ✓.

**The cancel button's name 'Cancel'**. ✓.

**Now, let me also consider: `userEvent.click` on the bar's 'Close session' Button — the Button is a `<button type="button">` with text. ✓.

**Potential flake: `expect(bar.textContent).not.toBe(before)` in test 2** — over 1100ms, the tick fires ≥1 time, and the seconds value changes (mod 60). Even at a minute rollover, the string changes. ✓.

**One more consideration — the `state` object and `sessions` import in the test**: the db exports `sessions` (the array) and `state`. ✓.

**Let me also think about whether `useActiveSession` should be `enabled` on auth** — the bar only mounts when authenticated. ✓ no need.

**Now, the final file list:**

1. `src/features/sessions/ActiveSessionBar.tsx` — new
2. `src/features/sessions/ActiveSessionBar.test.tsx` — new
3. `src/features/sessions/queries.ts` — full content (modified)
4. `src/app/AppLayout.tsx` — full content (modified)

Do I need to change anything else? Let me scan:
- router.tsx: no.
- auth-context: no (logout clears the cache → the bar's cache clears ✓).
- SessionDetailScreen: no.
- SessionsListScreen: no (clicking the link navigates; the activation happens server-side via the detail fetch).
- api/client: already has getActiveSession. ✓ no change.
- mocks: already handles active. ✓.

Wait — hmm, one more thought about **"opening a session from the list makes it active."** In the real (non-mock) API, does GET /sessions/:id make it active? The spec says the bar should reflect the server's active session via GET /sessions/active. The mock establishes the server contract: detail fetch → active. My client design (refetch active after detail fetch) depends on that server behavior. Since the mock defines the behavior for tests and the spec says the API exposes GET /sessions/active as the source of truth, this is the correct port. The spec's acceptance "opening a session from the list makes it active" is satisfied via the server marking + the client refetch. ✓.

Alternative: the list screen could refetch active on navigation. But the detail-fetch hook is where the server-side effect is. Keep it.

**Edge — the `refetchQueries` when the active query has *no* active subscribers but is in the cache** (e.g. the bar is always mounted on authenticated screens, so it's always subscribed). Fine.

**Also verify that `qc.refetchQueries`'s filter matches only the active query**: the key `['sessions','active']` as a prefix — the detail key is `['sessions','detail',id]` — the second segment differs ('active' vs 'detail') → no match. List key `['sessions','list',q]` → no match. ✓.

**TS check on the test file**: `sessions.find(...)?.status` → `SessionStatus | undefined`; `expect(...).toBe('closed')` fine.

**`HttpResponse.json` imported from 'msw'** — v2: `import { http, HttpResponse } from 'msw'`. ✓ (the handlers use the same.)

**Now let me write the final contents.**

One more consideration on the bar's pending text: "Checking the active session…" — distinguishable from the error. And the error: "Could not load the active session." — mirroring the app's "Could not load sessions." style. ✓.

Also — should the pending/error states use `role="status"` instead of region? I chose the region+aria-label for consistent queryability. Keep it.

Also, a minor: in the bar, when `isError`, maybe include the error code? The ApiError has a code. The app style doesn't surface it elsewhere (the list: "Could not load sessions."). Keep simple.

**Final check of the `useTickingNow` hook naming and placement** — keep it as a private function in the bar file.

Also, **`window.setInterval`** returns a number in the DOM lib; fine.

**Now — the elapsed for a paused session?** The spec says elapsed time counting up; paused isn't special-cased. Keep ticking based on startedAt (the bar shows the status badge anyway). Fine.

Let me also reconsider the **`<Link>` for "Resume" inside the `.active-bar__actions` div alongside a Button** — fine.

**Test 1's elapsed regex**: `within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)` — the span's text is exactly that. getByText with a full string (with $ anchor) — the span's textContent matches. ✓.

Now — **a potential problem in test 1**: after clicking the 'Inspection 1' link, the detail screen loads; but the *bar's* refetch happens via the detail's queryFn. Also, the detail screen's own `useSession` is the same query… wait, the bar doesn't use useSession. ✓.

Also, hmm: **the `waitFor` in test 1** — after the click, the sequence: navigation → detail fetch (sets active) → queryFn refetches active → the bar's data updates → the region renders the name. All within ~50ms. The default waitFor timeout of 1s is OK.

**Another subtle issue**: in test 1, before the click, the bar's active query resolved to `null` and the region is absent. Then we click. But `userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }))` — at that point, is there any other link with the name 'Inspection 1'? Only the list. ✓.

**Let me reconsider test 4 (error)**: `renderApp('/sessions')` — the list also loads fine. The region shows pending, then error. `await screen.findByRole('region', { name: 'Active session' })` could resolve during *pending* — then `await waitFor(() => expect(bar).toHaveTextContent('Could not load...'))` — the bar node: same node across the pending→error flip (same position). ✓.

**Now — verify no unused imports in the test file**: we use `within`, `screen`, `waitFor`, `userEvent`, `http`, `HttpResponse`, `describe/expect/it`, `sessions`, `state`, `server`, `renderApp`. All used. ✓.

In ActiveSessionBar.tsx: imports `useEffect, useState`, `Link`, `Badge`, `Button`, `ConfirmDialog`, `useActiveSession, useCloseSession`. All used. ✓.

In queries.ts: same as before + no new imports needed (`useQueryClient` already there). ✓.

In AppLayout.tsx: add `ActiveSessionBar` import. ✓.

**Let me also verify the `Button` disabled when `closeSession.isPending`** — the `Button` spreads rest → the disabled attribute. ✓.

**Now, let me write the final answer with exactly four file blocks.** The format: level-3 heading with the repo-relative path, then a fenced block. Nothing outside that pattern.

Wait — should I also double-check that `tsconfig`'s `noUnusedLocals` — yes, all locals are used.

One more: in `useCloseSession`, the updater's parameter `old` is implicitly typed — with the explicit generic `setQueryData<Session | null>`, the updater is inferred: `(old: Session | null | undefined) => ...`. ✓.

And in the bar, `const { data: session, isPending, isError } = useActiveSession();` — `data` is `Session | null | undefined`. ✓.

`running` variable: `session !== undefined && session.closedAt === null`. When pending → false. When data is null → false (session is null → null !== undefined is true! Wait: `session !== undefined` when session is null → true, then `session.closedAt` → **TypeError**: null has no closedAt!

Bug! When `data` is `null` (no active session), `session` is `null`, `session !== undefined` is `true`, and `session.closedAt` throws.

Fix: `const running = session !== null && session !== undefined && session.closedAt === null;` or `!!session && session.closedAt === null` → but when pending, session is undefined → `!!session` is false ✓; when null → false ✓; when a session → check closedAt. So:

```ts
const running = session !== undefined && session !== null && session.closedAt === null;
```

TS narrows: `session !== undefined && session !== null` → after that, session: Session. Write it as:

```ts
const running = session != null && session.closedAt === null;
```

Hmm, the repo style — does it use `!==`? `authed()` uses `!== null`. Use explicit:

```ts
const running = session !== null && session !== undefined && session.closedAt === null;
```

A bit verbose; `session != null` is idiomatic and fine, but strict-mode repos often prefer explicit. Use `!!session && session.closedAt === null` — hmm. Let me write:

```ts
const running = Boolean(session) && session.closedAt === null;
```

TS: `Boolean(session) && session.closedAt` — does TS narrow on `Boolean(x) && ...`? No — TS doesn't narrow via a Boolean() call. So `session.closedAt` would error (session: Session | null | undefined). Need explicit narrowing:

```ts
const running = session !== undefined && session !== null && session.closedAt === null;
```

That narrows correctly. OK, a bit verbose but correct and clear. Alternatively, restructure: compute `running` after the early returns? No — the hooks must be called unconditionally before the returns. Keep it before the return, verbose is fine.

Actually, cleaner:

```ts
const isRunning = session ? session.closedAt === null : false;
```

`session ?` narrows (truthy) → excludes null and undefined. ✓ Clean. Use that.

Similarly, the `elapsed` computation is after the `if (!session) return null;` — narrowed there. ✓.

**Also re-check `formatElapsed`'s unused parameter** — none.

**`TICK_MS` constant used.** ✓.

Now — **final sanity check on the 'no bar on login' test**: AuthProvider's `me()` → 401 (state.user is null) → setUser(null), loading false. RequireAuth: on '/login', RequireAuth isn't in the /login route's path. LoginScreen: `user` is null → renders the form. ✓. No AppLayout → no region. ✓. But timing: LoginScreen initially — user null from the start (initial state user=null). The form renders immediately. waitFor the 'Sign in' button. ✓.

**And one more possible flake**: in the dirty test, `userEvent.type(screen.getByLabelText('Notes'), ' (follow up)')` — the textarea's initial value 'Awaiting parts.'; typing appends at the end. Dirty = notes !== session.notes ✓.

Then click 'Sessions' (nav). Blocker fires. `await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' })`. ✓.

Click 'Leave' → `blocker.proceed()` → navigate to '/sessions'. The list renders (fresh fetch). Wait for the 'Inspection 7' link → click → detail 7 loads → active s-007 → the bar updates.

`await waitFor(() => expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent('Inspection 7'));` — the region exists (was s-001) and flips to s-007. ✓.

Hmm wait — one thing: when the user navigates from the detail s-001 (after proceed) to the list, the *bar's* active query still holds s-001 (no refetch trigger on list navigation) — correct, the active is still s-001 server-side. Then opening s-007 → the detail fetch sets active → refetch → s-007. ✓.

**Also verify: after `userEvent.type`, the dirty flag uses `session !== undefined && notes !== session.notes`.** The `session` from the `useSession` data. Typing changes `notes`. ✓.

I think the design is solid. Let me also double-check the **`useSession` refetch in the *first* open test and staleTime**: the active query was created on mount with staleTime 30s. `refetchQueries` ignores staleTime and refetches. ✓.

**One more scenario — the list screen's own `useSessions` is unaffected.** ✓.

**Now, write the final files.** Also — the instruction says "don't restate files you're not changing" — so only four files.

Let me write the queries.ts in full (with original content + changes, preserving original comments).

Also in the test file, keep the describe name 'ActiveSessionBar'.

Let me also reconsider: **should the bar's close confirm say "Unsaved notes will be lost" when the detail is dirty?** The bar can't know the detail's dirty flag (that's a local state on the detail screen — intentionally not a second source of truth). The detail's own close confirm already says that. The bar's body: "Closing is final." Fine.

**Final format check**: headings like `### src/features/sessions/ActiveSessionBar.tsx` followed by a fenced block. No extra prose. Begin with the first heading.

Let me also verify the test's msw import path: `from 'msw'` — package msw ^2.4.9, handlers import `from 'msw'`. ✓.

One last thing — **the `OPERATOR` constant** is shared across tests; the existing style sets `state.user` inline in each test. I set `state.user = OPERATOR` — fine, or inline to match the style exactly. The existing file writes it inline each time. Follow the repo style, inline… it's six tests; inline is fine and matches. Actually a const is cleaner; but "in the style the repo already uses" — inline `state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };`. Go inline to mirror. Hmm, a const would be acceptable too. Mirror the repo: inline.

Also verify: in the 'restores on fresh load' test, we don't wait for the orders list; just the bar. The '/orders' list fetch is fine in the background.

And in that test, should I also assert the bar on the *sessions* screen? The other tests already show the bar on /sessions and /sessions/:id. '/orders' covers "all screens." Good enough.

Now let me write it all out.

Actually — wait, one more edge in the close test: after cancel, I assert `within(bar).getByText('Inspection 4')`. The `bar` ref — the dialog opened inside the bar's div (ConfirmDialog renders inside the bar's div). The cancel unmounts the dialog. The bar node is unchanged. ✓.

And `screen.queryByRole('dialog')` — null. ✓.

Also — **the `useCloseSession` mutation and the `closeSession.mutate(session.id)` in the bar** — after success, the `session` data (active) is set to null → the component re-renders → `!session` → returns null. But note: the `closeSession` variable from `useCloseSession` — the mutation instance persists across renders (same hook). ✓.

**Potential issue**: after the active cache → null, the bar returns null, but the `ConfirmDialog` is also unmounted — the confirm state is already false. ✓.

Now, the `isPending` early return in the bar — after close success, the query state: setQueryData on an already-resolved query → stays success with null data. Not pending. ✓.

Also — **the mutation's onSuccess runs, then the bar re-renders with null.** ✓.

I'm confident. Let me write the final answer.

Actually, let me reconsider the **comment style in queries.ts** — the repo uses explanatory comments; mine match the tone.

One last thing to double-check: `qc.refetchQueries({ queryKey: sessionKeys.active() })` — `sessionKeys.active()` is a function returning a readonly tuple; the filter accepts it. ✓.

And the `void` keyword before the promise: `void qc.refetchQueries(...)` — fine.

Final file contents:

### src/features/sessions/ActiveSessionBar.tsx

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${ss}` : `${m}m ${ss}`;
}

/**
 * A wall clock that advances once a second, so the bar's elapsed time ticks.
 * The interval only runs while the session is open; it stops with the bar.
 */
function useTickingNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  return now;
}

/**
 * The persistent bar for whichever session the server has marked active.
 * `GET /sessions/active` is the source of truth; pending and failed fetches
 * are shown as themselves, never as "no active session".
 */
export function ActiveSessionBar() {
  const { data: session, isPending, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const [confirmClose, setConfirmClose] = useState(false);

  const now = useTickingNow(session ? session.closedAt === null : false);

  if (isPending) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Checking the active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Could not load the active session.
      </div>
    );
  }

  if (!session) return null;

  const end = session.closedAt !== null ? new Date(session.closedAt).getTime() : now;
  const elapsed = end - new Date(session.startedAt).getTime();

  return (
    <div className="active-bar" role="region" aria-label="Active session">
      <span className="active-bar__name">{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-bar__elapsed">{formatElapsed(elapsed)}</span>

      <div className="active-bar__actions">
        <Link to={`/sessions/${session.id}`}>Resume</Link>
        <Button
          variant="danger"
          disabled={closeSession.isPending}
          onClick={() => setConfirmClose(true)}
        >
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final."
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

### src/features/sessions/queries.ts — as drafted.

### src/app/AppLayout.tsx — as drafted.

### src/features/sessions/ActiveSessionBar.test.tsx — as drafted, with all 9 tests.

Let me finalize the test file text:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('shows the session opened from the list with its status and elapsed time', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Resume' })).toHaveAttribute(
      'href',
      '/sessions/s-001',
    );
  });

  it('ticks the elapsed time while a session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        /\d+h \d{2}m \d{2}s/,
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    const before = bar.textContent;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bar.textContent).not.toBe(before);
  });

  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 2',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('link', { name: 'Resume' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Inspection 2' })).toBeInTheDocument(),
    );
  });

  it('restores the active session from the API on a fresh load, on any screen', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );
  });

  it('shows no bar when there is no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
  });

  it('shows a distinct error state when the active session cannot be loaded', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'internal_error' }, { status: 500 }),
      ),
    );
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() => expect(bar).toHaveTextContent('Could not load the active session.'));
    expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('closes the active session from the bar behind a confirm and empties itself', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 4',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const second = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(second).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(sessions.find((s) => s.id === 's-004')?.status).toBe('closed');
  });

  it('asks before replacing the active session when its notes are unsaved', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions/s-001');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );

    await userEvent.type(await screen.findByLabelText('Notes'), ' (follow up)');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Inspection 7' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 7' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 7',
      ),
    );
  });

  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = null;
    renderApp('/login');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
```

Hmm — one problem in the close test: `within(bar).getByRole('button', { name: 'Close session' })` — after the dialog opens, the dialog is *inside* the bar's div (ConfirmDialog is rendered inside the bar's container). So `within(bar)` contains *both* the bar's 'Close session' button and the dialog's confirm 'Close session' button → `getByRole('button', { name: 'Close session' })` finds two → throws!

Need to scope more tightly. Options:
- Wrap the bar's content (excluding the dialog) in its own element, e.g. the `.active-bar__actions` div. But the test can't select by class… could add an aria-label to the actions div? Hmm.
- Query the bar's button as the first match? `within(bar).getAllByRole('button', { name: 'Close session' })[0]` — fragile but works. Ugly.
- Render the ConfirmDialog *outside* the region div? The bar's root could be a fragment: `<><div class="active-bar" ...>...</div><ConfirmDialog .../></>` — the dialog isn't inside the region. Then `within(bar)` sees only the bar's button. And the dialog is queryable via screen. That's cleaner! ConfirmDialog is a modal overlay anyway (visually). Let me restructure:

```tsx
return (
  <>
    <div className="active-bar" role="region" aria-label="Active session">
      ...
    </div>
    <ConfirmDialog ... />
  </>
);
```

Now in the test: `within(bar).getByRole('button', { name: 'Close session' })` is unique (the dialog is outside the bar). ✓. And `screen.getByRole('dialog', ...)` works. ✓.

Same for the pending/error branches — return the div directly (no dialog needed there; confirmClose can't be open anyway… actually, confirmClose could theoretically be true only in the active state).

Also in the dirty test: `screen.getByRole('link', { name: 'Sessions' })` — the nav link. Also the detail screen has no 'Sessions' link. ✓ unique.

Also — in the close test, after cancel, `within(bar).getByText('Inspection 4')` ✓.

Now, **the dialog inside the bar's region** — with the fragment approach, the region's accessible content is just the bar's fields.

Another potential problem: **`screen.queryByRole('dialog')` after cancel** — no dialog. ✓.

**And the dirty test's `findByRole('dialog', { name: 'Leave with unsaved notes?' })`** — the detail screen's blocker dialog. ✓.

Now, **`userEvent.click` on the nav 'Sessions' link while the blocker is active** — the click causes a blocked navigation; userEvent resolves; the dialog appears (the blocked state is set in the same event handling). findByRole waits. ✓.

**One more check — `await screen.findByLabelText('Notes')`**: the label wraps the textarea: `getByLabelText('Notes')`. The label's text content is 'Notes' (plus the textarea). ✓.

**Now, in the dirty test, after 'Leave' and the navigation to '/sessions', wait for the 'Inspection 7' link** — the list fetches fresh (empty cache in this renderApp). ✓.

**Verify the test 'restores on fresh load' at '/orders'** — RequireAuth → AppLayout → bar + OrdersList. The bar's active fetch → s-001. ✓. But wait — the orders list is also fetched; fine.

Also hmm, in that test the region could be pending momentarily; the waitFor toHaveTextContent handles it. ✓.

**Now the full rewrite of queries.ts** — preserve the original header comment and structure, add `useActiveSession` after `useSession`, and modify `useSession` and `useCloseSession`.

Let me also double-check the TS for `qc.setQueryData<Session | null>(sessionKeys.active(), (old) => (old && old.id === updated.id ? null : old))`. Signature: `setQueryData<TData>(dataKey, updater: Updater<TData>)` where `Updater<T> = T | ((old: T | undefined) => T | undefined)`. With T = `Session | null`: updater `(old: Session | null | undefined) => Session | null | undefined`. `old && old.id === updated.id ? null : old` — type: `null | Session | null | undefined` → assignable. ✓.

**Edge**: `old` being `undefined` (no cached active) → returns undefined → setQueryData with undefined? Returning `undefined` from the updater means "no change"? Actually, returning undefined sets the data to undefined? In v5, `setQueryData` with an updater returning undefined → data becomes undefined… hmm. If old is undefined (the query has never been fetched), the updater returns undefined → the query's data stays undefined. Harmless (the bar is pending/absent anyway). But in practice, when the close mutation succeeds, the active query has been fetched (the bar is mounted). Fine.

To be safe, we could write `(old) => (old && old.id === updated.id ? null : old ?? undefined)` — same thing. Leave as is.

**Now AppLayout** — final.

I believe this is complete. Let me also consider if I should add a `data-` attribute for styling hooks — not needed.

One more consideration — **the spec says "the bar offers 'Resume' (navigate to detail)"** — implemented as a Link. ✓. "**'Close session'** (call the existing close endpoint, with confirm; on success the bar empties)" ✓.

**"Only one active session at a time; opening another replaces it"** — server-side; the bar reflects the latest. ✓.

**"The active session survives a full page refresh (GET /sessions/active; use it as the source of truth — no client-only persistence of server facts)"** — no localStorage; the query refetches on mount. ✓.

**Regression list** — untouched: list filtering/pagination (no changes to the list screen), detail editing + dirty warning (no changes to the detail screen), logout (queryClient.clear covers the new query), deep links (handled).

**"The existing suite continues to pass, unmodified"** — the existing SessionsListScreen tests: my changes affect them? They render '/sessions'; the bar is now mounted and queries /sessions/active (the mock handles it, state.activeSessionId is null → returns null → the bar is absent). No interference: they assert on list content. The bar's region doesn't add conflicting text ('Checking the active session…' is transient). The existing tests use `getByText('Inspection 1')` etc. — the bar never shows a session name (activeSessionId is null throughout those tests… wait, the existing tests don't navigate to the detail, so the active stays null). ✓.

But hmm — one subtle interaction: the existing 'filters by status' test does `screen.queryByText('Inspection 1')` and expects it not to be in the document after the filter. The bar doesn't render any name. ✓.

**Deep link regression**: no changes.

OK — also, **the `main.tsx` dev worker** — unaffected.

Now let me generate the final answer: four file blocks, in a reasonable order: AppLayout, ActiveSessionBar, queries, tests. Actually, the order doesn't matter. I'll do:

1. src/app/AppLayout.tsx
2. src/features/sessions/ActiveSessionBar.tsx
3. src/features/sessions/queries.ts
4. src/features/sessions/ActiveSessionBar.test.tsx

No prose outside the pattern. Begin with the first heading.
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

### src/features/sessions/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${ss}` : `${m}m ${ss}`;
}

/**
 * A wall clock that advances once a second so the elapsed time ticks. The
 * interval only runs while a session is open; it stops with the bar.
 */
function useTickingNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  return now;
}

/**
 * The persistent bar for whichever session the server has marked active.
 * `GET /sessions/active` is the source of truth: nothing here is mirrored into
 * localStorage or any store that would outlive the query cache. A pending or
 * failed fetch is shown as itself, never as "no active session" — those are
 * different states, and the operator can tell them apart.
 */
export function ActiveSessionBar() {
  const { data: session, isPending, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const [confirmClose, setConfirmClose] = useState(false);

  const now = useTickingNow(session ? session.closedAt === null : false);

  if (isPending) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Checking the active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Could not load the active session.
      </div>
    );
  }

  if (!session) return null;

  const end = session.closedAt !== null ? new Date(session.closedAt).getTime() : now;
  const elapsed = end - new Date(session.startedAt).getTime();

  return (
    <>
      <div className="active-bar" role="region" aria-label="Active session">
        <span className="active-bar__name">{session.name}</span>
        <Badge tone={session.status}>{session.status}</Badge>
        <span className="active-bar__elapsed">{formatElapsed(elapsed)}</span>

        <div className="active-bar__actions">
          <Link to={`/sessions/${session.id}`}>Resume</Link>
          <Button
            variant="danger"
            disabled={closeSession.isPending}
            onClick={() => setConfirmClose(true)}
          >
            Close session
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeSession.mutate(session.id);
        }}
      />
    </>
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
 * Fetching a session makes it the active one on the server. The bar's source
 * of truth is `GET /sessions/active`, so the active cache is re-synced right
 * here instead of assuming the client knows which session just became active.
 * Closed sessions never become active, so they do not trigger the re-sync.
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async () => {
      const session = await api.getSession(id);
      if (session.status !== 'closed') {
        void qc.refetchQueries({ queryKey: sessionKeys.active() });
      }
      return session;
    },
  });
}

/** The server-side active session. `null` is a real answer: nothing is open. */
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
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
      // The server drops the closed session from the active slot; mirror that
      // into the active cache so the bar empties without a round-trip.
      qc.setQueryData<Session | null>(sessionKeys.active(), (old) =>
        old && old.id === updated.id ? null : old,
      );
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

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('shows the session opened from the list with its status and elapsed time', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Resume' })).toHaveAttribute(
      'href',
      '/sessions/s-001',
    );
  });

  it('ticks the elapsed time while a session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        /\d+h \d{2}m \d{2}s/,
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    const before = bar.textContent;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bar.textContent).not.toBe(before);
  });

  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 2',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('link', { name: 'Resume' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Inspection 2' })).toBeInTheDocument(),
    );
  });

  it('restores the active session from the API on a fresh load, on any screen', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );
  });

  it('shows no bar when there is no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
  });

  it('shows a distinct error state when the active session cannot be loaded', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'internal_error' }, { status: 500 }),
      ),
    );
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() => expect(bar).toHaveTextContent('Could not load the active session.'));
    expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('closes the active session from the bar behind a confirm and empties itself', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 4',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const second = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(second).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(sessions.find((s) => s.id === 's-004')?.status).toBe('closed');
  });

  it('asks before replacing the active session when its notes are unsaved', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions/s-001');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );

    await userEvent.type(await screen.findByLabelText('Notes'), ' (follow up)');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Inspection 7' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 7' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 7',
      ),
    );
  });

  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = null;
    renderApp('/login');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
```
