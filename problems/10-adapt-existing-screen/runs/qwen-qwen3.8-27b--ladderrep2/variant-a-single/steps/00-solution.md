# solution

## reasoning

```
Let me carefully analyze the task.

The task is the "persistent active session bar" feature for the existing React back-office app. Wait, but the system prompt conventions mention NestJS/Prisma/TypeScript... but the reference material is clearly a React + Vite + TS app (ops-backoffice). The "conventions" in the system prompt say NestJS etc., but those are generic boilerplate, and the actual task is clearly the React app. The task statement (Variant A + L2 spec) is authoritative: this is a React app, and the reference files are the existing codebase.

So I need to build the active session bar feature:

1. Opening a session from the list makes it active; the bar shows name, status, elapsed time tick on all screens.
2. The bar offers "resume" (navigate to detail) and "close session" (call existing close endpoint with confirm; on success the bar clears).
3. Only one active session at a time; opening another replaces (with confirm if current has unsaved notes — the detail screen already tracks dirty flag).
4. Active session survives full page refresh (API exposes `GET /sessions/active`; use it as source of truth — no client-only persistence of server state).

Existing behaviors must not regress: list filtering/pagination; detail editing + dirty flag warning on route change; logout clearing all state; deep-linking directly to detail URL.

Deliver edits as a coherent diff + tests in the app's style.

Wait — "Deliver edits as a coherent diff + tests" but the format says "deliver all files the solution needs, in full, from first line to last line. No fragments, no 'no changes' comments, no diffs."

So I need to deliver complete files for every file I change, plus new files.

Let me think about the architecture:

**Key insight from the mock handlers**: `GET /api/sessions/:id` sets `state.activeSessionId` (unless closed). So "opening a session" (fetching detail) makes it active on the server side. And `GET /sessions/active` returns the active session. Close sets `state.activeSessionId = null`.

So the server is the source of truth, and the mock reflects that: fetching a session detail makes it active (unless closed). Closing clears it.

Now the feature:

**Active session bar component** — place in `AppLayout` (the layout that wraps authenticated screens). It should:
- use a `useActiveSession` query (react-query) against `GET /sessions/active`.
- Show name, status, ticking elapsed time.
- Resume button → navigate to `/sessions/:id`.
- Close session button → confirm dialog → call `closeSession` mutation → on success, clear the active session cache (set to null) — bar clears.
- Handle loading and error states distinctly: pending → show "Loading active session…" or a pending indicator; error → show error state, not "no active session".

**Replacement with confirm when dirty**: when opening another session (navigating from list to another detail, or deep link?) while the current active session has unsaved notes, we need confirm before replacing.

The detail screen already tracks a dirty flag via `useBlocker(dirty)`. The dirty blocker in react-router v6 fires on route changes that would leave the detail screen with unsaved changes. So if an operator is on the detail screen of session A (dirty) and clicks session B in the list... wait, to click the list they'd have to leave the detail screen first, and the blocker would fire.

Hmm, let me think about the actual flow: operator is on detail A, notes are dirty. They navigate to the list (blocker: "Leave with unsaved notes?" → Leave). Now on the list, they click session B. Detail B loads, server makes B active, replacing A as active. But A still has unsaved notes (client-side draft lost? No — the draft is in the detail screen's component state; once you leave the screen the draft is gone, unsaved notes are lost... actually the blocker says "Your changes to the notes have not been saved." — leaving loses them.)

Hmm wait, what does "unsaved notes" mean for the replacement confirm? Re-reading:

"3. **One active session at a time.** Opening another replaces it, with a confirm first if the current one has unsaved notes. The detail screen already tracks a dirty flag; use it rather than adding a second source of truth for the same fact."

So the dirty flag is the detail screen's local state. The "confirm before replacing" scenario: user is on detail A with dirty notes, navigates to... hmm.

Actually wait. Let me think about when a replacement can happen while dirty notes exist:

Scenario: user is on detail A (dirty). Navigates to list (blocker confirm, they leave — but wait, does leaving lose the draft? Yes, component unmounts). So after leaving, the draft is gone — no unsaved notes anymore. Then no confirm needed when opening B.

Unless... the dirty flag lives in a place that survives. Hmm, "the detail screen already tracks a dirty flag; use it rather than adding a second source of truth for the same fact." So the dirty flag is `dirty` state inside `SessionDetailScreen`. It's local component state.

Hmm, but the blocker is exactly the confirm for "leave with unsaved notes." So maybe the replacement confirm IS the existing blocker: when on detail A (dirty), the user navigates to detail B directly (deep link, or... from where? From the list you have to leave A first).

Wait, actually — can the user navigate from detail A to detail B without going through the list? Yes: the URL bar (deep link), or if the detail screen had a "back to list" link... it doesn't. Hmm.

Actually, let me reconsider. The intended flow might be this: the blocker fires when leaving detail A with dirty notes. If the user proceeds (Leave), the navigation to B happens, B becomes active, and A's notes are lost. The spec says: "opening another replaces it, with a confirm first if the current one has unsaved notes."

Hmm, but the existing blocker already confirms leaving with unsaved notes. So "use it rather than adding a second source of truth" — I think the point is this: the mechanism for the "confirm before replacing" is the existing `useBlocker(dirty)` on the detail screen. When the user is on the detail of active session A with dirty notes and navigates to open session B (e.g., by typing a URL, or via some navigation that goes directly to B's detail — like a deep link), the blocker fires with "Leave with unsaved notes?" — that is the confirm before replacement.

But wait, there's a subtlety: the blocker only fires if the user is currently on the detail screen of the active session. If the user left A clean (or discarded changes), navigating to B just replaces without confirm — correct.

So the "replacement with confirm" behavior is largely... already provided by the existing blocker? The spec says "the detail screen already tracks a dirty flag; use it rather than adding a second source of truth for the same fact." So we don't need to build anything new for the dirty case — we just need to ensure we don't break it, and the bar's active-session logic doesn't interfere.

Hmm, wait. Actually, let me reconsider: could "opening another" mean from the list? User is on the list, active session is A (set earlier), notes of A are... saved? The dirty flag only exists while the detail screen is mounted. If they're on the list, the detail screen for A is unmounted, and the dirty flag is false/gone.

But — here's a realistic scenario: user is on detail A, dirty. Navigates to list → blocker → "Leave" → now on list, A still active. Clicks B in list → detail B → B becomes active (replacing A). The unsaved notes of A are already lost at the "Leave" confirm. So there's no additional confirm needed — the "Leave with unsaved notes?" dialog IS the confirm before replacement.

But what if the user's path is detail A (dirty) → directly to detail B (e.g., via URL)? The blocker fires on that navigation too. Again the confirm happens.

So the existing blocker handles it. The task is: don't break it, and don't add a parallel dirty tracking in the bar/active-session layer.

Hmm, but wait — is there a scenario where the replacement happens without the user being on A's detail screen and A having unsaved notes? No, because the dirty state lives in the detail component. So no.

Therefore, the primary work:

1. **`useActiveSession` query** in `src/features/sessions/queries.ts` — query key already exists: `active: () => ['sessions', 'active']`. Add:
```ts
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}
```
What about `enabled`? Should only be active when authenticated. Hmm — the bar is rendered in AppLayout, which only renders when authenticated (under RequireAuth). But the query would still fetch... actually if unauthenticated, `GET /sessions/active` returns 401, the query errors. But the bar only renders inside AppLayout which only renders when authenticated. However during logout, the query might be in-flight... `retry: false` is the default. Hmm.

Actually — there's a subtlety about the query being fetched in AppLayout. AppLayout only renders when `user` is set. So the query only runs when authenticated. When logout, `queryClient.clear()` wipes everything and the component unmounts. Fine.

But should I add `enabled: !!user` for safety? The layout only renders when authenticated, so it's not strictly necessary. Keep it simple; the app's style doesn't use `enabled` elsewhere. Keep it plain.

2. **Mutation to clear the active session**: when closing from the bar succeeds, the bar should clear. The server sets `activeSessionId = null` on close. Options:
   - After close mutation succeeds: `qc.setQueryData(sessionKeys.active(), null)` — but only if the closed session was the active one.
   - Or invalidate the active query: `qc.invalidateQueries({ queryKey: sessionKeys.active() })` — refetches from server, gets null.

The app's style is "targeted update not invalidation: the server already returned the row." For close, the server returns the closed session but doesn't return the new active state (which is null). The mock sets active to null on close. So a targeted `setQueryData(sessionKeys.active(), null)` is accurate *if* the closed session was the active one. The detail screen's close button — when you close from the detail screen, the session you're viewing is (per the mock) the active one (unless closed). Hmm, but is it always the active one? The mock makes GET detail set active. So if you're viewing detail, it's active. So closing from detail → active becomes null.

But to be safe/correct: on close success, check if `qc.getQueryData(sessionKeys.active())?.id === updated.id`, and if so set null; else leave it. This is a targeted update that matches the app's style. Let me write a helper, or do it inside the mutation's onSuccess.

Actually, the cleanest: inside `useCloseSession.onSuccess`:
```ts
onSuccess: (updated: Session) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  if (qc.getQueryData<Session | null>(sessionKeys.active())?.id === updated.id) {
    qc.setQueryData(sessionKeys.active(), null);
  }
},
```

That handles both the bar's close and the detail's close, keeping them in sync.

Also, when the bar's close succeeds... the bar uses the same `useCloseSession` mutation. On success, the active cache is set to null → bar clears.

3. **What about the active session being updated elsewhere?** E.g., user opens session A (becomes active), then opens session B (becomes active — replacing). The bar should show B. How does the bar know A was replaced? The `useActiveSession` query is cached with staleTime 30s. When the user navigates to detail B, `GET /sessions/B` sets server's active to B. The bar's query (key `['sessions','active']`) still shows A until refetched.

Hmm. How to keep in sync? Options:

a) After `useSession` (detail fetch) succeeds, patch the active cache: `qc.setQueryData(sessionKeys.active(), session)` — if not closed. The mock handler: `state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;` So fetching a non-closed session detail makes it active. So we can mirror that in the client query: after successful `useSession(id)`, if the session isn't closed, set the active cache to that session.

Is that a "client-side persistence of server state"? No — it's a targeted cache update from a server response, exactly the app's pattern (patchLists). The server *did* make it active (the mock handler does that). And the spec says "the API exposes GET /sessions/active, and that is the source of truth" — meaning we don't persist active session to localStorage across refreshes; react-query cache updates from server responses are fine and are the app's pattern.

b) Invalidate the active query on detail fetch — refetch. That's an extra request; the app's style prefers targeted patches.

Going with (a): in `useSession`... hmm, but `useSession` is a plain `useQuery`. I could add an `onSuccess` to the useQuery? In react-query v5, `useQuery` doesn't have onSuccess... actually `useQuery` in v5 does support `onSuccess`? Let me recall. React Query v5: `useQuery` options include `onSuccess`? Yes — v5's useQuery supports `onSuccess`, `onSettled`, `onError` callbacks (data observation callbacks). Hmm, is that right? In v4, useQuery had onSuccess/onError/onSettled. In v5... I think they're still supported. Let me check my memory of v5 docs: v5's `useQuery` options: queryKey, queryFn, enabled, staleTime, gcTime, refetchInterval, refetchOnWindowFocus, refetchOnReconnect, initialData, initialDataUpdatedAt, placeholderData, select, structuralSharing, notifyOnChangeProps, and... lifecycle callbacks `onSuccess`, `onError`, `onSettled`?

Hmm, actually I'm not 100% sure v5 kept onSuccess on useQuery. Let me think. In v5, the `Query` class still has callbacks (onSuccess, onError, onSettled) that can be passed via useQuery options — yes, v5's useQuery still accepts `onSuccess`, `onError`, `onSettled`. I'm fairly certain: https://tanstack.com/query/latest/docs/framework/react/reference/useQuery lists `onSuccess`, `onError`, `onSettled` as options. Yes, v5 has them.

Alternative, more idiomatic for this codebase: do the patch in the component? No — the component is "zero business logic"... that's a NestJS convention. In the React codebase the style is to keep logic in the queries module (like `patchOrder`, `patchLists`).

Hmm, actually there's an even cleaner approach: since the server makes a fetched detail the active session, we can do the cache patch where the detail is fetched. `useSession` is the hook that fetches. I'll modify:

```ts
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      // Opening a session makes it the active one on the server; mirror that
      // in the active cache so the bar doesn't wait for a refetch.
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      }
    },
  });
}
```

Wait, but subtle: the detail query might be served from cache (staleTime 30s). onSuccess fires on fetch success; on cache hit it doesn't fire. On cache hit the session was already made active when it was first fetched, so the cache is already consistent. OK.

Also: what if user reopens the detail of a *closed* session? The mock doesn't change active. Our guard handles that.

Also StrictMode double-render: onSuccess fires once per successful fetch. Fine.

Hmm wait, actually one more consideration. Should `useActiveSession` be `staleTime: 0` / refetch behavior? The bar is in AppLayout and persists across navigation. When the user opens session B from the list, `useSession(B)` fetches, patches active to B — bar updates immediately. On refresh, the bar's query fetches `GET /sessions/active` fresh. If another operator closes the session... out of scope; there's one user in the app.

What if the user closes the session from the detail screen (the existing close button)? The mutation's onSuccess patches detail + list + (with my addition) active→null. Bar clears.

What if the session is closed from the detail while the bar is visible? Same path. Good.

Now the ticking elapsed time: "elapsed time tick." Compute from `session.startedAt` (and closedAt? — the bar only shows non-closed... actually, can a closed session be active? The mock: opening a closed session doesn't make it active; close clears active. So active session should be open or paused. Elapsed = now - startedAt. For a paused session... elapsed of what? Spec: "an elapsed time that ticks" — just now - startedAt. Keep simple: format as e.g. `2h 14m` ticking in minutes? Tick in seconds? "ticking" suggests visible progression — seconds, or at least minutes. Let me go with a small hook `useNow` that ticks every second and format as `1h 04m 09s`? Or `mm:ss`/`h:mm:ss`. Let me format like `2h 03m 11s`. Hmm, for readability: if under 1 hour, `34m 11s`; else `2h 03m 11s`.

Let me write:

```ts
function formatElapsed(from: Date, now: Date): string {
  let s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}
```

And a `useNow(intervalMs = 1000)` hook:
```ts
function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
```

Where to put this? Inside the ActiveSessionBar component file. Keep local.

**ActiveSessionBar component** — where? Feature is sessions: `src/features/sessions/ActiveSessionBar.tsx`. And it's used in `src/app/AppLayout.tsx`.

Bar UI:
```tsx
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const navigate = useNavigate();
  const closeSession = useCloseSession();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useNow(); // only when session? Hook order — call it unconditionally.

  if (isLoading) return <div className="active-bar" data-state="pending">Loading active session…</div>;
  if (isError) return <div className="active-bar" data-state="error">Could not load your active session.</div>;
  if (!session) return null;

  return (
    <div className="active-bar" data-state="active">
      <span className="active-bar__label">Active session</span>
      <strong>{session.name}</strong>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-bar__elapsed" data-testid="elapsed">{formatElapsed(new Date(session.startedAt), now)}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)}>Close session</Button>
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

Hmm — should the bar show on error distinctly? Spec: "handle the active-session query's pending and error. A failed fetch must not render as 'no active session' — those are different states, and the operator can tell the difference even if the code can't." So pending: some indication (loading). Error: error indication. And maybe retry? "the operator can tell the difference even if the code can't" — that phrase is odd. I think it means: visually distinguish them; the operator knows their network dropped. Maybe add a "Retry" button on error? Keep minimal: different text for pending and error. Maybe add a retry via `refetch`. Let me include a retry button on error — that's a reasonable operational affordance. Hmm, "do exactly what the task asks" — the task says handle pending and error distinctly. A retry button is a reasonable interpretation of "handle the error". Let me keep it light: text + retry button.

Actually let me not over-engineer: pending → "Loading active session…"; error → "Could not load active session" + Retry button that calls `refetch()`. That's "handling" the error.

Also `useNow` always ticks — even when no session, the interval runs. Minor issue; but to be tidy, we can conditionally tick: call `useNow(Boolean(session))`? Conditional interval is fine as long as hook order is stable. Let me pass `enabled`:

```ts
function useNow(enabled: boolean, intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [enabled, intervalMs]);
  return now;
}
```

And `const now = useNow(Boolean(session && !isLoading));` Hmm, during pending session is undefined. `Boolean(session)`. Good.

**Placement in AppLayout**: above `<Outlet />` in main:

```tsx
<main>
  <ActiveSessionBar />
  <Outlet />
</main>
```

The bar is only visible on authenticated screens because AppLayout is under RequireAuth. "The bar shows on all authenticated screens and nowhere else" — the login screen doesn't render AppLayout.

**Logout clearing all state, including the bar**: `logout` does `queryClient.clear()` — clears the active query cache. And the component unmounts (navigated to /login... actually logout sets user to null → RequireAuth redirects). The bar unmounts. The mock also clears `state.activeSessionId` on logout. Good — no extra work needed.

**Deep-linking directly to a detail URL**: user lands on `/sessions/s-004` directly. The detail loads, the server makes it active, `useSession` patches the active cache, bar shows it.

Now — the dirty flag / replacement confirm. Let me think about whether anything needs to change.

Flow: on detail A, dirty. Click "Sessions" in nav (route change) → blocker → "Leave with unsaved notes?" → Leave → on list. Click B in list → detail B → B active. The confirm happened at leave time. That satisfies "opening another replaces it, with a confirm first if the current one has unsaved notes" — the confirm was before the replacement (well, before the leave; the replacement happens on B's load).

Hmm, but wait: is there a flow where A is active, A's detail has dirty notes, and the user opens B *without* first being on A's detail screen? The dirty state is in A's detail component, and it must be mounted for it to be dirty... if the detail screen is unmounted, the notes draft is gone — nothing unsaved. Unless the user is on A's detail, and B is opened in the same screen? No, one route at a time.

So the existing blocker IS the replacement confirm. The spec explicitly says: "the detail screen already tracks a dirty flag; use it rather than adding a second source of truth for the same fact." So: don't add dirty tracking in the bar. The blocker handles it.

But wait — is there a subtle regression risk? Let me think: `useBlocker(dirty)`. When the user is on detail A (dirty) and navigates to B's detail... the blocker fires, dialog appears on A's screen. On proceed → navigate to B. Fine, existing behavior.

Another subtlety: after my changes, when the user closes a session from the bar, `setQueryData(active, null)` fires... no interference with the blocker.

Another subtlety: `useSession`'s `onSuccess` patching the active cache — consider: user is on A's detail (active A), navigates to orders, then back to A's detail. `useSession(A)` is cached (fresh within 30s) → no fetch → no onSuccess → cache unchanged. Fine. If stale → refetch → onSuccess sets active to A again (already A). Fine.

Consider: user is on A's detail (A active). Opens B's detail. `useSession(B)` fetches → onSuccess sets active=B. Bar updates. Then user goes back to A's detail: `useSession(A)` — cached fresh → no fetch → active stays B. Correct per server (last-opened is active).

OK. Now — another important question: the bar's "Resume" navigates to `/sessions/${session.id}`. If the user is already on that detail, it's a no-op. Fine.

**Close from the bar**: after mutation succeeds, active→null (if it was the active one). Bar clears. Also the detail/list cache is patched to the closed row.

What if the close fails? The mutation errors; the bar remains. Should we surface it? Existing close on the detail screen also doesn't surface errors (closeSession.isPending not even used there). Keep parity: maybe disable the button while `closeSession.isPending`. Yes, disable while pending — sensible and cheap.

Now — tests. Style in the repo: `src/features/sessions/SessionsListScreen.test.tsx` uses `renderApp(path)` (real router, real query client, MSW) + `state.user = ...` to auth. Note: `renderApp` uses `createMemoryRouter` with the real `routes`.

I need a test for ActiveSessionBar. Where? `src/features/sessions/ActiveSessionBar.test.tsx`.

Test cases (behavior-based):

1. **Bar shows the active session on all screens, after opening from the list**: set `state.activeSessionId = 's-001'`, auth user, render at `/sessions`... but wait, does `renderApp` render AppLayout? Yes — the routes include AppLayout wrapping all authenticated screens. So renderApp('/sessions') will show the bar if there's an active session.

Wait — but note: `renderApp('/sessions')` loads the list; does the list render make anything active? No, only detail fetch does. So set `state.activeSessionId` directly in the mock state to simulate the server truth, and the bar should show it from `GET /sessions/active`.

Hmm, but is it OK to set `state.activeSessionId` directly in the test? It's the mock db's state; the existing tests set `state.user` similarly. Yes, that's the established style.

Test 1: "shows the active session's name, status, and ticking elapsed time on the list screen":
```tsx
it('shows the active session on every authenticated screen', async () => {
  state.user = {...};
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  // bar present with name + status
});
```

Hmm wait — 'Inspection 1' appears in both the list row and the bar's name! `getByText('Inspection 1')` would fail with multiple matches. Careful. The bar shows the session name; the list also shows 'Inspection 1' (s-001 is in the first page). To avoid collision, pick a session that's not in the first page, e.g. 's-011' (Inspection 11, 2nd page). Or use a testid/role query.

Better: give the bar's name a distinctive query, e.g. wrap in a strong element, and query via `screen.getByRole('strong')`? Fragile. Alternative: use `state.activeSessionId = 's-011'` → name 'Inspection 11' won't be in page 1's list. Then `getByText('Inspection 11')` is unique (only the bar).

Actually, even better approach for bar assertion: add a `data-testid="active-session-bar"` to the bar container and query `screen.getByTestId('active-session-bar')`. The repo's style uses aria-label/role queries mostly; the Tooltip uses data attributes (data-variant, data-tone). A testid is fine and common. Hmm, the existing app code doesn't use testids at all. It uses semantic queries. Let me follow the repo style: role/text/aria queries.

Let me design the bar's markup to make it queryable without testids:

```tsx
<div className="active-bar" aria-label="Active session">
  <span>Active:</span> {session.name} <Badge>...</Badge> <time>elapsed</time> <Button>Resume</Button> <Button>Close session</Button>
</div>
```

Queries: `screen.getByRole('button', { name: 'Resume' })`, `screen.getByRole('button', { name: 'Close session' })` — but the detail screen also has a "Close session" button! If the test is at the detail screen of the active session, there are two "Close session" buttons. Use `getAllByRole` or scope. For tests on the list screen, unique.

Elapsed time: I need to verify ticking. `vi.useFakeTimers()`? With react-query + MSW + fake timers, we need to advance timers carefully; existing tests don't use fake timers. Alternative: assert the elapsed text matches a format like `/^\d+m \d{2}s$/` and then `await vi.waitFor` ... real 1-second wait? A test waiting 1.1s real time is a bit slow but tolerable? Hmm.

Option: fake timers with `vi.useFakeTimers()`, advance 1s, expect text change. With react-query + MSW, we need initial promise flushes before we can advance. Pattern:

```tsx
vi.useFakeTimers();
const user = userEvent.setup();
renderApp('/sessions');
await vi.advanceTimersByTimeAsync? 
```

Hmm, this is finicky: userEvent with fake timers needs `advanceTimers`. And MSW's node server uses real promises — `vi.runOnlyPendingTimersAsync` / `advanceTimersByTimeAsync` will await microtasks. This can work but is brittle.

Simpler and more robust approach: render the bar, capture the initial elapsed text, then `await new Promise(r => setTimeout(r, 1100))` and compare. One test takes ~1.2s extra. Tolerable? The spec says "elapsed time ticks" — testing that is worth it. Real-time wait in vitest is fine (default 5s timeout; use `waitFor` with timeout 2000):

```tsx
it('ticks the elapsed time', async () => {
  ...
  const el = screen.getByText(/m \d{2}s/); // hmm regex matching
  const before = el.textContent;
  await vi.waitFor(() => {
    expect(el.textContent).not.toBe(before);
  }, { timeout: 2500 });
});
```

Hmm wait, the element re-renders every second with a new text node — but the same DOM element (same position in tree) so the reference stays valid? React updates textContent in place on the same `<span>` — yes, the element identity is preserved, only text changes. `vi.waitFor` polls. This works with real timers.

Actually, let me reconsider fake timers for precision and speed:

```tsx
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
```

And in the test:
```tsx
state.user = ...; state.activeSessionId = 's-011';
renderApp('/sessions');
// flush the initial loads
await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
const before = screen.getByText(/\d+m \d{2}s/).textContent;
await act(async () => { vi.advanceTimersByTime(1000); });
expect(screen.getByText(/\d+m \d{2}s/).textContent).not.toBe(before);
```

Concerns: `advanceTimersByTimeAsync` advances fake time AND flushes microtasks; but the in-flight fetch promises (MSW) resolve through real async I/O — with fake timers, `setTimeout`-based things inside MSW (there are none? MSW node uses real fetch interception... it's interceptor-based, not setTimeout-based) — the responses resolve as microtasks, so `await vi.advanceTimersByTimeAsync(0)` should flush them? `advanceTimersByTimeAsync(0)` runs pending microtasks... actually `advanceTimersByTimeAsync(0)` advances 0ms but awaits — it flushes the microtask queue. Hmm, but network responses go through multiple microtask hops; a single `await` might not flush all of them. We might need a loop of `await vi.advanceTimersByTimeAsync(0)`.

This is getting brittle. React Testing Library's `waitFor` works with fake timers? `waitFor` uses `setInterval` internally — with fake timers, RTL detects and uses `advanceTimers`? No — RTL's `waitFor` doesn't auto-play well with fake timers unless you use `jest.advanceTimersByTime` in the callback... Actually RTL docs: when using fake timers, you can use `await act(async () => { jest.advanceTimersByTime(...) })` instead of waitFor.

Given the risk, let me go with the real-timers 1-second wait approach — simpler, more robust:

```tsx
it('ticks the elapsed time', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const el = await screen.findByText(/\d+m \d{2}s/); // hmm...
  const before = el.textContent;
  await waitFor(() => expect(el.textContent).not.toBe(before), { timeout: 2500, interval: 100 });
});
```

Wait, `findByText(/\d+m \d{2}s/)` — the text is like "2m 05s" — regex `\d+m \d{2}s`. The s in the seconds part... the text "2m 05s" contains "05s". Regex `/\d{2}s$/`? Let me format: `2m 05s` → matches `/\d+m \d{2}s/`. OK.

Hmm, one concern: does `waitFor`'s polling + React re-render preserve `el`? Yes, same span element, text changes.

But wait, another consideration: jsdom's `setInterval` 1000ms — real. Fine.

Elapsed from startedAt: s-001's startedAt = `Date.UTC(2024, 3, 1 + (0 % 20), 8, 0)` = 2024-04-01T08:00Z. Now is real 2025 — elapsed would be like `7000h 00m 05s`? My format: h > 0 → `7xxx h` — "7384h 12m 03s" — large numbers, fine. Regex: `/\d+h \d{2}m \d{2}s/`. To be safe, use the regex `/\d+[hm] \d{2}[ms]/`... Let me just do: `/\d+(h |m )?\d{2}s/`. Hmm "7384h 12m 03s" — does that match `/\d+h \d{2}m \d{2}s/`? 7384h, 12m, 03s — but minutes might be < 10 → padded to 2 digits, yes `\d{2}m`. OK, but if hours were... always ≥1000 hours here. Simpler: just find it via the bar's label. Let me structure the markup so the elapsed is in an element we can find deterministically:

```tsx
<time className="active-bar__elapsed">{formatElapsed(...)}</time>
```

And query: `screen.getByText(/\d+s/)` — "7384h 12m 03s" contains "03s" — but does any other text on the page match `/\d+s/`? "Page 1 of 3" — no 's' after digits... "Page 1 of 3" no. Hmm "s" alone... risky. Let me use the time element: Testing Library doesn't have a role for `time`. Use `within(screen.getByRole('region', ...))`? I could give the bar `role="region" aria-label="Active session"`:

```tsx
<section className="active-bar" aria-label="Active session">
```

`getByRole('region', { name: 'Active session' })` → `within(bar)`. Clean:

```tsx
const bar = await screen.findByRole('region', { name: 'Active session' });
const elapsed = within(bar).getByText(/\d+h \d{2}m \d{2}s/);
```

Hmm, but if the test environment's clock... startedAt is fixed 2024, now is ≥ 2025, so hours are always ≥ 8000. Unless the CI clock is in 2024 — this is a repo with a 2024 mock; tests likely run in 2025+. To be fully safe, the regex `/\d+s$/` — "…03s" ends in s. Any other element in the bar ending in digits+s? Status badge "open"/"paused" — "paused" ends in 'd'. Name "Inspection 11" ends in a digit but no 's' after. So within the bar, `/\d+s$/` matches only elapsed.

Wait, actually — for the ticking test, let me make it more robust: compare the whole text of the found element before/after. Let me use the `\d+s$` regex.

Hmm, actually let me reconsider the elapsed format to always include seconds: `1h 04m 09s` or `34m 09s`. Both end in `ss`. Good.

2. **Resume navigates to the detail**:
```tsx
state.activeSessionId = 's-011'; // Inspection 11, not in page 1
renderApp('/sessions');
await screen.findByRole('region', { name: 'Active session' });
await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 11' })).toBeInTheDocument());
```

The detail screen's `<h1>{session.name}</h1>` → heading 'Inspection 11'.

3. **Close from bar: confirm → calls endpoint → bar clears**:
```tsx
state.activeSessionId = 's-001';
renderApp('/sessions');
await screen.findByRole('region', { name: 'Active session' });
await user.click(screen.getByRole('button', { name: 'Close session' }));
await screen.findByRole('dialog', { name: 'Close this session?' });
await user.click(screen.getByRole('button', { name: 'Close session' })); // confirm button — wait, the dialog's confirm label is also "Close session"!
```

Hmm — the confirm button's label "Close session" collides with the bar's trigger button "Close session" while the dialog is open. `getAllByRole('button', { name: 'Close session' })` → 2. Use `within(dialog).getByRole('button', { name: 'Close session' })`.

Then after confirm: server closes s-001 (status→closed, activeSessionId→null), mutation success → active cache null → bar clears. Assert: `await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());`

Also assert the server state: after close, `sessions.find(s => s.id==='s-001').status === 'closed'`? Behavior-based: the endpoint was called — visible effect: list's badge shows 'closed' (the list is page 1, and s-001 'Inspection 1' has status open→closed; the patchLists updates the row). So:

```tsx
await waitFor(() => {
  const row = screen.getByText('Inspection 1').closest('tr');
  expect(within(row!).getByText('closed')).toBeInTheDocument();
});
```

Hmm — 'Inspection 1' — the bar is gone, so the list row's text is unique.

Wait, note: the bar shows 'Inspection 1' as its name (s-001) AND the list row shows 'Inspection 1'. While the bar is present, `getByText('Inspection 1')` matches two → the close flow test: after the bar clears, it's unique. But we should wait for the bar to clear first, then check the row. Order: waitFor bar to disappear, then check row's badge.

But hmm — is 'Inspection 1' actually in the first page? s-001 is first. Yes.

Actually, simpler assertion for "close called the endpoint": the bar clearing IS the effect on success (per the mock, close is the only path that clears active — well, logout also clears, and opening a closed session doesn't set). Bar clearing + row status change is solid behavioral coverage.

4. **Refresh survives → bar from GET /sessions/active**: simulate a "full page refresh": a fresh `renderApp` (new QueryClient — `renderApp` creates `makeQueryClient()` per call) with `state.activeSessionId` set → bar appears. That's exactly "source of truth is the endpoint." Test:

```tsx
it('restores the bar from the API after a refresh', async () => {
  state.user = ...;
  state.activeSessionId = 's-004';
  renderApp('/orders'); // any authenticated screen
  await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
});
```

Since each renderApp is a fresh query client with no cache, the bar can only come from `GET /sessions/active`. And rendering at `/orders` also proves "all screens."

Maybe combine with test 1. Let me have test 1 be "on the list screen" and test 4 "on the orders screen (post-refresh)." Both fresh renders.

Hmm — should I also test that there's no localStorage persistence? Can't meaningfully assert negative beyond "a fresh client works from the API" — that IS the test: no client-only persistence, and the API is the source. Good.

5. **Opening a second session replaces the first (bar follows)**:
```tsx
state.user = ...; state.activeSessionId = 's-001';
renderApp('/sessions');
await findByRole bar; expect name 'Inspection 1' in bar.
// click a row link to s-002 'Inspection 2'
await user.click(screen.getByRole('link', { name: 'Inspection 2' }));
// detail loads → server sets active to s-002 → useSession onSuccess patches active
await waitFor(() => expect(within(bar).getByText('Inspection 2')).toBeInTheDocument());
```

Wait — the bar element: after re-render, is it the same `section`? The bar component stays mounted (AppLayout doesn't unmount), and the region persists. `within(bar)` re-queries live. `bar` reference — the DOM node is stable. OK.

But note: after navigation to detail, the page shows the detail with `<h1>Inspection 2</h1>`, AND the bar shows 'Inspection 2' → `getByText('Inspection 2')` would be ambiguous! Use `within(bar)`. But `bar` was obtained before navigation — still valid. `within(bar).getByText('Inspection 2')` — good.

6. **Replacement with unsaved notes shows confirm (existing blocker, must not regress)**:
```tsx
state.user = ...; state.activeSessionId = 's-001';
renderApp('/sessions/s-001');
await screen.findByRole('heading', { name: 'Inspection 1' });
await user.click(screen.getByRole('button', { name: /Sessions/ })); // nav link "Sessions" — role link name 'Sessions'
```

Wait — nav has Links "Sessions" and "Orders". `getByRole('link', { name: 'Sessions' })`. Click → blocker dialog "Leave with unsaved notes?"... wait, the blocker fires only if dirty. Need to make dirty first:

```tsx
const notes = screen.getByLabelText('Notes'); // textarea with aria-label?
```

The detail screen: `<label>Notes <textarea .../></label>` — the label wraps the textarea → accessible name 'Notes'. `userEvent.type(notes, 'X')` → dirty=true.

Then click nav 'Sessions' → blocker dialog appears: `screen.findByRole('dialog', { name: 'Leave with unsaved notes?' })`.

Then click "Leave" → on list. Bar still shows Inspection 1 (A remains active). Then click 'Inspection 2' link → B becomes active. This test verifies the dirty confirm fires before replacement. Assert the dialog appeared; then proceed and assert the bar switched. This is the full replacement-with-confirm flow.

But hmm — is this new behavior or existing behavior (blocker)? Existing. The spec's "must not regress" includes "detail editing and the dirty flag warning on route change." And the acceptance: "opening a second session while the first has unsaved notes → confirm before replacing." The test documents that the confirm exists. Let me write it: type notes → navigate to list (confirm "Leave") → open another session → bar shows the new session.

Wait, actually — hmm, let me re-read the acceptance: "opening a second session while the first has unsaved notes → confirm before replacing." In my flow, the confirm happens at the "leave A" step, not at the "open B" step. Is that the intended UX? Alternative interpretation: the confirm should fire at the moment of opening B (i.e., when the active session would be replaced). But at that moment, A's dirty state no longer exists (we're not on A's detail). To have the confirm at B-open time, we'd need to persist the dirty flag past A's unmount — which the spec explicitly forbids: "the detail screen already tracks a dirty flag; use it rather than adding a second source of truth for the same fact."

So the intended design is: the existing blocker IS the confirm. When you're on A (dirty) and your navigation leads to opening B — whether via list in between or direct deep link — the "Leave with unsaved notes?" dialog is the confirm before replacement. The only path where the operator loses unsaved notes is by explicitly confirming the leave.

Hmm wait, actually one more path: on A (dirty) deep link directly to B's URL → blocker fires (route change A→B) → "Leave with unsaved notes?" → Leave → B loads, becomes active. The confirm before replacement.

And: on A (dirty) → list (Leave confirmed) → B: notes were already discarded at the first confirm. Replacing A with B needs no further confirm because there are no unsaved notes anymore. Correct behavior.

So the test for this acceptance = blocker still works + replacement follows. Let me write it as one flow test.

7. **Pending/error are distinct**:
- Pending: hard to test deterministically without delaying the endpoint. We could use `server.use(http.get('/api/sessions/active', () => new Promise(() => {})))` — an unresolved promise → query stays pending → bar shows "Loading active session…" and not "no active session." That's testable:

```tsx
it('shows a distinct pending state while the active session is loading', async () => {
  state.user = ...; state.activeSessionId = null;
  server.use(http.get('/api/sessions/active', () => new Promise(() => {})));
  renderApp('/sessions');
  await screen.findByText(/active session/i); // pending message
  expect(screen.queryByText('Inspection 1')).toBeInTheDocument(); // list loads fine
});
```

Hmm, the pending message: "Loading active session…" — findByText(/loading active session/i). But note: an unresolved promise — MSW `server.use` with a handler returning a never-resolving promise. That works in msw v2 (a resolver returning a Promise). Query pending: `isLoading` true. The list query proceeds normally. Good.

But does the never-resolving handler break cleanup? `afterEach(server.resetHandlers())` resets. The hanging promise just stays. Fine.

- Error:
```tsx
server.use(http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
renderApp('/sessions');
await screen.findByText(/could not load active session/i);
expect(screen.queryByText('no active session')).not.toBeInTheDocument(); // obviously
```

The key assertion: the error text is shown (not the empty state). Since empty state renders nothing, asserting the error message is present is sufficient; maybe also assert the Retry button is present if I add it.

8. **Logout clears the bar**:
```tsx
state.activeSessionId = 's-001'; state.user = ...;
renderApp('/sessions');
await findByRole bar;
await user.click(screen.getByRole('button', { name: 'Log out' }));
await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());
```

On logout: API clears state, user null → RequireAuth → Navigate /login. Bar unmounts. Assert bar gone. Also `state.activeSessionId` is null (server side). This tests "logout clears all state, including the bar."

Hmm — does this test belong in this file? It's about the bar + auth interaction. Fine in ActiveSessionBar.test.tsx.

9. **Bar is not shown on the login screen**: "The bar shows on all authenticated screens and nowhere else." Test: no user, renderApp('/sessions') → redirects to /login → no bar region, no "active session" text.

```tsx
it('does not show the bar when signed out', async () => {
  state.user = null;
  renderApp('/sessions');
  await screen.findByText('Sign in'); // login screen
  expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
});
```

Wait — renderApp('/sessions') with no user: RequireAuth → Navigate to /login with state.from. LoginScreen renders. `findByText('Sign in')` — the button "Sign in." But careful: the active query — AppLayout doesn't render, so no bar. Also unhandled request: the `/api/auth/me` handler exists (returns 401). Good.

Also — important — `onUnhandledRequest: 'error'`: all fetches in tests must be handled. The bar fetches `/api/sessions/active` — handler exists. Good.

Now, let me double-check the `renderApp` flow for auth: `AuthProvider`'s useEffect calls `api.me()`. If `state.user` is set → user set → app renders. Tests set `state.user` before renderApp. Consistent with existing tests.

**Potential gotcha — StrictMode + useQuery onSuccess**: in StrictMode dev, effects double-invoke, but queries deduplicate; onSuccess fires once per fetch. In tests, `renderApp` doesn't wrap in StrictMode (render.tsx has no StrictMode). Fine either way.

**Another gotcha — `useSession` onSuccess patching active cache, in the list test**: the list screen doesn't call useSession. Only detail. OK.

**Deep-link test**: renderApp('/sessions/s-004') directly → detail loads → becomes active → bar shows 'Inspection 4'. This covers "deep-linking directly to a detail URL" + the bar appearing. s-004: i=3, status = ['open','paused','closed'][3%3=0] = 'open'. Good (a closed one wouldn't become active).

Let me verify statuses: i=0 open (s-001), i=1 paused (s-002), i=2 closed (s-003), i=3 open (s-004). Yes.

Now — the "replace" test uses a click on link 'Inspection 2' (s-002, paused). Opening a paused session: the mock sets active (status !== 'closed'). Bar shows 'paused' badge. Fine.

Now let me think about `useActiveSession` and `enabled` when logged out. The bar only renders inside AppLayout (authenticated). Not a problem.

But — wait. One more thing to double-check: the bar is in AppLayout, and AppLayout renders under RequireAuth. During `RequireAuth`'s `loading`, nothing renders. Good.

Now — the ticking `useNow` in the bar: when the bar re-renders every second, ConfirmDialog etc. re-render — fine.

**Now, on "close session" from the bar — where to put the mutation?** Reuse `useCloseSession` from `./queries`. Its onSuccess already patches detail+lists; I extend it to also clear active if it matches. The bar's close uses the same hook. The detail screen's close also benefits (bar clears when closed from the detail — consistent!).

Let me also re-verify `patchLists` for the closed session: the list's badge updates to closed. Existing tests don't cover that; fine.

**Now file changes:**

1. `src/features/sessions/queries.ts` — add `useActiveSession`; extend `useCloseSession` onSuccess; add onSuccess to `useSession` that mirrors server's "open = active" behavior.

Wait — hmm, let me reconsider adding onSuccess to `useSession`. Is mirroring "GET detail sets active" on the client legitimate per the spec? "Don't mirror in localStorage or a client store that outlives the query cache — server state cached client-side goes stale exactly in the situation this feature exists to handle." A react-query cache update is in-cache (outlives nothing more than other queries) and is the app's established pattern (patchOrder/patchLists). The alternative — invalidating the active query on detail fetch — costs an extra round-trip on every open. The mock handler literally makes GET detail set the active id, so the client patch reflects the server's truth. I'm confident this is right.

But wait, actually — is there a risk of a subtle bug: user opens A (active A, cache A). User opens B (cache B). User goes back to A's detail (cached, no fetch) — cache stays B. Server: active is B. Correct.

User opens A, closes A from the detail → active→null. User opens B → active B. Bar B. Good.

What about the initial load on the list (no active)? GET /sessions/active returns null (state.activeSessionId is null) → bar absent. After opening A from the list, bar appears.

Edge: what if active session is closed by another... single user. Fine.

Edge: `useSession`'s onSuccess sets active to the fetched session — but if the fetched session was fetched as a *refetch* (stale) while the user is already on its detail, and meanwhile another session became active? Can't happen — only this user changes active, and only via their own detail fetch / close. If they fetched A and then B, and A refetches (window focus? refetchOnWindowFocus false) — a refetch could happen when... `refetchOnMount` default is true with stale data: user navigates away from A's detail and comes back after 30s → refetch → onSuccess sets active to A! But the server: does GET A again make A active? Mock: yes — `state.activeSessionId = s.id` on every GET detail (if not closed). So server also re-activates A. The client patch matches the server behavior. Correct by construction.

2. `src/features/sessions/ActiveSessionBar.tsx` — new component.

3. `src/app/AppLayout.tsx` — render the bar above the Outlet.

4. `src/features/sessions/ActiveSessionBar.test.tsx` — tests.

Anything else? The detail screen — changes needed? The dirty blocker stays. The close button stays. Hmm — one thing: after closing from the detail screen, the detail screen shows the closed session (status closed). The bar clears. Nothing else.

Wait, one more consideration for the detail screen: when the session is closed from the bar while the user is on that detail screen? The user is on A's detail, and closes A via the bar (which is visible above the detail!). The detail's `useSession` cache is patched to closed → the screen re-renders with the closed badge, the close button disabled. The notes' dirty state: `dirty = notes !== session.notes` — session object changed (same notes) → dirty unchanged. If the user had unsaved notes and we closed via the bar → notes lost (server keeps old notes). Hmm — is that a problem? The bar's close confirm says "Closing is final. Unsaved notes will be lost."? The detail's dialog says so. For the bar's dialog, the notes might be dirty on the underlying detail screen. Should the bar's close confirm mention it? Can't know the dirty state (it's in the detail component — and the spec forbids a second source of truth). The bar's confirm body can be generic: "Closing is final." That's honest. Keep the body "Closing is final." — the detail dialog keeps its existing text.

Hmm, wait — actually, should closing from the bar even be possible while on the detail screen? The bar is global; sure, that's fine.

Now — let me reconsider whether `useSession`'s onSuccess should be placed inside the `useSession` hook or somewhere else. Alternative: do it in a `useQuery` `onSuccess` — v5 supports this. Let me verify once more that @tanstack/react-query v5's `useQuery` options include `onSuccess`. ... In v5, I recall the `useQuery` docs list `onSuccess`, `onError`, `onSettled` under "Data fetching" / callbacks — yes, they exist in v5 (data callbacks). I'm confident enough.

Alternative that avoids the doubt: use `qc` in the detail screen component? No — logic belongs in the queries module. Or: use a small `useEffect` in the `SessionDetailScreen` that watches `session` and patches? That's business logic in the component — violates the layering spirit (though it's React, not Nest). The queries module is the app's place for such logic (see the patchOrder/patchLists comments: "whatever else needs these actions should reuse this"). Put it in `useSession`.

Actually — wait. Let me reconsider: instead of patching the active cache on every detail fetch, is it cleaner to have the bar itself observe it... no. The patch is the app's pattern. Going with it.

Let me now write `formatElapsed` and the component.

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(startedAt: string, now: Date): string {
  let total = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 1000));
  const h = Math.floor(total / 3600);
  total %= 3600;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. The server is the source of truth: the
 * row comes from `GET /sessions/active` (see useActiveSession), so the bar
 * survives a full page refresh and is never mirrored in localStorage.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError, refetch } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useNow(Boolean(session));

  if (isLoading) {
    return (
      <div className="active-bar" data-state="pending" role="status">
        Loading active session…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="active-bar" data-state="error" role="alert">
        Could not load your active session.{' '}
        <Button variant="secondary" onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }
  if (!session) return null;

  return (
    <section className="active-bar" aria-label="Active session">
      <span>Active session</span>
      <strong>{session.name}</strong>
      <Badge tone={session.status}>{session.status}</Badge>
      <time>{formatElapsed(session.startedAt, now)}</time>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={closeSession.isPending}
        onClick={() => setConfirmClose(true)}
      >
        Close session
      </Button>

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
    </section>
  );
}
```

Hmm — the error state with a nested Button inside a div is fine.

Wait: `data-state` — the repo uses `data-variant`, `data-tone` attributes. OK, consistent.

`role="status"` on pending: accessible. `role="alert"` on error. These are fine.

Now — the tests will query: `screen.findByRole('region', { name: 'Active session' })` — a `<section aria-label="Active session">` → role region. Yes, section with an accessible name → region.

Hmm, one issue: in the close flow test, while the dialog is open, the bar's "Close session" trigger + the dialog's "Close session" confirm — use `within(dialog)`.

The dialog: `<div role="dialog" aria-label={title}>` — title "Close this session?" → `getByRole('dialog', { name: 'Close this session?' })`. Note: the detail screen also has a dialog with the same title — but that test is only at the list screen. In the close-from-detail test (if any) it would collide; let me avoid that test or scope it.

Now — the "replace" test flow detail:

```tsx
it('replaces the active session when another is opened, and keeps the bar in sync', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const user = userEvent.setup();

  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

  await user.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await waitFor(() => {
    expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
  });
});
```

Wait — after navigating to detail s-002, the bar's query: the active cache is patched by useSession's onSuccess. The bar's `useActiveSession` reads the cache → re-renders with the new data. The region persists. Good.

But note — `within(bar).getByText('Inspection 1')` before the click: 'Inspection 1' also appears in the list row (page 1)! But scoped within the bar → unique. Good.

Also note: while on detail s-002, the bar's "Resume" → navigate to `/sessions/s-002` (already there). Fine.

Now the dirty replacement test:

```tsx
it('asks for confirmation before replacing an active session with unsaved notes', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';
  renderApp('/sessions/s-001');
  const user = userEvent.setup();

  await screen.findByRole('heading', { name: 'Inspection 1' });

  await user.type(screen.getByLabelText('Notes'), 'Deferred to tomorrow');

  await user.click(screen.getByRole('link', { name: 'Sessions' }));
  const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
  await user.click(within(dialog).getByRole('button', { name: 'Leave' }));

  await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());

  // The replacement itself happens without a second prompt: the notes were
  // already explicitly discarded, and the dirty flag is gone with the screen.
  await user.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await waitFor(() => {
    const bar = screen.getByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
  });
});
```

Hmm wait — there's a problem! When on the detail s-001 and the user clicks nav "Sessions": the blocker fires. But also — wait, the detail screen for s-001: it's the active session. The bar shows above. The dialog "Leave with unsaved notes?" is rendered in the detail screen. After "Leave," we navigate to the list.

But — another twist: `useBlocker` in a data router with a memory router — the existing app uses `useBlocker` and `createMemoryRouter` in tests. `useBlocker` works with data routers (createMemoryRouter is a data router). Is there an existing test for the blocker? Not in the provided files (only SessionsListScreen.test.tsx was shown). The spec says "the existing suite continues to pass" — the provided workspace only has one test file (SessionsListScreen.test.tsx). So "existing suite" = that. OK.

Does `useBlocker` actually work with `createMemoryRouter` in this repo? It's designed to. The detail screen already uses it in production with `createBrowserRouter`; the memory router also supports blockers. I trust it.

Now — after "Leave" on the blocker: navigation to '/sessions' proceeds. The list renders. Then click 'Inspection 2' link → detail s-002 → server sets active s-002 → useSession onSuccess patches → bar 'Inspection 2'.

But wait — is there a subtle problem with the blocker + the bar's presence? No.

Also — during the detail s-001 render, the bar also fetches `/sessions/active` → returns s-001 (state set). Bar shows. Fine.

Let me also double-check `user.type` on the textarea: `screen.getByLabelText('Notes')` — the label element wraps the textarea: `<label>Notes <textarea/></label>` → the textarea's accessible name is 'Notes'. Good.

Now — the close flow test (from the bar, on the list screen):

```tsx
it('closes the active session through a confirm and empties the bar', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const user = userEvent.setup();

  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('open')).toBeInTheDocument();

  await user.click(within(bar).getByRole('button', { name: 'Close session' }));
  const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
  await user.click(within(dialog).getByRole('button', { name: 'Close session' }));

  await waitFor(() => {
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  // The list row picked up the closed status from the same mutation.
  const row = screen.getByText('Inspection 1').closest('tr');
  expect(within(row as HTMLElement).getByText('closed')).toBeInTheDocument();
});
```

Hmm — after the bar clears, 'Inspection 1' is only in the list row (page 1). But is the row updated? The close mutation's onSuccess `patchLists` — the list query's cache is present (we were on the list) → row patched → 'closed' badge. Should be immediate after the bar clears. But the bar-clearing and row-patching happen in the same onSuccess... both setQueryData calls in the same handler — a single re-render. But my waitFor asserts only the bar's disappearance; then I assert the row — could race if the list hasn't re-rendered yet? Both setQueryData calls happen synchronously in the same onSuccess → same batch → both visible in the next render. Safe.

Actually wait — `within(row as HTMLElement)` — TS: `closest('tr')` returns `HTMLElement | null`. Need to handle null: `const row = screen.getByText('Inspection 1').closest('tr'); expect(row).not.toBeNull();`. Or use `expect(screen.getByText('closed'))` — hmm, 'closed' appears in the status filter's option "closed"! The select has an option with value 'closed' and text 'closed'. `getByText('closed')` matches both the option and the badge → error. So scoping within the row is correct. Let me handle null properly:

```tsx
const row = screen.getByText('Inspection 1').closest('tr');
expect(row).not.toBeNull();
expect(within(row).getByText('closed')).toBeInTheDocument();
```

TS: `within` accepts HTMLElement | HTMLDocument | DocumentFragment. Passing `row` (HTMLElement|null) after the not.toBeNull assertion — does TS narrow? `expect(row).not.toBeNull()` doesn't narrow in TS. Use `if (!row) throw new Error('...')`? Ugly in a test. Alternative:

```tsx
const row = screen.getByText('Inspection 1').closest('tr') as HTMLElement;
expect(within(row).getByText('closed')).toBeInTheDocument();
```

A cast in the test is fine. Or `screen.getByRole('row', { name: /Inspection 1/ })`! A row's accessible name = concatenation of cells: "Inspection 1 Ada closed". `getByRole('row', { name: /Inspection 1/ })` → then `within(that).getByText('closed')`. Cleaner, no cast.

Hmm, but wait: after close, the row's name is "Inspection 1 Ada closed." The regex /Inspection 1/ matches. Good.

But note — before the close, while the bar is showing 'Inspection 1', `getByRole('row', {name: /Inspection 1/})` — the row's name wouldn't collide with the bar (the bar isn't a row). Actually, I only use it after the close. Fine.

Also — the pending/error tests:

```tsx
it('shows a loading state while the active session is still being fetched', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = null;
  server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse>(() => {})));
  renderApp('/sessions');
  await screen.findByText(/loading active session/i);
});
```

Need to import `server` from '../../mocks/server' and `http, HttpResponse` from 'msw'.

The list still loads (the handler is only overridden for /active). The pending message is shown. The never-resolving promise — the query stays pending forever → the assertion is stable.

```tsx
it('distinguishes a failed active-session fetch from "no active session"', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = null;
  server.use(http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
  renderApp('/sessions');
  await screen.findByText(/could not load your active session/i);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
```

And the successful retry? Maybe: after the error, reset the handler and click Retry → bar appears. That tests that the error is recoverable:

```tsx
it('recovers from a failed active-session fetch on retry', async () => {
  state.user = ...; state.activeSessionId = 's-004';
  server.use(http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
  renderApp('/sessions');
  await screen.findByText(/could not load your active session/i);
  server.resetHandlers(); // restore
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
});
```

Hmm — `server.resetHandlers()` restores the original handlers (from `setupServer(...handlers)`). Yes, msw v2: `resetHandlers()` reverts to the initial ones. Good.

Do I want both error tests? The spec explicitly calls out error handling; two tests (shows error + recovers) is good behavioral coverage. Maybe merge recovery into one test to keep the suite tight. Let me keep both, they're cheap.

Actually, hmm, let me reconsider: the "retry" button — is it overkill beyond "handle the error"? I think it's a reasonable, minimal handling. Alternatively, no button, just text. Spec: "handle the active-session query's pending and error." A retry affordance is the natural "handling" in a react-query app. Keep it.

Now — the refresh test and the "all screens" test:

```tsx
it('shows the bar on every authenticated screen', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-004';
  renderApp('/orders');
  const bar = await screen.findByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  expect(within(bar).getByText('open')).toBeInTheDocument();
});
```

Wait — 'open' — does any other element on the orders screen have the text 'open'? Orders list: statuses pending/approved/rejected/cancelled — no 'open'. The filter options: 'All statuses', 'pending'... no 'open'. So `within(bar).getByText('open')` is scoped anyway. Good.

Note: s-004's status: i=3 → ['open','paused','closed'][3%3=0] → 'open'. Yes.

And the deep-link test:

```tsx
it('restores the bar from the API after a deep link to a detail URL', async () => {
  state.user = ...;
  state.activeSessionId = 's-004';
  renderApp('/sessions/s-004');
  await screen.findByRole('heading', { name: 'Inspection 4' });
  const bar = screen.getByRole('region', { name: 'Active session' });
  expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
});
```

Hmm — a fresh renderApp = fresh query client + fresh memory router = simulation of a full page refresh (the server state persists in `state`). The bar can only know about s-004 from `GET /sessions/active`.

Should I also assert that no localStorage is used? We can't meaningfully assert that in the component test. The "fresh client" test implies it: if the bar relied on a client store that survives across renders... well, renderApp creates a new QueryClient but the localStorage would persist across tests in jsdom? jsdom's localStorage persists across tests within the same file (same origin, not cleared between tests by default... actually, does vitest's jsdom environment reset per test file? Each test file gets a fresh environment; within a file, the same window). If the implementation stored in localStorage, the deep-link test would pass even with activeSessionId = null — so let me make the test stronger: `state.activeSessionId = null` and deep-link to s-004 → the detail fetch makes it active on the server (mock) → the bar should still appear (via the useSession patch or the refetch). Hmm, that conflates things.

Actually, the cleanest "source of truth" test: `state.activeSessionId = 's-004'`, fresh render at '/sessions' (no detail fetch involved) → bar appears → can only come from GET /sessions/active. That's my "all screens" test at '/orders' — same idea. Sufficient.

Now, the "ticking" test:

```tsx
it('ticks the elapsed time', async () => {
  state.user = ...;
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const bar = await screen.findByRole('region', { name: 'Active session' });
  const elapsed = within(bar).getByText(/\d+s$/);
  const before = elapsed.textContent;
  await waitFor(() => {
    expect(elapsed.textContent).not.toBe(before);
  }, { timeout: 3000, interval: 200 });
});
```

Concern: `\d+s$` — the text "7384h 12m 03s" ends in 's'. Any other text in the bar ending in a digit + 's'? The strong's name "Inspection 1" ends in '1'... "1" is a digit but not followed by 's'. The regex requires a digit immediately before the terminal 's'. "Inspection 1" → terminal char '1', doesn't match. Badge "open" → 'n'. "Active session" span → 'n'. "Resume" 'e'. "Close session" 'n'. So unique.

But hmm — `elapsed` element reference across re-renders: the `<time>` element persists (same position) → textContent updates. Good.

Timing: initial render at time T (now = T). At T+1s the interval fires → new text. waitFor polls every 200ms up to 3s → catches it. But note: the elapsed text at T vs T+1s always differs (the seconds change). Yes.

Another potential flake: React 18 + setInterval in jsdom — fine.

Also — `within(bar).getByText(/\d+s$/)` — wait, the initial `now` = `new Date()` at first render. The startedAt is 2024-04-01. Elapsed ~ 7000+ hours → format `Xh YYm ZZs`. Ends in 's'. Good.

Now, the logout test:

```tsx
it('clears the bar on logout', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const user = userEvent.setup();
  await screen.findByRole('region', { name: 'Active session' });

  await user.click(screen.getByRole('button', { name: 'Log out' }));

  await waitFor(() => {
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(state.activeSessionId).toBeNull();
  });
});
```

Hmm — asserting `state.activeSessionId` is null is a mock assertion; the behavioral one is the bar's disappearance + the redirect to login. Let me assert the login screen appeared: `await screen.findByText('Sign in')` and the bar gone. Actually, after logout, user null → RequireAuth → /login → LoginScreen → "Sign in" button.

```tsx
await user.click(screen.getByRole('button', { name: 'Log out' }));
await screen.findByRole('button', { name: 'Sign in' });
expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
```

Good. Note: the "Log out" button is in the header; unique.

And the "not on login" test:

```tsx
it('does not render the bar on the login screen', async () => {
  state.user = null;
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
});
```

Wait — with `state.user = null`, `AuthProvider.me()` → 401 → catch → user null. RequireAuth → Navigate /login. LoginScreen. And the bar doesn't exist (AppLayout not rendered). But — hmm, `state.activeSessionId = 's-001'` while logged out: the /sessions/active handler requires auth → 401, but nothing fetches it. OK.

Actually, do I need the separate "not on login" test? "The bar shows on all authenticated screens and nowhere else" — the "nowhere else" = the login screen. Yes, worth having.

Now — the existing list tests must continue to pass. Let me check for regressions from my changes to SessionsListScreen: I don't change it. But the bar now appears on the list screen when an active session exists! The existing tests: they set `state.user`, and `state.activeSessionId` is... the module-level `state` is initialized with `activeSessionId: null`. Do the existing tests reset `state.activeSessionId`? No. But within one test file run, my new test file is a separate file → a fresh module state (vitest isolates per file by default: each test file gets its own module registry). Within my new test file, I set `state.activeSessionId` per test... but module state persists across tests in the same file! E.g., the close test sets s-001 and closes it → the handler sets `state.activeSessionId = null` and the session row's status → 'closed'!! The `sessions` array is mutated by the handlers (notes, status). Across tests in the same file, mutations accumulate!

Uh oh — critical: `sessions` and `orders` arrays are module-level mutable. The close test mutates s-001 to closed forever (for that file). The notes test... my tests don't save notes. But the close does mutate. Also, the existing SessionsListScreen.test.tsx — a separate file → a fresh module instance. So the cross-file concern is only within my file.

So in my test file, I need to be careful about order / mutations. Does vitest run tests in a file serially by default? Yes, serially in declaration order.

Let me enumerate the tests in my file and their mutations:

1. 'shows the bar on every authenticated screen' (at /orders, active s-004) — no mutations (a GET /orders doesn't mutate; the GET /sessions/active doesn't either; AuthProvider's me doesn't either). OK.
2. 'restores the bar from the API after a deep link to a detail URL' (s-004) — GET /sessions/s-004 sets activeSessionId = s-004 (already). No row mutation.
3. 'ticks the elapsed time' (s-001) — no mutation.
4. 'replaces the active session when another is opened' — active s-001 → click Inspection 2 → GET s-002 sets active to s-002. No row mutation.
5. 'asks for confirmation before replacing ... unsaved notes' — types notes locally (no PATCH since we don't save). No server mutation. Active: s-001 → then s-002.
6. 'closes the active session through a confirm and empties the bar' — active s-001 → close → s-001.status = 'closed', closedAt set, activeSessionId → null. **Mutates s-001.**
7. error tests — no mutation (500/never).
8. pending test — none.
9. logout test — active s-001... wait, after test 6, s-001 is closed! If test 9 sets `state.activeSessionId = 's-001'` but the row is closed, the /sessions/active handler returns the session (find by id — returns s-001 with status closed!). The bar would show a closed session. The logout test would still pass (bar appears, logout clears). Hmm, but the close test also asserts the row's 'closed' — that's fine.

To be safe, let me have each test pick an active session id and tolerate state. Let me order the tests so the mutations happen last, or use different session ids. Simplest: put the close test near the end, and the logout test uses 's-002' (still open). And the "signed out" test is independent.

Also the "replace" test asserts the bar's initial 'Inspection 1' (s-001 open, status 'open' badge) — if run after the close test, s-001 is closed → the bar would show 'closed'... let me not assert the status there, just the name. Or order: close test last among the mutation tests.

Actually — cleaner: add an `afterEach` to reset? The repo's existing tests don't reset the db between tests (the existing file has 2 tests, neither mutates). The test/setup.ts only resets MSW handlers, not the db state. For robustness in my file, I could reset the relevant fields in beforeEach: `state.activeSessionId = null`, and restore `sessions[0].status`... that's getting into the weeds. Let me just order the tests carefully, and pick ids that avoid the closed s-003 (i=2: closed; also i=5,8,11,14,17,20,23,26 are closed).

Test plan (order):
1. Bar on all authenticated screens (at /orders; s-004).
2. Deep-link restore (at /sessions/s-004).
3. Ticking (s-001).
4. Replace on open (s-001 → open s-002).
5. Dirty replacement confirm (on detail s-001, dirty → leave → open s-002).
6. Not on login.
7. Pending state.
8. Error state + retry recovery.
9. Logout clears the bar (use s-002 for safety? After test 4/5, s-002 is active; still open).
10. Close from bar (use s-004 — still open; s-001 is also still open since nothing closed it yet). Assert row 'closed'.

Wait, test 10's close: active s-004, list at page 1 shows s-001..s-010 — 'Inspection 4' is in page 1! And the bar also shows 'Inspection 4'. After the bar clears, the row query is fine. Let me use s-004 for close: the row is in page 1 → assert the row badge 'closed' via `getByRole('row', { name: /Inspection 4/ })`.

Hmm — but note: during the close test, before the bar clears, the row 'Inspection 4' is in the list AND the bar's name — scoped queries handle that.

Test 9 (logout) uses s-002: active s-002, bar shows 'Inspection 2'... list page 1 includes 'Inspection 2' — but I only query the bar's region and the login. Fine.

Let me also double-check test 5 (dirty flow) more carefully — the blocker. Sequence:

- renderApp('/sessions/s-001').
- AuthProvider's me → user. RequireAuth OK. Detail screen: useSession(s-001) fetches (also sets server's active to s-001 — harmless, I set it anyway).
- `await screen.findByRole('heading', { name: 'Inspection 1' })` — h1.
- `user.type(textarea, 'Deferred to tomorrow')` → dirty = true.
- Click nav link 'Sessions'.
- `useBlocker(dirty)` — wait, `useBlocker(dirty)` takes a boolean. When the navigation is initiated, blocker.state = 'blocked' → the dialog renders: "Leave with unsaved notes?" with Leave/Cancel.
- Click Leave → blocker.proceed() → navigation completes → list renders.
- Then click 'Inspection 2' link → detail s-002 → active becomes s-002 → bar 'Inspection 2'.

Potential pitfall: when the blocker is active and we click the nav link — the `userEvent.click` on the Link triggers the navigation attempt synchronously; the dialog appears. Then the click on Leave → proceed → navigation. This is the standard data-router blocker pattern; RTL + userEvent handles it. The repo probably tested this already in their full suite (the spec mentions the existing suite; we only saw one test file but the spec says the suite continues to pass — trust it).

Hmm wait, actually — one real concern: does the `useBlocker` dialog in the detail screen interfere with my bar? No.

One more: after "Leave" and navigating to the list, the detail screen unmounts. Then opening s-002: no blocker (we're not on a dirty detail). Good.

Now — `getByRole('link', { name: 'Sessions' })`: the nav has "Sessions" and "Orders" links. Unique.

Test 4 (replace):
- renderApp('/sessions'), active s-001.
- Bar found; `within(bar).getByText('Inspection 1')`.
- Click link 'Inspection 2'.
- Detail s-002 loads. Bar's active cache patched → 'Inspection 2'.
- Assert `within(bar).getByText('Inspection 2')` via waitFor.

But — subtle: while navigating, the bar's `useActiveSession` — the cache was s-001; when the patch happens, the bar re-renders. The region is stable. Good.

Also — wait, in test 4, after the click, the detail screen for s-002 renders; the `useSession(s-002)` fetch's onSuccess patches active. The bar's query reads the cache — immediate. Good.

Now — a very important check: **`useSession`'s `onSuccess` and the `setQueryData` to the active key — when the active query hasn't been fetched yet** (e.g., a deep-link test where the bar fetches in parallel): setQueryData on an unfetched key creates the cache entry — fine, and the bar's query resolves from it (does it skip the fetch if a data exists? Actually, if setQueryData puts data, the query becomes fresh → no initial fetch. Fine — the data came from a server response anyway.)

Hmm, wait — in the deep-link test: renderApp('/sessions/s-004'), state.activeSessionId is already 's-004'. Both the bar's GET /active and the detail's GET /s-004 fire. Whichever lands, the bar shows s-004. Good.

**Now — the "all screens" test at /orders**: the orders screen + the bar. The bar fetches /sessions/active → s-004. Good. Also — the orders list's `onUnhandledRequest: 'error'`: /api/orders is handled. Good.

**Let me now re-check the `useActiveSession` staleTime**: default 30s. In tests, fresh each render. In the app, the bar persists across navigation; the cache stays fresh. When the user opens a new session, we patch — no staleness issue. If a session is closed... we patch. OK.

Edge: user opens A, then opens B, then closes B from the bar → active null. Then the detail's A is still cached; the bar is empty. The server: active is null. Consistent.

**Now the AppLayout change**:

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
      <main>
        <ActiveSessionBar />
        <Outlet />
      </main>
    </div>
  );
}
```

Keep the doc comment. Add a line about the bar? The comment says "anything that must appear on every authenticated screen belongs here, above the <Outlet />." Perfect — the bar fits exactly.

**The queries.ts change** — full file:

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
      // The server makes the session an operator opens the active one (see
      // GET /sessions/:id); mirror that so the bar updates without a refetch.
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      }
    },
  });
}

/** The single source of the active session: the server, via GET /sessions/active. */
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useUpdateSessionNotes(id: string) {
  ... unchanged ...
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      clearActiveIf(qc, updated.id);
    },
  });
}

function clearActiveIf(qc: ReturnType<typeof useQueryClient>, closedId: string): void {
  const active = qc.getQueryData<Session | null>(sessionKeys.active());
  if (active?.id === closedId) qc.setQueryData(sessionKeys.active(), null);
}
```

Hmm, or inline it. Let me inline with a comment — the file's style is small helpers with comments (patchLists). Let me inline the two lines inside onSuccess with a comment:

```ts
onSuccess: (updated: Session) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  // Closing the active session empties the active slot on the server; mirror it.
  if (qc.getQueryData<Session | null>(sessionKeys.active())?.id === updated.id) {
    qc.setQueryData(sessionKeys.active(), null);
  }
},
```

Good.

Wait — one more scenario: closing a session from the detail screen that's not the active one (e.g., the user opened A, then B; goes back to A's detail (cached, still active B); closes A). Server: A closed, active stays B. Client: `getQueryData(active)?.id` = B ≠ A → not cleared. Bar keeps B. Correct!

**Now, `useUpdateSessionNotes`** — save notes: should it touch active? No — the active row's notes would change but... the bar doesn't show notes. Skip.

**The ActiveSessionBar file** — let me reconsider the elapsed format for a 'paused' session: elapsed from startedAt (wall clock) — the spec just says "an elapsed time that ticks." Keep.

Also — should the bar show anything when the session is 'closed'? Active should never be closed (the server clears on close, and doesn't set closed as active). If it were (stale), the bar would show a closed session with a Resume — the detail would show it as closed. Acceptable; don't over-engineer.

**Test file imports**:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';
```

The existing test file's style: `import { screen, waitFor } from '@testing-library/react';` etc. `describe/it/expect` from 'vitest' (globals are enabled but the existing file imports them explicitly — follow that).

Now — `userEvent.setup()` per test, after render. The existing tests call `userEvent.click` (the static API, no setup). Hmm — the existing file uses the static `userEvent.click(...)`. For consistency, use the static API. The static API works in user-event v14 (with a deprecation warning). The repo uses it; follow the repo style: `userEvent.click(...)`.

Now, `waitFor` for the bar's region: `await screen.findByRole('region', { name: 'Active session' })`.

Let me reconsider: is `<section aria-label="Active session">` → `role="region"` with name 'Active section'? A section with an accessible name → region role. Yes, per ARIA: section becomes a region landmark when it has an accessible name. Testing Library's `getByRole('region', { name: 'Active session' })` works.

Alternative simpler: `getByText('Active session')`? The span with the text. But the region query is more semantic. Keep the region.

Hmm, but — the pending state is `<div role="status">` and the error is `<div role="alert">` — no region; good, distinguishable.

Now — let me write the tests carefully with correct expectations about the mock data:

- s-001: Inspection 1, operator Ada, status open, notes 'Awaiting parts.' (i%4==0 → 'Awaiting parts.'), startedAt 2024-04-01T08:00Z.
- s-002: Inspection 2, Grace, paused, notes ''.
- s-004: Inspection 4, Ada, open, notes '' (i=3, 3%4≠0), startedAt 2024-04-04? i%20=3 → April 1+3=4 → 2024-04-04T08:00Z.

Test 1 (all screens at /orders): the bar shows 'Inspection 4' + badge 'open'.

Test 2 (deep-link): at '/sessions/s-004': h1 'Inspection 4', the bar's 'Inspection 4'.

Wait — both the h1 and the bar's strong show 'Inspection 4' → `getByText('Inspection 4')` is ambiguous → use the heading role for h1, and within(bar) for the bar. Fine.

Test 3 (ticking): s-001, at /sessions.

Test 4 (replace): s-001 → click link 'Inspection 2'.

Wait — the list page 1 has links 'Inspection 1'..'Inspection 10'. `getByRole('link', { name: 'Inspection 2' })` is unique.

Test 5 (dirty confirm): as designed.

One concern in test 5: after typing in the textarea and clicking the nav 'Sessions' link — the blocker dialog appears in the detail screen. `findByRole('dialog', { name: 'Leave with unsaved notes?' })`. Then click 'Leave' (within the dialog). Then the list appears: `await screen.findByText(/Page 1 of 3/)`. Then click link 'Inspection 2' → detail; bar → 'Inspection 2'.

Hmm — after the navigation to the list, `findByText(/Page 1 of 3/)` — 'Page 1 of 3' is a <span> with text "Page 1 of 3" — getByText with a regex matches. The existing tests use `getByText(/Page 1 of 3/)`. Good.

Then the bar: `waitFor(() => expect(within(bar).getByText('Inspection 2')).toBeInTheDocument())` — but `bar` was captured earlier... in test 5, do I capture the bar at the start? The bar appears on the detail too (AppLayout is global). At the start (detail s-001), the bar exists. I can capture it then: `const bar = await screen.findByRole('region', { name: 'Active session' });` before typing. The region persists through the navigation (AppLayout doesn't unmount). Good.

Test 6 (no bar on login): state.user = null; renderApp('/sessions'); await findByRole('button', { name: 'Sign in' }); expect no region.

Hmm — one gotcha: the `AuthProvider`'s effect fires `api.me()` → 401 → setUser(null). During `loading` → RequireAuth shows "Loading…". Then /login. The login screen's button 'Sign in'. Good.

But — the initial render's unhandled request check: only /api/auth/me. Handled. Good.

Test 7 (pending): override the /active handler to never resolve. renderApp('/sessions'). `await screen.findByText(/loading active session/i)`. Also assert that the list rendered (the bar's pending doesn't block the app): `expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()`.

Hmm — a never-resolving handler: `http.get('/api/sessions/active', () => new Promise<HttpResponse>(() => {}))`. TS: the resolver type expects `Promise<MSWResponse> | MSWResponse`. `new Promise<HttpResponse>(() => {})` is fine.

Test 8 (error + retry): 500 handler; find the error text; `server.resetHandlers()`; click Retry; bar appears with 'Inspection 4'.

Wait — after resetHandlers, clicking Retry triggers a refetch → the original handler → s-004 (I set activeSessionId='s-004'). The bar's region appears. Good.

Test 9 (logout): active s-002. Bar appears. Click 'Log out'. `await screen.findByRole('button', { name: 'Sign in' })`. Expect no region. Also the server state is cleared — assert `state.activeSessionId` is null? That's an assertion on the mock internals... the mock's logout handler does that; asserting it is asserting the mock, not the app. Let me assert the bar's disappearance + the login screen. Actually "logout clears all state, including the bar" — the app's behavior = the bar is gone (queryClient.clear + unmount). Assert the region is gone. Sufficient; plus, the login redirect is implied by the presence of the Sign in button.

Test 10 (close from bar): active s-004; renderApp('/sessions'); bar 'Inspection 4'; click the bar's 'Close session'; dialog 'Close this session?'; confirm; bar disappears; the row's 'Inspection 4' shows the 'closed' badge.

Row query: `screen.getByRole('row', { name: /Inspection 4/ })` → within → getByText('closed').

Hmm — wait, after the bar clears, are there any other 'closed' texts? The status filter's option 'closed' (in the select). Scoped within the row → only the badge. Good.

Also — after the close, `state.activeSessionId` is null. The active query's cache is set to null → the bar is gone (session null → return null). Good.

Now — ordering and mutation safety within the file:

1. all-screens (/orders, s-004): no mutation.
2. deep-link (s-004): no row mutation (GET only).
3. ticking (s-001): no mutation.
4. replace (s-001→s-002): no row mutation.
5. dirty-confirm (s-001→s-002): no server mutation (no save).
6. login: none.
7. pending: none.
8. error+retry: none (the 500 doesn't mutate; the final success GET doesn't mutate either).
9. logout (s-002): none (the logout clears active, but that's state, not a row).
10. close (s-004): mutates s-004 → closed. Last → safe.

But — hmm, tests 4 and 5 both use s-001→s-002; test 5's "leave" with notes — the server's notes are unchanged. Fine.

One more check — test 5: on detail s-001, `session.notes` = 'Awaiting parts.' — the initial notes state = 'Awaiting parts.' Then type 'Deferred...' → notes = 'Awaiting parts.Deferred...'. dirty = true. Good.

Also — the dirty test: after typing, is there any accidental save? No, we don't click save.

Now — a potential gotcha: **the blocker + the bar's close-confirm** — in test 10 (at the list screen), no blocker. Fine.

**Now — does the bar's presence break the existing SessionsListScreen tests?** Separate file, fresh module: `state.activeSessionId` starts null → no bar (GET /active → null → the bar is null). The existing assertions (getByText('Inspection 1'), 'Page 1 of 3') — the bar is absent → no collision.

But wait — in the existing tests, `state.user` is set but `activeSessionId` is null → the /sessions/active handler returns null (200). The bar renders null. No interference. And "Page 1 of 3" — the bar doesn't add text. Good.

**Now — let me verify the `useBlocker` import/behavior once more in test 5**: the detail screen's `useBlocker(dirty)` — in a memory router. When we click the nav link 'Sessions' — the navigation to '/sessions' is initiated → the blocker intercepts → dialog. Click 'Leave' → `blocker.proceed()` → the navigation completes. RTL: `userEvent.click` on the Leave button → state update → the navigation proceeds asynchronously → the list renders. `await screen.findByText(/Page 1 of 3/)` handles the async.

Hmm — actually, one subtlety with `useBlocker`: the block happens when `dirty` is truthy at the moment of navigation. The blocker hook is `useBlocker(dirty)` — dirty is computed each render. After typing, dirty=true is re-rendered. The click → the router checks the blocker's current state. It works — this is the standard v6.4+ blocker API (the repo's react-router-dom ^6.26.2 — yes, useBlocker exists in 6.26; it's in 6.4+? Actually `useBlocker` was added in React Router 6.4? Hmm — useBlocker was introduced in 6.4.0? Let me recall: data routers and useBlocker came in 6.4.0 (October 2022). Yes. 6.26 has it. And the detail screen already uses it in the existing code — so it works in this repo's setup.)

**Now — the "elapsed" tick in test 3**: with real timers, wait up to 3s. OK.

Actually — wait, let me reconsider `within(bar).getByText(/\d+s$/)` in test 3. The `<time>` element's content: e.g., "7589h 12m 34s". The regex `\d+s$` — matches '34s'. But `getByText`'s matching: the default matcher matches the full text content of an element (with normalization). The `<time>`'s text is the whole string; the regex is tested against it → the regex doesn't need to match the full string (regex matchers test via `.test()`... actually, for a regex matcher, Testing Library checks whether the regex matches the normalized text — `stringToMatch.match(regexp)` — partial match is OK). "7589h 12m 34s".match(/\d+s$/) → '34s' at the end → yes.

Any other element in the bar matching /\d+s$/? None (analyzed).

**The `useNow` initial value**: `useState(() => new Date())` — the first render shows the elapsed at mount. Ticks each second. Good.

**StrictMode note**: the app's main.tsx uses StrictMode; tests don't (renderApp has no StrictMode). The setInterval effect: mount → cleanup → mount in dev StrictMode — fine.

**Now — the `useActiveSession` query and the `enabled` option**: consider logout mid-flight: the queryClient.clear() cancels the cache; the component unmounts. No fetch (AppLayout unmounts). OK, no `enabled` needed.

**The error state — `refetch`**: `const { data, isLoading, isError, refetch } = useActiveSession();` — refetch exists on useQuery's result. `onClick={() => void refetch()}`.

Hmm — with `retry: false`, after an error, refetch will try again. Good.

**Accessibility of the elapsed `<time>`**: `<time>{...}</time>` without a datetime attribute — fine.

Now — **is `data-state` needed?** For testability? My tests use role/text. The repo uses data-tone/data-variant for styling hooks. Let me keep `data-state` — harmless and useful for CSS. Actually — "don't create more than the task asks for"... a small data attribute is standard. Keep it minimal: keep `data-state` (it mirrors the repo's data-attribute style).

**CSS**: no CSS file in the workspace? No .css file provided. The app references classes like 'shell', 'active-bar' — probably the styles live elsewhere (not in the provided files — maybe they don't exist at all; the scaffold may rely on default styling). I won't add a CSS file (not shown, not asked).

Now — **deliverable files** (full, complete):

1. `src/features/sessions/queries.ts` (modified)
2. `src/features/sessions/ActiveSessionBar.tsx` (new)
3. `src/app/AppLayout.tsx` (modified)
4. `src/features/sessions/ActiveSessionBar.test.tsx` (new)

Anything else? Let me re-scan the spec:

- "The bar belongs in the layout that already wraps the authenticated screens." → AppLayout. ✓
- "Server state through react-query" ✓
- "Reuse the existing confirm dialog" ✓ (ConfirmDialog)
- "Handle pending and error" ✓
- "Must not regress: list filtering/pagination" — unchanged. "detail editing and the dirty flag warning" — unchanged, tested. "logout clears all state" — tested. "deep-linking" — tested.
- "Tests for the new behavior, in the style the repo already uses" ✓

Now, wait — I should double-check: the spec says "opening a session from the list makes it active" — in the mock, GET detail sets it. The client mirrors it. Also — "opening" via deep-link also makes it active (the same handler). Fine.

One more consideration — **the bar's "Resume" when already on the detail**: no-op. Fine.

**Edge — clicking Resume while the detail is dirty?** Resume navigates to the detail of the same session the user might be on — if the user is on a different screen, no blocker (the blocker is on the detail component; if the user is on the list, there's no dirty). If the user is on the dirty detail of session X and the active is X (typical), Resume → same URL, no navigation. If the user is on the dirty detail of X but the active is Y (they opened Y later? can't — opening Y would leave X's detail... the dirty notes are discarded or saved first). So Resume never triggers a leave of a dirty screen. Fine.

Now, let me also reconsider whether `useSession`'s onSuccess might overwrite the active cache with stale data in this scenario: the user is on B's detail (active B). A is... the only fetch that patches active is a detail fetch. A's detail is fetched only when the user opens A. So no stale overwrite. The only "stale" risk: a refetch of the detail query after 30s while the user stays on the detail — the server re-activates on GET (the mock does) → consistent.

Now — let me write the final files.

Actually, wait — let me reconsider the **`useNow` tick interval and test 3's timing budget**. `waitFor(..., { timeout: 3000, interval: 200 })` — the tick is 1000ms → the text changes within ~1s + render. Fine.

Also — test 3: after `findByRole('region')`, the `within(bar).getByText(/\d+s$/)` — at that point, the region's content: span 'Active session', strong 'Inspection 1', badge 'open', time '...s', buttons. The regex is unique.

Now, let me write the **final version of queries.ts**:

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
      // The server makes the session an operator opens the active one (a
      // closed session is never active). Mirror it into the active cache so
      // the bar tracks the open without an extra round-trip.
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      }
    },
  });
}

/**
 * The active session. The server (`GET /sessions/active`) is the source of
 * truth, so the bar survives a full page refresh; nothing is mirrored in
 * localStorage or any store that outlives the query cache.
 */
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
      // Closing the active session empties the active slot on the server.
      if (qc.getQueryData<Session | null>(sessionKeys.active())?.id === updated.id) {
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

Wait — `sessionKeys.active` was already in the original file (`active: () => ['sessions', 'active'] as const`). Yes, it was there originally. Good — the scaffold pre-wired the key; my `useActiveSession` uses it.

**ActiveSessionBar.tsx** final:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(startedAt: string, now: Date): string {
  let total = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(total / 3600);
  total %= 3600;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`;
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. It lives in AppLayout so it appears on
 * every authenticated screen and nowhere else. The row comes from the server
 * (`GET /sessions/active` via useActiveSession), never from client-only
 * storage, which is what makes it survive a full page refresh.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError, refetch } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useNow(Boolean(session));

  if (isLoading) {
    return (
      <div className="active-bar" data-state="pending" role="status">
        Loading active session…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="active-bar" data-state="error" role="alert">
        Could not load your active session.
        <Button onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }
  if (!session) return null;

  return (
    <section className="active-bar" aria-label="Active session">
      <span>Active session</span>
      <strong>{session.name}</strong>
      <Badge tone={session.status}>{session.status}</Badge>
      <time>{formatElapsed(session.startedAt, now)}</time>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
        Close session
      </Button>

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
    </section>
  );
}
```

Hmm — `useNow(Boolean(session))` — but when `isLoading` or `isError`, session is undefined → disabled. Good.

**AppLayout.tsx** final:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
import { Button } from '../components/ui/Button';

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

Import ordering: the original was `import { Link, Outlet } from 'react-router-dom'; import { Button } from '../components/ui/Button'; import { useAuth } from '../auth/auth-context';` — the ordering is not alphabetical (components before auth). Let me keep the original order and add mine: put the ActiveSessionBar import after useAuth, or group it... let me do:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/Button';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
```

That's a reasonable alphabetical-ish order (react-router-dom, then ../auth, ../components, ../features). The original wasn't strictly alphabetical; mine is cleaner. Fine.

**The test file** — final, let me write it carefully:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

describe('ActiveSessionBar', () => {
  it('shows the active session on every authenticated screen', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('restores the bar from the API after a deep link to a detail URL', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = screen.getByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('ticks the elapsed time', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    const elapsed = within(bar).getByText(/\d+s$/);
    const before = elapsed.textContent;

    await waitFor(() => {
      expect(elapsed.textContent).not.toBe(before);
    }, { timeout: 3000, interval: 100 });
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('confirms before replacing an active session with unsaved notes', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await screen.findByRole('heading', { name: 'Inspection 1' });

    await userEvent.type(screen.getByLabelText('Notes'), 'Deferred to tomorrow');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await screen.findByText(/Page 1 of 3/);

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('closes the active session behind a confirm and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    });

    const row = screen.getByRole('row', { name: /Inspection 4/ });
    expect(within(row).getByText('closed')).toBeInTheDocument();
  });

  it('clears the bar on logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a pending state, not "no active session", while the fetch is in flight', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse>(() => {})));
    renderApp('/sessions');

    await screen.findByText(/loading active session/i);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it('shows a distinct error state and recovers on retry', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    server.use(http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderApp('/sessions');

    await screen.findByText(/could not load your active session/i);
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();

    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });
});
```

Let me scrutinize each test for failure modes:

**Test 1**: renderApp('/orders'). AuthProvider's me → user. AppLayout → the bar (fetches /active → s-004) + the orders list. `findByRole('region')` — the bar loads asynchronously; the region appears when data arrives. The name 'Inspection 4' is unique within the bar. The badge 'open' — wait, the orders screen has status badges: pending/approved/rejected/cancelled — no 'open'. And I scope within the bar anyway. The Resume button is present. ✓

Wait — one thing: the orders list's first page has 10 orders; none of their names match. ✓

**Test 2**: deep-link. `findByRole('heading', { name: 'Inspection 4' })` — the h1. Then `getByRole('region')` — synchronous? The bar's data: /active is fetched in parallel; by the time the h1 appears, has the bar's data arrived? Not necessarily — two parallel fetches; the region might appear slightly after the heading. `screen.getByRole` (synchronous) might fail if the bar's data hasn't landed. Use `findByRole` instead. Let me use `await screen.findByRole('region', ...)`. ✓ (Change to findByRole.)

**Test 3**: `getByText(/\d+s$/)` — hmm, wait: what if the elapsed format has no seconds?? It always has `ss`. ✓. Also — the `elapsed.textContent` — `<time>` has a single text node. ✓. waitFor 3s — the tick is 1s. ✓.

Actually wait, one more check on test 3: `within(bar).getByText(/\d+s$/)` — could the regex match the badge?? 'open' has no digits. The name 'Inspection 1' — the normalized text "Inspection 1" — match(/\d+s$/) requires a terminal 's' after a digit: "1" is the terminal, no 's' after. ✓. 'Active session' span — 'n'. ✓.

**Test 4**: `within(bar).getByText('Inspection 1')` — the bar's strong. The list also has 'Inspection 1' but scoped. ✓. Then click link 'Inspection 2' → navigate → detail fetch → onSuccess patches active → bar re-renders. waitFor. ✓.

Hmm — wait: when navigating from the list to detail, the list's `useSessions` query stays cached; the detail screen mounts. The bar persists. ✓.

**Test 5**:
- `findByRole('region')` first — the bar appears (the active s-001 was fetched).
- `findByRole('heading', { name: 'Inspection 1' })` — the h1.
- Type in the textarea: `getByLabelText('Notes')` — hmm! The bar doesn't contain a 'Notes' label. The detail screen's label. Unique. ✓.
- Click the nav link 'Sessions' → blocker dialog.
- `findByRole('dialog', { name: 'Leave with unsaved notes?' })`. ✓.
- Click 'Leave' → proceed → the list.
- `findByText(/Page 1 of 3/)`. ✓.
- Click link 'Inspection 2' → detail → bar patches to 'Inspection 2'. waitFor within(bar). ✓.

Potential issue: after typing in the textarea, the nav link click — userEvent.click on an `<a>` with a router Link → navigation. The blocker intercepts. Dialog appears. All within the detail screen's render. Then Leave → the router proceeds. The list renders.

One risk: `userEvent.type` is async — with the static API `userEvent.type(element, text)`, it returns a promise; await it. ✓.

Another risk: does the detail screen's h1 appear before the bar's region? Both parallel; I await both separately. ✓.

**Test 6 (close)**: the bar's 'Close session' — at the list screen, is there another 'Close session' button? No (only on the detail). But the dialog's confirm is also 'Close session' — at the moment I click the bar's button, the dialog isn't open. `within(bar).getByRole('button', { name: 'Close session' })` is scoped anyway. ✓.

Dialog appears: `findByRole('dialog', { name: 'Close this session?' })`. The confirm button within the dialog: name 'Close session' (confirmLabel). `within(dialog).getByRole('button', { name: 'Close session' })` — the dialog also has a 'Cancel' button; 'Close session' is unique within the dialog. ✓.

After confirm: the mutation POST /close → 200 → onSuccess patches: the detail cache (not present — we didn't open the s-004 detail... `setQueryData(detail s-004, updated)` creates a cache entry — fine), patchLists (s-004 is in the list's page 1 → row → closed), active: cache is s-004 → set to null. Bar unmounts (region gone). ✓.

Then the row: `getByRole('row', { name: /Inspection 4/ })` — the row's accessible name: the cells are "Inspection 4" (the link's text), "Ada", "closed" → name ≈ "Inspection 4 Ada closed". The regex matches. `within(row).getByText('closed')` — the badge. ✓.

Wait — the operator for s-004: i=3 → ['Ada','Grace','Alan'][3%3=0] → 'Ada'. Fine, irrelevant.

**Test 7 (logout)**: the bar's region, click 'Log out' → api.logout (mock clears user + active) → setUser(null) → queryClient.clear() → RequireAuth navigates to /login → LoginScreen. `findByRole('button', { name: 'Sign in' })`. Then no region. ✓.

Hmm — LoginScreen's 'Sign in' — the button's text. ✓.

Potential timing: after the click, the mutation completes asynchronously. findByRole waits. ✓.

**Test 8 (login screen)**: state.user null. renderApp('/sessions') → RequireAuth: loading (me in flight) → 401 → user null → Navigate /login (state.from). LoginScreen. `findByRole('button', { name: 'Sign in' })`. No region. ✓.

But — `state.activeSessionId = 's-004'` — does anything fetch /sessions/active? AppLayout doesn't render. The bar doesn't exist. ✓. And the never-fired /api/sessions/active — fine, no unhandled requests.

Wait — actually, in test 8, is there an unhandled request issue? `onUnhandledRequest: 'error'` — only /api/auth/me is fired. Handled. ✓.

**Test 9 (pending)**: the handler never resolves. renderApp('/sessions'). The list query resolves → 'Page 1 of 3'. The bar: isLoading → "Loading active session…". `findByText(/loading active session/i)` — my text: "Loading active session…" ✓. The list is present ✓.

Hmm — the never-resolving promise: vitest's teardown — the hanging request might cause an "open handle" warning? MSW's node server... the promise is never resolved; the test finishes; jsdom unmounts; react-query's query is cancelled (the client is garbage-collected). Possible warning, not a failure. Acceptable. Alternatively, resolve it after the assertion: `await new Promise(r => setTimeout(r, 50))`? The handler's promise is still hanging. It's fine — msw handles abandoned requests; the server.resetHandlers() in afterEach cleans up. I've seen this pattern used. OK.

Actually — a safer alternative for pending: delay the response by, say, 500ms:

```tsx
server.use(
  http.get('/api/sessions/active', async () => {
    await new Promise((r) => setTimeout(r, 500));
    return HttpResponse.json(null);
  }),
);
```

But then the bar would show 'Inspection...' after 500ms — my assertion must happen within 500ms — a race with the list load... risky. The never-resolving promise is the deterministic choice. Keep the never-resolving.

**Test 10 (error + retry)**: the 500 handler. The bar: isError → error text + Retry. `findByText(/could not load your active session/i)` — my text "Could not load your active session." ✓. No region ✓ (the region only exists when data is non-null).

`server.resetHandlers()` — restores the original handlers. Click Retry → refetch → 200 s-004 → region 'Inspection 4'. ✓.

Wait — after the 500, the query's state: error. refetch() → fetches → success → data s-004. The region appears. ✓.

Now — one more concern across the file: **the module state `state` and `sessions` array persist across tests in the file** (same module instance). Test 6 (close) mutates s-004 → closed, activeSessionId → null. Test 6 is... in my ordering: the close test is #6 (I listed 'closes...' as the 6th). After it, the subsequent tests: logout (s-002 — open ✓), login (s-004 — but the bar doesn't render, irrelevant), pending (active null ✓), error (sets s-004 again — wait, the error test sets `state.activeSessionId = 's-004'` — but s-004 is now closed (status) after the close test! The /sessions/active handler: `sessions.find(x => x.id === 's-004')` → returns the row (status 'closed'). The bar would show 'Inspection 4' with a 'closed' badge. My assertion: `within(bar).getByText('Inspection 4')` — still passes. OK, fine. But the 'open' assertion? I don't assert status in the error test. ✓.

Hmm, but wait — order: I listed the error test after the close test. Let me re-check the final ordering and re-verify each test's data assumptions:

1. all-screens: s-004 open ✓ (before close).
2. deep-link: s-004 ✓.
3. ticking: s-001 ✓.
4. replace: s-001 → s-002 ✓ (both open; s-002 paused but open-ish, not closed).
5. dirty-confirm: s-001 (open ✓), s-002 ✓.
6. close: s-004 → becomes closed. Mutates.
7. logout: s-002 ✓ (still open).
8. login: no bar.
9. pending: active null.
10. error+retry: s-004 (now closed) — the bar shows it; I only assert the name. Acceptable... but a bit icky: the "source of truth" test showing a closed session as active. The server state (the mock) allows a closed session to be "active" if I set activeSessionId to a closed id (the find doesn't check status). It's a mock artifact. To keep it clean, use 's-001' in the error test (still open ✓).

Let me set the error test's active to 's-001' and assert 'Inspection 1'.

Also the pending test: activeSessionId = null → fine.

And the logout test s-002: after test 4/5, activeSessionId is s-002 (test 5 ends with s-002 active) — I set it explicitly anyway.

One more: **test 2's deep-link with the bar** — both fetches; I use findByRole for both. ✓.

**Check: any test where the bar's region query collides with something else having role region?** A `<section>` without an aria-label → role 'section'? A `<section>` without an accessible name has no landmark role (generic). The detail screen's `<section>` (no aria-label) → not a region. ✓. Only the bar's section has an aria-label.

**The `row` role query**: a table row → role 'row'. ✓.

**Now — `getByRole('heading', { name: 'Inspection 1' })` in test 5**: the h1's text. ✓. But the bar's `<strong>` is not a heading. ✓.

**The `getByLabelText('Notes')`**: the `<label>Notes<textarea></textarea></label>` — the textarea's accessible name 'Notes'. ✓. Any other element labeled Notes? None.

**Now — userEvent static API deprecation**: the repo uses `userEvent.click` (static). v14's static API works (with console warnings in some versions). The existing tests use it, so the repo tolerates it. Follow.

**One more design question**: should the bar's query `useActiveSession` have `refetchOnMount: 'always'` or a shorter staleTime, to avoid a stale bar after long periods? For example: the operator opens A, leaves the tab for an hour, and comes back — the staleTime is 30s but refetchOnWindowFocus is false; the bar shows A from the cache — but the server's active is still A (single user) — correct. If the session was closed by the system... out of scope. Keep the defaults.

**Now — the acceptance: "The bar appears on every authenticated screen and nowhere else."** The orders screens (list + detail) also get the bar via AppLayout. ✓. The login: not. ✓.

**Let me reconsider the "close" confirm's body**: "Closing is final." — the detail's dialog says "Closing is final. Unsaved notes will be lost." The bar's dialog can't know about unsaved notes (they're in the detail component, and we don't have a second source of truth). But — hmm, actually, if the user is on the detail screen of the active session with dirty notes, and closes via the bar, the unsaved notes are lost without a warning specific to the notes. Is that a regression against "detail editing and the dirty flag warning on route change"? The dirty warning is about route changes, not about closing. Closing from the detail screen has the existing dialog that warns about notes. Closing from the bar while on that detail: the notes are silently lost...

Hmm. Can I do better without a second source of truth? Options: the bar's close confirm body is generic; the detail screen's close confirm is specific. The spec says reuse the existing confirm dialog (the component), and the body text can differ. I think the generic "Closing is final." is fine and honest. The spec doesn't require the notes warning in the bar's dialog. Keep it.

Actually — hmm, wait. Let me reconsider: maybe the bar's close confirm should mirror the detail's body exactly: "Closing is final. Unsaved notes will be lost."? That would be a true warning in the worst case (on the detail with dirty notes). But it would be a false claim when there are no unsaved notes (e.g., closing from the orders screen). Which is worse? A false claim of "unsaved notes will be lost" when there are none is misleading. The generic one is safer. Keep "Closing is final."

**Let me now re-verify the `useSession` change doesn't break the deep-link / "session not found" path**: 404 → the query errors → the screen shows "Session not found." — onSuccess doesn't fire. ✓.

**`noUnusedLocals`** — make sure there are no unused imports. In the test file: I import `waitFor`, `within`, `screen`, `userEvent`, `describe/expect/it`, `state`, `server`, `http, HttpResponse`, `renderApp`. All used. ✓.

In ActiveSessionBar: `useEffect, useState` ✓, `useNavigate` ✓, `Badge` ✓, `Button` ✓, `ConfirmDialog` ✓, `useActiveSession, useCloseSession` ✓.

**TS strictness**: `elapsed.textContent` — string | null; comparing with `.not.toBe(before)` is fine.

`within(bar).getByText(/\d+s$/)` — returns a HTMLElement. ✓.

The pending handler's `new Promise<HttpResponse>(() => {})` — the http.get resolver signature: `(info) => MSWResponse | Promise<MSWResponse>`. `new Promise<HttpResponse>(() => {})` — HttpResponse is a subclass of Response; MSWResponse = Response | ... it's fine.

**`server.use` with a handler that returns a never-resolving promise** — TS: the `http.get(path, resolver)` type: the resolver can return `Promise<Response>`. OK.

**Let me verify the `renderApp` path for '/orders'**: the route exists ✓.

**Potential issue — the bar + the list test's `getByText(/Page 1 of 3/)`:** the bar doesn't add a page text. ✓.

**Now — the existing SessionsListScreen.test.tsx must pass unmodified.** My changes: queries.ts (adding a hook + the onSuccess on useSession + the close's onSuccess) — the list screen doesn't use useSession; no close in that test. The bar now renders in AppLayout during those tests: `state.activeSessionId` is null (module fresh for that file) → /active → null → the bar returns null. No new text. ✓. But wait — does the bar's query cause an extra unhandled request? /api/sessions/active is handled. ✓. And `state.user` is set → authed → 200 null. ✓.

**Another subtle check — the existing test 'filters by status'**: `selectOptions(..., 'closed')` → list of closed sessions: s-003, s-006, ... 'Inspection 1' is not present. The bar: active null → absent. `queryByText('Inspection 1')` is null ✓.

**The deep-link test and the "Session not found"**: not tested; fine.

Now — **is there a scenario where `useSession.onSuccess`'s patch to the active cache conflicts with a legitimate `null`?** E.g., the user has no active, opens A → active A. Closes A → null. Navigates to B (closed) → no patch. Bar empty. ✓.

**The StrictMode double-fetch in dev**: the detail fetches twice? react-query deduplicates the in-flight; onSuccess fires once per fetch completion... in StrictMode dev, the component mounts twice → two useQuery subscriptions to the same key → one fetch (deduped) → onSuccess once. ✓.

**Now — let me consider whether I should also update the `SessionDetailScreen`.** The spec: "the detail screen already tracks a dirty flag; use it rather than adding a second source of truth" — no changes needed there. The close button is already there. The dirty blocker is already there. ✓ — I don't touch it (and don't re-deliver it).

**The deliverable list** (only files I change/create):
1. `src/features/sessions/queries.ts`
2. `src/features/sessions/ActiveSessionBar.tsx`
3. `src/features/sessions/ActiveSessionBar.test.tsx`
4. `src/app/AppLayout.tsx`

Wait — the format requires "all files the solution needs, in full." For a coherent edit, that means the modified files in full + the new files. Files I don't touch are not re-stated. ✓.

Hmm — but wait, should I double-check that no `vitest.config` change is needed? The vite.config has the test section; the existing tests work. My tests use the same setup. ✓.

Let me reconsider **test 3 (ticking) with real timers once more**. jsdom + setInterval(1000). The bar mounts at t0 with now=t0. At t0+1000, setNow → re-render → the seconds increment by 1 (or 2 if the render was late — the text still differs). waitFor polls `elapsed.textContent !== before`. The `elapsed` element — `<time>` persists across re-renders (same element position). ✓. Timeout 3000, interval 100 → about 30 polls. ✓.

But — hmm, one flake risk: `before` is captured right after `getByText`; if the first tick fires between the capture and the waitFor... the text differs → the first poll passes. Fine.

Another risk: the test environment's clock vs Date.parse — irrelevant.

**Let me also reconsider whether `useNow` should tick when the session is paused** — "an elapsed time that ticks" — yes, always tick while the session is shown. ✓.

**The formatting choice**: for s-001 (started 2024-04-01), the elapsed ~ over 8000 hours → "8023h 12m 05s" — long but fine.

Now — **the `role="alert"` / `role="status"` div**: `findByText(/loading active session/i)` — the text inside the role=status div. ✓.

**Error text**: "Could not load your active session." + the Retry button. My regex `/could not load your active session/i` ✓.

**One more consideration — the "pending" text and the app's other loading texts**: the detail/list screens show "Loading…" — different. My bar's pending text is distinct. In test 9 (pending), the list loads normally; the "Loading…" (list) is already replaced. `findByText(/loading active session/i)` is unique. ✓.

**Now, let me write the final files.**

Actually — wait, one more thing to double-check: **`useQuery`'s `onSuccess` in react-query v5** — let me be really sure. The v5 `useQuery` options... I recall the v5 migration guide; `onSuccess`/`onError`/`onSettled` are still valid options on `useQuery` in v5 (they're part of the query's "data callbacks"). Yes — the v5 reference for useQuery lists `onError`, `onSuccess`, `onSettled`. I'm confident.

If I wanted to be even safer, I could avoid onSuccess and instead do the active patch in the component's `useEffect` on session data — but that's less clean. Or, a custom approach: keep `useSession` pure and add the patch where... no, onSuccess is the right tool and it's supported. Keep it.

Alternatively — actually, you know what, there's an even more idiomatic option that some apps use: have the detail screen trigger `qc.setQueryData` — no. Keep onSuccess in the hook.

**Also — the `sessionKeys.active()` key**: `['sessions', 'active']`. `getQueryData(sessionKeys.active())` — key type: readonly ['sessions','active'] ✓.

**The `setQueryData(sessionKeys.active(), session)` type inference**: the generic is inferred from the key? `setQueryData<TQueryData>(key, updater)` — passing `session` (Session) → TQueryData = Session. Later `getQueryData<Session | null>` — hmm, the cache entry's type... setQueryData without an explicit generic infers from the argument: the first call sets Session; the query's defined type via useActiveSession's queryFn → `Session | null` (api.getActiveSession returns `Session | null`). QueryClient's setQueryData is lenient. `qc.setQueryData(sessionKeys.active(), session)` — fine. `qc.setQueryData(sessionKeys.active(), null)` — fine. `qc.getQueryData<Session | null>(sessionKeys.active())` — fine.

TS strict: `session.status !== 'closed'` — narrowing the SessionStatus union ✓.

**The `formatElapsed` with Date.parse(startedAt)** — an ISO string ✓.

Let me also add a short comment in the bar about why we don't persist. Keep the comments tight.

**Final check on the AppLayout comment** — keep the original doc comment (it fits).

**Now, let me reconsider the test file name/location**: `src/features/sessions/ActiveSessionBar.test.tsx` — matches the pattern of `src/features/sessions/SessionsListScreen.test.tsx` (co-located, `X.test.tsx`). ✓. (The system conventions mention `test/<feature>.spec.ts`, but the actual repo co-locates `.test.tsx` — the repo's style wins; "tests in the style the repo already uses.")

**Let me write it all out.**

One more pass on the close test: after the bar clears, `screen.getByRole('row', { name: /Inspection 4/ })` — hmm, the row's accessible name computation: does Testing Library compute the name from the cell contents including the link's text? A row's name is from the concatenation of descendant text (the row isn't a "name from author" role; it falls back to content text). "Inspection 4" + "Ada" + "closed" → "Inspection 4 Ada closed". The regex /Inspection 4/ ✓.

Also — after the close, the bar is gone, so 'Inspection 4' appears only in the row (+ the select? no — the session status select has options 'open/paused/closed', not names). ✓.

And the `within(row).getByText('closed')` — the badge's text 'closed'. The row also has... only the badge. ✓.

**Also — hmm, `getByRole('row')` — table rows have role 'row' ✓.**

**The login test's `state.user = null`** — but the previous test set user; the module state persists; set it explicitly ✓.

**The logout test** — after it, state.user is null (the mock's logout). The subsequent tests (login, pending, error) set user explicitly ✓ (pending and error set OPERATOR; the login test sets null ✓).

**Test ordering in the file** — let me fix the order:
1. shows the active session on every authenticated screen
2. restores the bar from the API after a deep link to a detail URL
3. ticks the elapsed time
4. replaces the active session when another one is opened
5. confirms before replacing an active session with unsaved notes
6. closes the active session behind a confirm and empties the bar (mutates s-004)
7. clears the bar on logout (s-002)
8. does not render the bar on the login screen
9. shows a pending state...
10. shows a distinct error state and recovers on retry (s-001 — still open ✓)

Wait — test 7 (logout) uses s-002: after test 5, s-002 is active; fine. And s-002 is open (paused, not closed) ✓.

Hmm, test 10 uses s-001 — still open ✓ (never closed).

Actually, wait — in test 6 (close), before the close, the bar shows 'Inspection 4' AND the list row 'Inspection 4' is present (page 1). `within(bar).getByRole('button', {name: 'Close session'})` is scoped ✓. After the close, the row shows closed ✓.

**Also — in test 6, is there an 'Inspection 4' in the bar and a 'Inspection 4' link in the row — I don't query those texts outside of scope. ✓.**

**Let me verify test 4 once more — `getByRole('link', { name: 'Inspection 2' })`:** the list page 1's rows s-001..s-010 → the link names 'Inspection 1'..'Inspection 10'. 'Inspection 2' is unique ✓. (No other 'Inspection 2' link — the bar has a Resume button, not a link.) ✓.

**Test 5 — after leaving to the list, click 'Inspection 2' again** ✓.

**Now — one thing I want to re-verify: the `useBlocker` + memory router + `userEvent.click` on a nav Link.** The nav link is a `<Link to="/sessions">` — a router navigation. The blocker (active, dirty) intercepts. The dialog renders. This is exactly the documented useBlocker pattern. ✓.

But — hmm, actually there's a subtle thing about `useBlocker`: when `dirty` is false and then becomes true... the blocker hook re-evaluates. The block decision happens at navigation time based on the current blocker function. `useBlocker(dirty)` — the argument is a boolean → internally a function that returns the boolean. At the click moment, dirty=true → block. ✓.

**And after `blocker.proceed()`, the navigation to /sessions completes; the detail unmounts.** ✓.

I think the solution is solid. Let me also reconsider whether I need `void` on the refetch: `onClick={() => void refetch()}` — refetch returns a Promise; the repo's style uses `void logout()` — consistent. ✓.

**The `useNow` disabled path**: returns a static now; the effect cleans up. When session appears → the effect starts the interval. ✓.

Edge — the bar shows a session, `useNow(true)`; the interval is 1s; on unmount (logout) the cleanup ✓.

**Let me write the final files.**

Also — do I need to include the `describe` block name? "ActiveSessionBar" ✓.

Let me also double-check the imports for `within` — from @testing-library/react ✓.

And — `import { http, HttpResponse } from 'msw';` — msw v2 exports both ✓ (handlers.ts uses `HttpResponse, http`).

Now, one final concern about **test 9 (pending)**: `server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse>(() => {})))` — msw v2's resolver type: `Resolver` = (info) => Response | Promise<Response> | void... returning `Promise<HttpResponse>` ✓. TS: `new Promise<HttpResponse>(() => {})` ✓.

And in test 9, the list renders — assert `getByText(/Page 1 of 3/)` — the list's fetch is normal ✓.

Hmm — also in test 9, `state.activeSessionId = null` — the default anyway; set explicitly for clarity.

**Also, should the pending test assert that the empty state ("no active session") is not shown?** My pending text is distinct; the assertion on the pending text suffices (the empty state renders nothing anyway). The error test asserts no region (which would be the "no active session" equivalent... well, the empty renders nothing). The spec: "a failed fetch must not render as 'no active session'" — since there's no explicit "no active session" UI, the distinct error text + no bar IS the distinction. My tests capture that. ✓.

I'm confident. Let me write out the four files.

Actually — let me reconsider once more whether the "Resume" button should be `variant="primary"`. The bar: primary for Resume, danger for Close — matches the app's semantics (primary = the main action). Fine.

And — the bar's markup: `<span>Active session</span><strong>name</strong><Badge/><time/><Button/><Button/>` — reasonable.

Also, the aria-label 'Active session' on the section AND a visible span 'Active session' — fine (redundant, but the label makes the region queryable; the visible text is nice for the operator).

Wait — the accessible name computation: aria-label wins. ✓.

Final: let me write it.

Actually, one more idea to double-check — **the `renderApp` for '/sessions/s-001' in test 5**: the detail screen's initial notes = 'Awaiting parts.' (s-001's notes). Type appends. dirty ✓.

And — `getByLabelText('Notes')` — the label contains the text 'Notes' + the textarea. The textarea's name 'Notes' ✓.

Let me also make sure there are no other elements with the accessible name 'Notes' — none.

OK. Also, the `userEvent.type` static — `await userEvent.type(el, 'text')` ✓.

Now, let me generate the final answer in the required format: a `### path` heading + a fenced block per file, nothing else.

File 1: src/features/sessions/queries.ts
File 2: src/features/sessions/ActiveSessionBar.tsx
File 3: src/app/AppLayout.tsx
File 4: src/features/sessions/ActiveSessionBar.test.tsx

Let me finalize the code text, watching for TS strictness and the repo's style (2-space indent, single quotes, semicolons, trailing commas in multiline).

In the test file, `const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };` — the state.user type: `{ id: string; name: string; roles: string[] } | null` ✓.

Test 3: `const before = elapsed.textContent;` — string | null. `expect(elapsed.textContent).not.toBe(before)` ✓.

All set. Let me write it out.
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

export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (session) => {
      // The server makes the session an operator opens the active one (a
      // closed session never becomes active). Mirror that into the active
      // cache so the bar follows the open without an extra round-trip.
      if (session.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), session);
      }
    },
  });
}

/**
 * The active session. `GET /sessions/active` is the source of truth, which is
 * why the bar survives a full page refresh; nothing about it is mirrored into
 * localStorage or any store that outlives the query cache.
 */
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
      // Closing the active session empties the active slot on the server;
      // closing any other session leaves it untouched.
      if (qc.getQueryData<Session | null>(sessionKeys.active())?.id === updated.id) {
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
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(startedAt: string, now: Date): string {
  let total = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(total / 3600);
  total %= 3600;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`;
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. It lives in AppLayout so it appears on
 * every authenticated screen and nowhere else. The row comes from the server
 * (`GET /sessions/active` via useActiveSession), so a full page refresh
 * restores it and nothing client-only is trusted for this fact.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError, refetch } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useNow(Boolean(session));

  if (isLoading) {
    return (
      <div className="active-bar" data-state="pending" role="status">
        Loading active session…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="active-bar" data-state="error" role="alert">
        Could not load your active session.
        <Button onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }
  if (!session) return null;

  return (
    <section className="active-bar" aria-label="Active session">
      <span>Active session</span>
      <strong>{session.name}</strong>
      <Badge tone={session.status}>{session.status}</Badge>
      <time>{formatElapsed(session.startedAt, now)}</time>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
        Close session
      </Button>

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
    </section>
  );
}
```

### src/app/AppLayout.tsx
```tsx
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/Button';
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

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

describe('ActiveSessionBar', () => {
  it('shows the active session on every authenticated screen', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('restores the bar from the API after a deep link to a detail URL', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('ticks the elapsed time', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    const elapsed = within(bar).getByText(/\d+s$/);
    const before = elapsed.textContent;

    await waitFor(
      () => {
        expect(elapsed.textContent).not.toBe(before);
      },
      { timeout: 3000, interval: 100 },
    );
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('confirms before replacing an active session that has unsaved notes', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await screen.findByRole('heading', { name: 'Inspection 1' });

    await userEvent.type(screen.getByLabelText('Notes'), 'Deferred to tomorrow');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await screen.findByText(/Page 1 of 3/);

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('closes the active session behind a confirm and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    });

    const row = screen.getByRole('row', { name: /Inspection 4/ });
    expect(within(row).getByText('closed')).toBeInTheDocument();
  });

  it('clears the bar on logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a pending state, not "no active session", while the fetch is in flight', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse>(() => {})));
    renderApp('/sessions');

    await screen.findByText(/loading active session/i);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it('shows a distinct error state and recovers on retry', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText(/could not load your active session/i);
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();

    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });
});
```
