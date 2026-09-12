# Transcript — 10-adapt-existing-screen / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let's analyze the task.

Variant A — a persistent active-session bar in a back-office:

1. Opening a session from the list makes it the active session. The bar shows its key fields (name, status, elapsed time ticking) on all screens.
2. The bar offers "Resume" (navigates to the detail) and "Close session" (calls the existing close endpoint, with confirmation. On success the bar becomes empty).
3. Only one active session at a time. Opening another one replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag).
4. The active session must survive a full page refresh (the API exposes `GET /sessions/active`. Use it as the source of truth — don't use client-only persistence for server-side facts).

Existing behaviors that must not regress:
- List filtering/pagination
- Detail editing + dirty-flag warning on route change
- Logout clearing all state
- Direct deep-linking to the detail URL

Deliver the edits as a consistent diff + tests in the app's style.

Key observations from the scaffold:

- The mock `GET /api/sessions/:id` handler sets `state.activeSessionId` when the session is opened (if not closed). That is, "opening" = fetching detail. So the server-side fact: GET detail makes it active.
- `GET /api/sessions/active` returns the session if any.
- `POST /api/sessions/:id/close` sets `state.activeSessionId = null` if that was the active one.
- `POST /api/auth/logout` also clears `state.activeSessionId`.
- `sessionKeys.active = () => ['sessions', 'active']` is already defined in queries.ts — so the intended design is to add `useActiveSession()` there.

Design:

1. Add a `useActiveSession()` query in `src/features/sessions/queries.ts`:
```ts
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
    enabled: ... // only when authenticated?
  });
}
```

Wait — the bar is "shown on every authenticated screen." The `AppLayout` is only rendered for authenticated routes (inside RequireAuth). But during `loading` (before `me()` resolves) the layout isn't rendered, so the bar query won't run then. Actually, the `enabled` gating: `useAuth().user` — but the bar only exists under AppLayout which is already gated. Still, it might be nice to have `enabled: !!user` to avoid the query firing during the logout transition… Actually, logout calls `queryClient.clear()`, so the active session data gets cleared. Fine.

But there's a subtle point: after logout, the user is redirected to /login. The bar lives in AppLayout which only renders under RequireAuth, so no problem.

However, when the user logs out while on an authenticated screen: `logout()` clears the query client. The active query data is cleared. Then `RequireAuth` redirects to /login. AppLayout unmounts. Good — "logout clearing all state" is preserved by the existing `queryClient.clear()`.

2. Where does the active query get fetched? The `ActiveSessionBar` component in AppLayout calls `useActiveSession()`. The bar shows on all authenticated screens because it's in the AppLayout above the Outlet.

When opening a session from the list: the detail screen calls `useSession(id)` → `GET /sessions/:id` → mock sets `state.activeSessionId`. But the cached active query still holds stale data (null). So we need to update the active cache after opening the detail. Options:
- `useSession` mutation-like side effect: after fetching the session, `qc.setQueryData(sessionKeys.active(), session)`. But `useSession` is a query, not a mutation. Hmm.
- Alternative: `useSession(id, { setActive: true })` — on success set active. Can be done in `SessionDetailScreen` with `useEffect`: when session loads, set the active cache to session (server already marked it active).
- Or a refetch of the active query: `qc.invalidateQueries({ queryKey: sessionKeys.active() })` after detail fetch.

The app's style prefers targeted updates over invalidation ("write the returned row directly into the cache holding it. Anything else that needs this action should reuse this, not re-invalidate the list."). So the consistent pattern is: `qc.setQueryData(sessionKeys.active(), session)`.

But wait — the server only sets active if the session isn't closed: `state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;`. So we should only set active when `session.status !== 'closed'`. Actually, hmm — if the session is closed, the server doesn't change the active. So the client shouldn't either. Let's only write to the active cache when the fetched session is not closed.

Deep-linking to detail: same path — detail fetch → mark active. Good, "deep-linking directly to the detail URL" still works, and the session becomes active too, which matches "opening a session… makes it the active session" (the mock handler models "open" as the detail GET).

3. Replacement with confirmation if the current one has unsaved notes: "Opening another one replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

Interesting. The dirty flag lives in `SessionDetailScreen` (local state). The "opening another" flow happens on the list screen (navigating to another detail) or from the detail screen (navigating to another session — e.g., via the list, or… on the detail screen there's no link to other sessions). So the confirmation needs to be at a place that can know the dirty flag.

How do we know from the list screen that the detail screen has unsaved notes? The dirty flag is local to the detail component. We need to share it. Options:

a) A small module-level store/context: "dirty session" registry. The detail screen registers `dirty: boolean` on a shared context (or a small external store). The list screen (or wherever the "open" action is) consults it before navigating.

b) Since only the detail screen edits notes, the dirty state only exists while on the detail screen. "Opening another session" from the detail screen: how does the operator do that? From the detail screen they'd navigate… the detail screen has no nav to the list besides the header nav ("Sessions" link). Clicking "Sessions" in the header nav triggers the existing `useBlocker(dirty)` — the "Leave with unsaved notes?" dialog. So the blocker already handles leaving the detail with unsaved notes.

Hmm, then when does "confirm if the current one has unsaved notes" on replacement kick in? Scenario: operator is on the detail screen with unsaved notes, clicks "Sessions" (or the bar's… no, the bar only shows resume). The blocker dialog appears: "Leave with unsaved notes?" — confirm → proceed to list. Then click another session → open detail → replace active.

But requirement 3 says replacement happens "with confirmation if the current one has unsaved notes." So the confirmation is exactly the dirty-flag warning. Since the existing blocker already warns on leaving the detail, maybe the requirement is just to ensure the existing blocker still works and that opening another session (after leaving) replaces the active without extra steps.

But there's a subtler scenario: the operator is on the detail screen with unsaved notes, and the bar… no, the bar's resume just navigates to the same detail.

Or: the operator is on the detail screen with unsaved notes and clicks another session — but there are no other session links on the detail screen.

Or: from the list screen, active session A is open (in cache), and the user clicks session B. If the user had unsaved notes on A… but they're no longer on A's screen (they're on the list), so the dirty state is gone (if they left without saving, the blocker's proceed discarded the draft — component unmounts). So no confirmation needed from the list.

Hmm wait — actually there is one path: from the detail screen, the blocker only triggers on navigation within the router. Let's think about what "confirm if the current one has unsaved notes" is practically asking for. I think the intended implementation is:

- The replacement logic lives in a shared place (the context/store for active session) that also knows whether the detail screen has unsaved notes.
- When trying to activate a new session while the currently active one has unsaved notes (dirty on the detail), show the ConfirmDialog before replacing.

The cleanest, app-consistent approach: extend a small "session" context/store. Actually let's reconsider: the dirty flag only exists on the detail screen, and the only way to open another session while on the detail screen is to leave the detail screen (which triggers the existing blocker)…

Except: what about the "Sessions" nav link + blocker: confirm "Leave" → proceed. Then user is on the list. Draft discarded. Active session A is still active. Click session B → detail fetch → server marks B active → we update the active cache → bar shows B. No notes unsaved at that moment (draft was discarded when leaving). Fine.

So actually, thanks to the existing blocker, the "with confirmation if the current one has unsaved notes" is naturally satisfied by the existing dirty-flag warning on route change. The requirement says "the detail screen already tracks a dirty flag" — meaning don't build a new mechanism. Reuse/ensure the existing one gates the replacement.

Hmm, but wait. Is there a case where we open another session without a route change? No — the "resume" in the bar navigates to detail. Opening is always via the list (route change) or deep-link (full load, no dirty state).

Wait, actually one more: from the detail screen of session A (dirty), the operator could use browser back/forward or the nav. All route changes → blocker. OK.

So the design is:
1. `useActiveSession()` query + `ActiveSessionBar` in AppLayout.
2. When `SessionDetailScreen` fetches a session (any open), update the active cache to that session (if not closed) — via a shared helper `setActive(qc, session)` or by invalidating the active query. Following the app style, targeted `setQueryData`.
3. On close success (both detail's close and the bar's close), if the closed session was active, empty the active cache. The `useCloseSession` mutation's `onSuccess` should handle this: `if (qc.getQueryData(sessionKeys.active())?.id === updated.id) qc.setQueryData(sessionKeys.active(), null);`. Or simply `qc.setQueryData(sessionKeys.active(), null)` — but that's wrong if a different session is active (can't happen: close only affects that session. Server only clears active if it's the active one. Client-side: if the active cache is a different session, closing this session shouldn't clear the bar). Hmm, but can the active be a different session than the one closed? Yes: session A is active. User opens B's detail — wait, opening B makes B active (server). Then close A from A's detail → server keeps active = B. So client must only clear active cache when the closed id matches the active id. Let's implement that check.

Also, the server's `GET /sessions/:id` doesn't change active for closed sessions. So in the detail screen, if a closed session is fetched, don't set it as active.

4. Elapsed time ticking: the bar shows elapsed time from `startedAt`, ticking (e.g., updating every second). For a closed session, elapsed = closedAt - startedAt (static). Implement a small `useElapsed(startedAt, closedAt)` hook, or inline into the bar with a 1-second `setInterval` via `useState`/`useEffect`. Format like `2h 05m 12s`, or mm:ss? Session is multi-day (April 2024), so format `2d 4h 12m`, or just `Xm Ys`? Let's do a compact human format: days/hours/minutes/seconds as available. Ticking every second.

Actually, in tests, time ticking: we can use fake timers to assert the text changes. Testing-library + vitest: `vi.useFakeTimers()`, advance, assert new text. The bar query fetch needs to resolve first, then tick. Manageable: await the bar showing the initial elapsed, `vi.advanceTimersByTime(1000)`, assert updated text. But mixing MSW (real promise microtasks) with fake timers works — fetch resolves via microtask, not real time, so fake timers are fine. But `await waitFor` uses timers… with fake timers `waitFor` needs `advanceTimers` or the asyncWrapper. Simpler: `vi.useFakeTimers()`, render, `await vi.waitFor(...)`? Vitest has `vi.waitFor` that works with fake timers. Hmm, or we can structure it: fake timers, render, `await flushPromises()`…

Alternative: mock `Date.now` to test ticking? Simpler and more robust approach: `vi.useFakeTimers({ shouldAdvanceTime: true })`? That auto-advances by real time. Hmm.

Let me think of the most reliable test:

```tsx
it('ticks the elapsed time', async () => {
  vi.useFakeTimers();
  state.user = {...};
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  await vi.waitFor(() => screen.getByTestId('active-session-bar'));
  const first = screen.getByTestId('active-elapsed').textContent;
  vi.advanceTimersByTime(1000);
  await vi.waitFor(() => expect(screen.getByTestId('active-elapsed').textContent).not.toBe(first));
  vi.useRealTimers();
});
```

`vi.waitFor` with fake timers: vitest's `vi.waitFor` auto-advances timers per its implementation (polls while advancing). Yes — vitest's `vi.waitFor` supports fake timers and advances them. And the query fetch via MSW: with fake timers, MSW's response is… MSW intercepts fetch at the network level via interceptors. The response is delivered via a promise. Timers aren't involved in the resolution (no real delay). So the query resolves after microtasks. `vi.waitFor` should catch that.

Hmm but `renderApp` uses `createMemoryRouter` and `AuthProvider` which fetches `/auth/me`. All via MSW promises. Should be fine.

But be careful: existing tests use real timers. We'll add fake timers only within that test and restore at the end (afterEach in setup? we don't have one. Let's do it within the test). Also `userEvent` with fake timers can be tricky. Let's avoid userEvent in that test.

Also the ticking interval: `setInterval(() => setNow(Date.now()), 1000)`. With fake timers, `Date.now` is also faked — does `vi.useFakeTimers()` mock `Date` by default? In Vitest, `useFakeTimers` fakes `setTimeout`, `setInterval`, `Date` (yes, by default `toFake` includes `Date`… let me recall: `@sinonjs/fake-timers` defaults to faking: setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, Date. Vitest's `useFakeTimers` passes through. In Vitest 2, the default `toFake` is everything sinon fakes, excluding nextTick/queueMicrotask. Date is faked by default. So `Date.now()` advances with `advanceTimersByTime`. Good — the elapsed text will change.

Actually wait: `state`'s sessions' `startedAt` is April 2024, and the fake clock starts at the real current time (2025). Elapsed = now - startedAt ≈ over a year. Ticking every second changes the seconds. Format: include seconds so it visibly ticks. Example: `1y 6d 4h`? No seconds → no visible change. Let's make the format include seconds always? "382d 04h 12m 07s" — long but fine. Or show "1h 23m" and tick minutes? Bad for tests and for a user watching the seconds. Spec: "elapsed time ticking." Ticking means live update. Include seconds. Format: `[Xd ]Hh MMm SSs` — include days when ≥ 1. In test, startedAt is April 2024, so it'll be "300d 12h 34m 56s" style. Fine.

Let's write a `formatElapsed(ms: number): string` helper, exported (for unit testing) in a file like `src/features/sessions/active-session.ts`. And a `useNow` hook? Let me decide the file layout:

Files to change/create:

1. `src/features/sessions/queries.ts` — add `useActiveSession` and active-cache write helpers.
2. `src/features/sessions/SessionDetailScreen.tsx` — on load, mark session as active (via helper). Nothing else changes. Keep the blocker.
3. `src/app/ActiveSessionBar.tsx` (new) — the bar component: uses `useActiveSession`, resume button (Link/navigate to `/sessions/${id}`), close button with ConfirmDialog, elapsed ticker.
4. `src/app/AppLayout.tsx` — render `<ActiveSessionBar />` above `<Outlet />` inside `<main>` or between header and main. "Shown on all authenticated screens" — put it in the shell.
5. `src/features/sessions/ActiveSessionBar.test.tsx`? The bar lives in app/. The existing test convention: `src/features/sessions/SessionsListScreen.test.tsx` in the feature directory. Bar test: `src/app/ActiveSessionBar.test.tsx`? The layout has no existing test file. The layout has none. Tests render the full app via `renderApp`. We can test the bar behavior by rendering `/orders` (an authenticated screen other than sessions) and asserting the bar shows. That exercises AppLayout integration. Let's create `src/app/ActiveSessionBar.test.tsx` and use `renderApp` with different paths.

Now, "opening makes it active" — where to implement? The mock server marks active on GET detail. Client cache update: in `SessionDetailScreen`, when `session` data arrives, call `setActiveSessionCache(qc, session)` if not closed. But `useSession` is also used… only in the detail screen. Put the effect in the detail screen:

```tsx
const qc = useQueryClient();
useEffect(() => {
  if (session && session.status !== 'closed') {
    qc.setQueryData(sessionKeys.active(), session);
  }
}, [qc, session]);
```

Hmm but is this the "app style"? The queries.ts file has mutations that write to caches. An alternative is `useSession(id)` returns data, and a helper in queries.ts:

Actually, maybe cleaner: add an `activateSession` helper in queries.ts:

```ts
/**
 * The server marks a fetched session as active (unless it's closed). Mirror
 * that in the active cache so the bar updates without refetching.
 */
export function reflectActiveSession(qc: QueryClient, session: Session | null | undefined) { ... }
```

Hmm wait. Actually let me reconsider: should activation be done on any `getSession` fetch, or on "opening" (navigation)? The server semantics: any GET detail makes it active (if not closed). The mock models the server. So client mirrors that: any time a detail is loaded (whether from list click or deep-link), it becomes active. That satisfies requirement 1 and deep-linking.

Edge case: user is on detail of A (active=A, dirty notes). Navigates to B's detail: blocker first (dirty) → confirm → navigate → B loads → active=B. "Confirm if the current one has unsaved notes" — satisfied by the existing blocker.

But wait, there's a subtlety in the blocker flow: `useBlocker(dirty)` blocks any navigation including the `blocker.proceed()`. OK, existing behavior.

Another subtlety: when the user confirms "Leave," the detail unmounts and the dirty draft is discarded. Active is still A. Then B's detail loads → active=B. Fine.

If the user cancels leave? Nothing happens. Fine.

Now the close from the bar: the bar's close uses the same `useCloseSession` mutation. On success:
- detail cache updated (existing), list patched (existing).
- active: if the active cache's id equals the closed id → set active to null.

Implementation in `useCloseSession.onSuccess`:

```ts
onSuccess: (updated: Session) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  if (qc.getQueryData<Session | null>(sessionKeys.active())?.id === updated.id) {
    qc.setQueryData(sessionKeys.active(), null);
  }
},
```

Note: `getActiveSession` returns `Session | null`. Query data type: `Session | null`.

Also, should we refetch active after close instead? Targeted set matches the app style.

Another case: closing a session from the detail screen when it's active (typical): the detail screen shows the closed session, and the bar empties. Good. "On success the bar becomes empty."

What about the bar showing a closed session? Can the active session be closed? The server clears active on close, and GET detail doesn't set closed sessions active. But if we have a race, or if the active session gets closed from elsewhere… the bar should probably show closed state or auto-clear. Keep it simple: render as-is. The close button is disabled if status is closed (same rule as detail). Elapsed stops at closedAt.

Also, "close session (calls the existing close endpoint, with confirmation. On success the bar becomes empty)" — ConfirmDialog with the same wording as the detail's.

Now `useActiveSession`'s enabled: the bar only renders inside AppLayout (authed). But the query runs on AppLayout mount. After logout, `queryClient.clear()` clears the data, and the component unmounts anyway. But consider: user on `/sessions`, logs out → `RequireAuth` sees `user=null` → redirects to `/login` → AppLayout unmounts. The `useActiveSession` query unmounts. No refetch. OK.

Edge case: during login screen (not authenticated), the bar doesn't exist. Good — the bar is only "shown on every authenticated screen."

Should we gate `enabled` on the auth user? In tests, `state.user` is set before render. AuthProvider's `me()` resolves. Fine without gating. But consider: user logs out — `logout()` calls `queryClient.clear()` — active data cleared. Then redirect. If anything re-mounted the bar (login screen has no bar), no issue.

Now, requirement 4: "must survive a full page refresh… don't use client-only persistence for server-side facts." So we don't use localStorage. The bar is backed by a query to `GET /sessions/active` — on refresh, the app boots, the bar fetches active → shows. That's automatic given the design. No client persistence. Good.

Now let me think about "Resume" — navigates to the detail. Use a `Link`? The bar has two actions: Resume (navigate to detail) and Close session (opens confirm). We could use a plain `Button` with `useNavigate` or a `Link`. The app uses `Link` for navigation on list rows, and `Button` for actions. Let's use `Button` with `navigate`. Or wrap a Link in a button… Let's keep it simple: `Button onClick={() => navigate(`/sessions/${session.id}`)}`.

Hmm, the bar's "Resume" makes sense when the user is not on that detail. When on the detail itself, it's a no-op navigation. Fine.

Now let me think about the dirty confirmation on replacement more carefully. Requirement 3: "Only one active session at a time. Opening another one replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

Reading again… "(with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)." I think this means: when opening another session causes replacement, if the current active session has unsaved notes (i.e., the operator is on that detail with a dirty draft), we must confirm. Given the app architecture, the only way to be "on the detail with unsaved notes" and "open another session" is via a route change, which the blocker intercepts. So the existing blocker is exactly that confirmation. The task explicitly points out that the detail screen "already tracks a dirty flag" — so we reuse it, don't reinvent it.

But wait — is there a path to open another session without a route change? No. Via keyboard/browser nav? A route change → blocker. So yes, the blocker covers it. But the blocker's message is "Leave with unsaved notes?" not "This will replace your active session." Requirement: "with confirmation if the current one has unsaved notes" — the confirmation exists. We can keep the existing message (regression: don't change existing behavior). We shouldn't change the blocker's wording — that's existing behavior that must not regress.

Hmm, but there's another consideration: what if the current active session is A (in cache) and the operator opens B while A's detail has unsaved notes but the operator is… not on A's screen? Impossible — dirty only exists while mounted.

OK one more subtlety: what if the user is on A's detail, not dirty, and opens B (via nav to list, then click B). A's detail unmounts. No confirm needed. B becomes active. Fine.

Now — should replacing active be done server-side explicitly? The server (mock) marks active on GET detail. So no client call to "set active." Good — no new API needed.

Now let me also consider: list screen — clicking a session's Link navigates. The mock handler GET detail sets active. The client mirror in the detail screen sets the cache. But there's a timing issue: while B's detail is loading, the active cache still says A. Bar shows A briefly, then B. Acceptable (server is source of truth, and cache mirrors).

Alternative: navigate from the list and optimistically set active cache on click? No — the server is the source of truth. We shouldn't client-persist server facts… well, optimistic UI is a client cache not "persistence," but the server defines active on GET. Let's just mirror on detail load.

Now let me also double-check `useActiveSession`'s query type: `api.getActiveSession(): Promise<Session | null>`.

```ts
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}
```

Data: `Session | null | undefined`.

Bar component:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600) % 24;
  const d = Math.floor(total / 86400);
  const pad = (n: number) => String(n).padStart(2, '0');
  return [d ? `${d}d` : null, `${h}h`, `${pad(m)}m`, `${pad(s)}s`].filter(Boolean).join(' ');
}
```

Hmm wait, `h` is `% 24`? For days/hours display, hours beyond 24 get folded into days. `h = Math.floor(total/3600) % 24`, `d = Math.floor(total/86400)`. Yes.

Tick hook:

```tsx
function useTickingNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
```

Bar:

```tsx
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const close = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow();

  if (!active) return null;

  const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <span className="active-session-bar__name">{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span className="active-session-bar__elapsed" data-testid="active-elapsed">{elapsed}</span>
      <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
      <Button variant="danger" disabled={active.status === 'closed' || close.isPending} onClick={() => setConfirmClose(true)}>
        Close session
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => { setConfirmClose(false); close.mutate(active.id); }}
      />
    </div>
  );
}
```

Wait — unconditional hook call: `useTickingNow` ticks even when there's no active. That's a wasted interval. Only tick when active? Rules of hooks: we can't conditionally call the hook, but we can pass an `enabled` flag to the hook:

```tsx
function useTickingNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}
```

`const now = useTickingNow(Boolean(active));`

Hmm but with `now` state: if the bar appears later (active loads), `now` was initialized at mount (AuthProvider-level time). First render of elapsed uses a slightly stale `now` — a sub-second staleness, and the next tick fixes it. But in tests with fake timers: render at fake time T. Active resolves. Elapsed computed at T. advanceTimersByTime(1000) → tick → re-render at T+1000. Good.

Edge case: for closed sessions, `end` = closedAt (fixed), so no tick needed anyway. `enabled` could be `active && !active.closedAt`. Let's do that.

Wait, actually there's a subtle issue: the bar renders when `active` is defined. The bar is mounted on AppLayout (from authed app start). `useActiveSession`'s data is initially undefined → `active` is undefined → returns null. Then fetch resolves → data is `null` (none active) → null. Or a session → render bar. When enabled flips to true, the interval starts. But `now`'s initial value was `Date.now()` at bar mount — fine.

Now the AppLayout change:

```tsx
<main>
  <ActiveSessionBar />
  <Outlet />
</main>
```

Put the bar inside main, above the outlet — "shown on all authenticated screens." Could also be right under the header. I'll put it at the top of main.

Now the mirror of activation in `SessionDetailScreen`:

```tsx
const qc = useQueryClient();
useEffect(() => {
  if (session && session.status !== 'closed') {
    markActiveSession(qc, session);
  }
}, [qc, session]);
```

With the helper in queries.ts:

```ts
/**
 * The server marks a fetched session as active unless it is closed. Mirror
 * that fact in the active cache so the bar follows without a refetch.
 */
export function markActiveSession(qc: QueryClient, session: Session): void {
  qc.setQueryData(sessionKeys.active(), session);
}
```

Hmm, or just inline `qc.setQueryData(sessionKeys.active(), session)` in the component. The comment in queries.ts about the pattern ("copy it, don't invalidate") suggests putting cache-write helpers near the keys. Let me export a small helper and use it in both the detail screen and… the bar doesn't need it.

Wait — also consider: if the user opens a closed session's detail (deep-link to a closed session): server doesn't change active. Client must not clear active or set it. So the guard `session.status !== 'closed'` is correct. Should we *clear* the active cache in that case? No — the server left the previous active as-is. We don't know the previous active… actually the cache does know (it's our last mirror). Leave it alone. Correct.

Another regression check: the existing test `SessionsListScreen.test.tsx` — filter + pagination. Our changes don't touch list behavior. But the list now… nothing changes. OK.

Detail edit test? The existing test file shown is only for the list. The task says detail dirty-flag warning must not regress — we preserve the code.

Logout: `queryClient.clear()` clears active cache → bar empties. Plus unmount. Good.

Now for the "replace with confirmation" scenario — let me double-check the flow with the bar present: on A's detail (dirty). Click "Sessions" in the header → blocker dialog "Leave with unsaved notes?" → Leave → list → click B → B's detail → blocker? B loads fresh (not dirty) → no dialog. active=B. The confirm happened at the point of leaving A. That's "with confirmation if the current one has unsaved notes."

But hmm — is that confirmation actually about replacement? It's about leaving with unsaved notes. The wording of the requirement ties the confirmation to the replacement. Since the only path to replace with a dirty current session goes through that dialog, I think the requirement is met. The parenthetical "— the detail screen already tracks a dirty flag" strongly suggests: use the existing dirty flag mechanism.

But wait — what if the current active session A has unsaved notes and the user opens B while still on A's screen — no other UI for that… except the bar's Resume (to A, not B). OK.

Or, a scenario where A's detail is dirty and the user clicks "Close session" on the bar? That's a close, not a replace. The bar's close dialog says "Closing is final." Should it mention unsaved notes if detail is dirty? The detail's own close dialog says "Unsaved notes will be lost." The bar's close from the list screen: detail isn't mounted so no unsaved notes. From A's detail: both dialogs could appear (the bar's close confirm + no blocker since no navigation). The detail's close dialog already warns. Keep the bar's body simple.

Now — one more important detail: `useCloseSession` on the bar: after close success, active cache is cleared (if it matched). Detail cache updated → if we're on that detail, it shows closed. Good.

Now, about tests. In the app's style: vitest, render through the real router + query client against MSW, no hook mocks, behavior assertions.

Test file: `src/app/ActiveSessionBar.test.tsx`.

Setup: `state.user = {...}`, and `state.activeSessionId` controls the server-side active. Note: `state.activeSessionId` is also mutated by GET detail. Tests must reset state between tests! The existing tests set `state.user` per test but don't reset `state.activeSessionId` — it starts null. My tests set it. To be safe, set `state.activeSessionId = null` at the start of each test (or a beforeEach in my file).

Tests to write:

1. **The bar shows the active session on non-sessions screens and survives "refresh"** — well, "survives refresh" in this harness = a fresh `renderApp` (new query client, new router) with `state.activeSessionId` set → the bar shows from the `GET /sessions/active` fetch. That models a full page reload.

```tsx
it('shows the active session on every screen after a reload', async () => {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';

  renderApp('/orders');
  await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
  expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  expect(screen.getByText('open')).toBeInTheDocument();
});
```

Wait — `screen.getByText('Inspection 1')`: on /orders, orders list shows references like ORD-… not "Inspection 1." The bar shows the name. So `getByText('Inspection 1')` is only in the bar. Good. 'open' badge — the orders screen also has status badges ('pending' etc.). `getByText('open')` is unique on /orders (orders statuses: pending/approved/rejected/cancelled). OK.

Also assert elapsed is present: `getByTestId('active-elapsed')` matches /\d+s/.

2. **Opening a session from the list makes it the active** (bar updates):

```tsx
it('makes a session active when it is opened', async () => {
  state.user = ...; state.activeSessionId = null;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByText('Inspection 2')).toBeInTheDocument());
  // no bar yet
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Inspection 2'));
  await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
  // navigate to another screen, bar persists
  await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
  await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
  expect(screen.getByTestId('active-session-bar')).toBeInTheDocument();
  expect(screen.getByText('Inspection 2')).toBeInTheDocument();
});
```

Wait, note: initial render of /sessions — active query fetches → null → no bar. Click "Inspection 2" (a Link with that text) → navigates to /sessions/s-002 → detail fetch (server sets active) → effect mirrors to cache → bar appears. Then header link "Orders" → /orders → bar still shows Inspection 2.

Hmm: `screen.getByText('Inspection 2')` — on the list, there's a link. In the bar, there's a span. After navigation, on /orders, only the bar has "Inspection 2."

But note: 'Inspection 2' — session s-002: status is i%3=2 → 'closed'! Let me check: sessions' i is 0-based: `status: (['open','paused','closed'] as const)[i % 3]`. i=1 (s-002) → 'paused'. i=0 (s-001) → 'open'. i=2 (s-003) → 'closed'. So s-002 is 'paused' — not closed, so it becomes active. Good. s-001 'open.'

Also note: s-001 (i=0) has notes 'Awaiting parts.' (i%4===0), s-002 none.

3. **Replacement: opening another session replaces** — from the list, click another session. Bar switches:

Actually test 2 can cover the replacement: after active is s-002, go back to sessions list, click 'Inspection 3'? s-003 is closed — GET detail on a closed session doesn't set active! Good test for the guard: bar still shows s-002. Hmm, that's an edge. Let's keep it simple: click 'Inspection 1' (open) → bar shows Inspection 1.

Let's structure test 2: open s-002 → bar. Navigate to /orders → bar persists. Navigate back to /sessions → click s-001 → bar shows 'Inspection 1' (replaced).

Note: 'Inspection 1' appears in the list and the bar → after clicking, use `getAllByText`, or use the bar's testid container. Query within the bar: `screen.getByTestId('active-session-bar')` then `within(bar).getByText('Inspection 1')`.

4. **Close from the bar empties it** (with confirmation):

```tsx
it('closes the active session from the bar after confirmation', async () => {
  state.user = ...; state.activeSessionId = 's-001';
  renderApp('/orders');
  await waitFor(() => screen.getByTestId('active-session-bar'));
  await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
  // not closed yet
  expect(screen.getByTestId('active-session-bar')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm'? }))
```

ConfirmDialog: the confirm label is 'Close session' — same as the bar's trigger! Two buttons named "Close session": the bar's trigger and the dialog's confirm. `getByRole('button', { name: 'Close session' })` would match both → error. Distinguish: dialog is `role="dialog"`. Use `within(screen.getByRole('dialog')).getByRole('button', { name: 'Close session' })`. Cancel is 'Cancel.'

After confirm → mutation POST close → server sets status to closed, clears active → onSuccess sets detail cache, patches list, clears active cache → bar unmounts.

Assert: `await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());`.

Also assert server state: `expect(state.activeSessionId).toBeNull()` and session s-001's status 'closed'? The behavior: bar empties + server cleared. Let's assert on the bar. Also confirm no request if Cancel is clicked? Add: open the dialog, Cancel, bar still there.

5. **Resume navigates to the detail**:

```tsx
it('resumes the active session', async () => {
  state.user = ...; state.activeSessionId = 's-003'; // closed? no s-003 is closed
```

Use s-001 (open). renderApp('/orders') → bar → click 'Resume' → navigate to /sessions/s-001 → detail shows 'Inspection 1' heading + notes textarea. Assert `screen.getByRole('heading', { name: 'Inspection 1' })`.

Hmm, the detail's h1 is the name. The bar is also present on the detail screen. `getByRole('heading')` disambiguates.

6. **Ticking**: fake timers as sketched.

7. **No bar when nothing is active**: renderApp('/orders') with activeSessionId null → after queries settle, no bar. Assert `queryByTestId` is null — need to wait for the active fetch to resolve to avoid a false negative. Use `await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument())` then `expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument()`. Since the orders data and the active data resolve around the same time… no strict guarantee, but both are single fetches. Hmm, to be safer: `await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument(), { timeout })`? That passes immediately before the fetch resolves → false negative, but only if the bar would appear later. In this test active is null, so the bar would never appear. The risk is asserting before the list loads. So: wait for list, then assert no bar. The active query resolves independently, but if it were non-null the bar would appear. It's null, so fine.

8. **Logout clears the bar**: renderApp('/sessions') with active → bar appears → click "Log out" → redirect to /login → bar gone. Assert login form visible and no bar. This tests "logout clearing all state" with the bar. Note: logout → `queryClient.clear()` → then RequireAuth navigates to /login. The login screen has no bar (outside layout). Assert `screen.getByRole('button', { name: 'Sign in' })` and no bar.

9. **Deep-link to detail marks it active**: renderApp('/sessions/s-004')? s-004: i=3 → 'open.' Bar appears with 'Inspection 4.' Also the detail loads (regression: deep-linking works). This also covers "opening makes active" via the deep-link path.

10. **Dirty-flag confirm on replace** (regression + requirement 3): on s-001's detail, type in notes (s-001 has 'Awaiting parts.' → type more → dirty) → click "Sessions" link → dialog "Leave with unsaved notes?" appears → assert dialog, click Leave → list → click s-002 → bar shows s-002 (replaced after confirmation).

This is a good integration test. Let me write it:

```tsx
it('asks before replacing the active session when its notes are unsaved', async () => {
  state.user = ...; state.activeSessionId = 's-001';
  renderApp('/sessions/s-001');
  await waitFor(() => screen.getByRole('heading', { name: 'Inspection 1' }));
  const notes = screen.getByLabelText(/Notes/);
  await userEvent.type(notes, ' more');
  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  // the existing blocker dialog
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
  await waitFor(() => screen.getByRole('heading', { name: 'Sessions' }));
  await userEvent.click(screen.getByText('Inspection 2'));
  await waitFor(() => expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument());
});
```

Wait — label: `<label>Notes<textarea…></label>` → `getByLabelText('Notes')`? The label text is "Notes" + the textarea. `screen.getByLabelText(/notes/i)`. The label's content is "Notes" (the text node) wrapping the textarea → accessible name is "Notes." OK.

Hmm — note: on the list, is there a 'Sessions' link in the header nav? Yes. And the heading 'Sessions' is an h1 on the list. After proceed, the blocker dialog is gone.

But note: when clicking the header 'Sessions' link while blocked — the dialog appears, the URL doesn't change. Then click 'Leave' → proceed → navigate. OK.

One concern: `userEvent.type` requires focus etc. Fine in jsdom.

Another concern: when we click 'Inspection 2' from the list after proceeding — the detail s-002 loads, the effect marks active → the bar shows Inspection 2. Note: the bar was showing Inspection 1 until then (from the server active, s-001). After s-002 loads, replaced. Good.

Also the notes draft: after leaving, the detail unmounts. The draft is discarded. The server's s-001 notes remain 'Awaiting parts.'

Now, timing of the mirror effect: the `useEffect` on `[session]` runs after paint. The query data set → bar re-renders. Fine.

Also let me double-check the `useBlocker` behavior under React 18 + memory router: existing pattern, fine.

Now, potential problem: **StrictMode double render** — the effect sets the query data twice. Idempotent. Fine. In production build, StrictMode is… tests render without StrictMode (renderApp has no StrictMode). Fine.

Now — one more consideration: **the `enabled` on `useActiveSession` during logout.** Consider a test: on /sessions with a bar, click Log out. The `logout()` → api.logout → state.user=null → setUser(null) → RequireAuth → Navigate to /login. During that, AppLayout might render one more time with user null? RequireAuth checks user — null → renders Navigate instead of Outlet → AppLayout unmounts. The bar unmounts. No active query refetch. OK.

But a subtle React Query issue: on unmount, the query isn't refetched (refetchOnWindowFocus false, no refetchOnUnmount by default). Fine.

Now, what about the bar when `active` is stale and the user navigates to a screen… it's a cache. Fine.

Now, **`patchLists` and closing from the bar**: the list may not be cached (if we're on /orders). `setQueriesData` with no matches → no-op. Fine.

Now the file `src/app/ActiveSessionBar.tsx` — naming convention: existing files in app/ are `AppLayout.tsx`, `LoginScreen.tsx`, `router.tsx`, `query-client.ts`. Mixed case style… AppLayout and LoginScreen are PascalCase. Hmm, the repo convention from the system prompt is kebab-case, but the actual scaffold uses PascalCase components. "Work against them as written." Let's name it `ActiveSessionBar.tsx` to match `AppLayout.tsx`/`LoginScreen.tsx`.

Test file placement: existing `SessionsListScreen.test.tsx` sits next to the feature component. Let's put the bar test at `src/app/ActiveSessionBar.test.tsx`.

Now let me write `formatElapsed` — where? A small util inside the bar file, exported for direct unit testing? The app's style: behavior tests, no unit test files besides the screen's test. We can test the formatting indirectly via the bar. But a direct test of `formatElapsed` would be nice… "test behavior, not implementation" — the elapsed text is visible behavior. We'll assert the bar's elapsed text format in the refresh test (regex) and the change in the ticking test. To be precise, in the ticking test we can assert the text matches a full pattern like `/\d+d \d+h \d{2}m \d{2}s/`.

Actually, can we assert an exact elapsed value? The fake clock: `vi.useFakeTimers()` sets the clock to the real current time at the call. `vi.setSystemTime(new Date('2024-04-01T08:00:00Z'))`… but wait, the session's startedAt is `Date.UTC(2024, 3, 1 + (i%20), 8, 0)` → s-001 (i=0): 2024-04-01T08:00:00Z. If we set the system time to `2024-04-01T08:00:03Z`, elapsed = 3s → "0h 00m 03s." Then advance 1000 → "0h 00m 04s." That's a precise behavior assertion!

But `vi.setSystemTime` after `vi.useFakeTimers` — order: `vi.useFakeTimers(); vi.setSystemTime(...)`. Then render. The query resolves. The bar's first paint: now=08:00:03 → "0h 00m 03s." Actually the bar's `useState(() => Date.now())` runs at mount — after setSystemTime, so 08:00:03.

But note: the initial fetch of `useActiveSession`… MSW responds immediately (microtask). The render happens, the effect sets the interval. First text: computed from the `now` state = 08:00:03. Assert `getByTestId('active-elapsed')` toBe '0h 00m 03s.' Then `vi.advanceTimersByTime(1000)` → interval fires → setNow(08:00:04) → '0h 00m 04s.'

Format decision: when < 1 day, no days part: `[h]h mm m ss s`. Let me define:

```ts
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3_600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`, `${pad(minutes)}m`, `${pad(seconds)}s`);
  return parts.join(' ');
}
```

At 3s: "0h 00m 03s." At 1 year: "366d 0h 00m 00s" style. Good.

Where to put `formatElapsed`? Export it from the bar file. The test can import it? "Test behavior" — via the DOM is better. Let's assert via the DOM.

Now, the `useTickingNow(enabled)` inside the bar file.

Another design question: should the bar fetch active via the query in the bar, or should AppLayout own it? The bar owns it — cleaner.

Now, let me reconsider **where the activation mirror happens.** Alternative: put it in `useSession` as a wrapper that needs `qc` — queries can't have side effects on success (they're not mutations). The app style puts cache writes in mutation onSuccess. For queries, the component effect is the only place. So the effect in SessionDetailScreen. Let me add a comment there.

Actually — hmm, wait. Let me reconsider: is it acceptable that the "activation" mirror only happens when the detail screen is mounted? Yes: activation requires a GET detail, which only happens from the detail screen (or the list? no, the list uses listSessions). Deep-link → detail screen. So all activations go through the detail screen's query.

Now the **`markActiveSession` helper** — do we need it, or inline? Let's write in queries.ts:

```ts
/**
 * The server promotes a fetched session to the active one unless it is
 * already closed (see GET /sessions/:id). Mirror that in the active cache
 * so the bar follows the screen instead of refetching.
 */
export function mirrorActiveSession(qc: QueryClient, session: Session): void {
  if (session.status !== 'closed') {
    qc.setQueryData(sessionKeys.active(), session);
  }
}
```

Need to import the `QueryClient` type in queries.ts. Currently it uses `ReturnType<typeof useQueryClient>` for helpers. To be consistent: `qc: ReturnType<typeof useQueryClient>`. Yes! `patchLists` uses that type. Let's use the same for consistency.

And in the detail screen:

```tsx
const qc = useQueryClient();

// Opening a session makes it the active one on the server (unless closed).
// Mirror that here so the active bar follows without a refetch.
useEffect(() => {
  if (session) mirrorActiveSession(qc, session);
}, [qc, session]);
```

Wait — but there's a regression risk: the existing detail screen's `useEffect` for notes: `if (session) setNotes(session.notes)`. Adding a second effect is fine.

Hmm, one subtle: `mirrorActiveSession` on closed → no-op. But what if the session is closed and was active? Can't happen: closing clears active server-side. And the client clears the cache on close. If a deep-link to a closed session happens while another is active: no-op, bar keeps the other. Correct per server.

Now the **useCloseSession** update:

```ts
export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // The server only clears the active session if it was the active one.
      // Mirror that: empty the bar only for the session we just closed.
      const active = qc.getQueryData<Session | null>(sessionKeys.active());
      if (active?.id === updated.id) qc.setQueryData(sessionKeys.active(), null);
    },
  });
}
```

And add `useActiveSession`:

```ts
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}
```

The `active` key already exists.

Now, **AppLayout**:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from './ActiveSessionBar';

export function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <header>…same…</header>
      <main>
        <ActiveSessionBar />
        <Outlet />
      </main>
    </div>
  );
}
```

Now let me think about the **bar's look**: "shows its key fields (name, status, elapsed time ticking)." Use Badge for status (app style), name text, elapsed span.

data-testid: the app doesn't currently use data-testid… existing code uses `data-tone`, `data-variant` (for styling). Tests use roles/labels. For the bar, we can target via role/aria: give the bar `role="region"` with `aria-label="Active session"`? Then `screen.getByRole('region', { name: 'Active session' })`. Elapsed: wrap in a `<span>` with aria-label? A span with a stable text pattern. Hmm, in the ticking test we need to re-query the element by identity — `getByText(/s$/)`? The elapsed text '0h 00m 03s' — we can do `screen.getByText(/\d+s\b/)`? Risky: other text might match… on /orders screen: orders have no seconds. Reference like "ORD-2024-0001" — the `\d+s` regex wouldn't match. Actually let me use `getByText(/^.*\d{2}s$/)`. Simpler: give the elapsed span `data-testid="active-elapsed"` — is testid acceptable in this app's style? It has no testid currently, but nothing forbids it. Hmm. "In the app's style" — the app's tests query by semantic role/text. For a ticking element whose text changes, text queries are awkward but possible: query all and pick…

Alternative clean approach: wrap the bar in `<div role="complementary"?` hmm.

Let me think about what's most idiomatic: the app uses `aria-label` on interactive elements ("Filter by status," "Search sessions"). For the bar, `role="region" aria-label="Active session"` → `getByRole('region', { name: 'Active session' })`. For the elapsed, render it with `aria-label="Elapsed time"`? A span with aria-label isn't exposed as a role… `role="timer"`! That's the ARIA role for something that updates: `<span role="timer">` → `getByRole('timer')`. Perfect semantic fit for a ticking clock, and it's a standard ARIA pattern. Let's use that.

So in the ticking test: `const elapsed = screen.getByRole('timer')`.

And the bar container: `role="region" aria-label="Active session"` — hmm, or simpler `<section aria-label="Active session">`? A section with an accessible name is a region. Let me use a div with role="region." Actually `<div role="region" aria-label="Active session">` is fine.

Buttons: 'Resume' and 'Close session' — query by role name. The confirm dialog: role dialog, aria-label = title → `getByRole('dialog', { name: 'Close this session?' })`.

Now — the **close button in the bar when the session is closed**: disabled (same rule as detail). If a closed active is showing, the elapsed uses closedAt. Fine.

Now, **"Close session" in the bar while the detail is open with unsaved notes** — out of scope.

Now the **test file**. Also need to reset `state` between tests: the existing tests don't reset, but they only set user. My tests set `state.activeSessionId` and may mutate sessions (closing). Closing s-001 changes `sessions[0].status` → subsequent tests in the same file see closed s-001! Existing tests in other files also run in the same process (vitest: by default each test file has its own module registry → separate `state` per file). Within my file, order matters. Options: pick distinct sessions per test, or restore. Cleaner: `beforeEach` that resets `state.activeSessionId = null` and restores s-001? Session mutations: the close test mutates s-001. The dirty test uses s-001 (needs non-closed for the close button? no — the dirty test is just about the notes). The notes PATCH mutates the notes but… in the dirty test we leave without saving, so no PATCH. OK, the only mutation is the close test on s-001.

To be safe and self-contained, let me define a helper in the test file:

```ts
function resetState() {
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = null;
  sessions[0].status = 'open';
  sessions[0].closedAt = null;
}
```

Hmm, is it acceptable to mutate the mock db in a test? The tests already import `state` from mocks/db. Importing `sessions` for reset is fine. But "in the app's style" — minimal. Vitest runs test files in isolated workers by default (threads pool, per-file isolation), so cross-file contamination isn't an issue. Within the file, use `beforeEach(resetState)` — but wait, does the existing convention have a beforeEach? No, they set state per test. Let me set `state.user` and `state.activeSessionId` per test, and pick a session for the close test that isn't used elsewhere as open… s-001 is used in tests 2, 5, 8, 10. The close test closes s-001 → then s-001 is closed in subsequent tests. Vitest runs tests in a file in order. If the close test is last, the earlier tests aren't affected. But if the close test closes s-001 and a later test deep-links to s-001… let's order the tests so close is last, or use a different session for close. Let me use s-001 for close, and place it last. And the deep-link test uses s-004 (open, i=3 → 'open'? i=3: 3%3=0 → 'open.' Yes).

Wait, s-004: i=3, status 'open,' notes: i%4===0? 3%4=3 no → ''. startedAt: 2024-04-04T08:00Z.

Hmm, and test 2 opens s-002 (paused). Does "paused" session get marked active? The server: only 'closed' is excluded. paused is allowed. OK.

Also note: opening s-002 makes it active (server). The bar badge 'paused.'

Now, **the "no bar" test**: activeSessionId is null. But wait — in that test we render /orders. The orders list doesn't call session detail, so active stays null. Good.

**Test: the bar doesn't appear on the login screen**? The bar is inside AppLayout which is under RequireAuth — on /login there's no layout. Testable: renderApp('/login') → no bar. Meh, trivial. The layout structure guarantees it. Skip? "Test behavior" — one line each. Let's include it cheaply: after the no-active test? Let's keep the file focused:

1. `shows the active session from the API after a fresh load (survives refresh)` — renderApp('/orders') with active s-001. Bar with name/status/elapsed.
2. `makes a session active when opened and keeps it across screens` — list → open s-002 → bar. /orders → bar persists. Back to list → open s-001 → bar replaced.
3. `asks to confirm before closing from the bar, and empties on success` — also cancel path.
4. `resumes the active session` — /orders → click Resume → detail heading.
5. `warns via the existing dirty-flag blocker when replacing with unsaved notes` — dirty test.
6. `ticks the elapsed time` — fake timers, precise values.
7. `clears the bar on logout`.
8. `deep-links to a detail and marks it active` — renderApp('/sessions/s-004').
9. `shows nothing when there is no active session` — /orders, no bar.

That's comprehensive. Let me recheck each for pitfalls.

**Pitfall A**: In the test where the list loads (test 2), when we click the "Inspection 2" link — `userEvent.click(screen.getByText('Inspection 2'))` — the text is inside a Link. The click navigates. Note: at that moment, the active fetch has returned null and there's no bar, so 'Inspection 2' is unique. Good.

Then `waitFor(() => screen.getByRole('region', { name: 'Active session' }))` — the bar appears after the detail fetch + effect.

Then click the header 'Orders' link. Wait for orders list: `screen.getByText('ORD-2024-0001')`. Then assert the bar contains 'Inspection 2': `within(bar).getByText('Inspection 2')`.

Then click the 'Sessions' link (nav), wait for 'Inspection 1' on the list, click it, wait for the bar to contain 'Inspection 1.'

Hmm — 'Inspection 1' appears both in the list and the bar → after the click, on the detail screen, the detail's h1 'Inspection 1' + the bar's name 'Inspection 1' → `within(bar)` handles it.

**Pitfall B**: `within` import from @testing-library/react.

**Pitfall C**: Header nav links: 'Sessions' and 'Orders' — when we're on /orders, 'Orders' link exists. Fine.

**Pitfall D**: Test 5 (dirty): on the detail screen, after the heading appears, focus the textarea and type. `screen.getByLabelText('Notes')` — the label wraps the textarea with text 'Notes.' `userEvent.type(notes, 'x')` to make it dirty. Then click the 'Sessions' nav link → blocker → dialog role. `screen.getByRole('dialog')` — only one dialog at a time (the close dialog isn't open). Assert the title text 'Leave with unsaved notes?' is present. Click 'Leave' → proceed → list. Wait for heading 'Sessions.' Click 'Inspection 2' → detail. Wait for the bar to show 'Inspection 2.'

Wait — note: before leaving, the bar shows 'Inspection 1' (server active s-001). After navigating to s-002's detail, the bar shows 'Inspection 2.' The confirm was for leaving (unsaved notes). This matches the requirement: replacement was confirmed because the current one had unsaved notes.

But hmm — does the blocker actually block navigation to a link in the header? `useBlocker(dirty)` — blocks all navigations in the router (except permitted ones). Yes, same as existing behavior (existing app relies on this for "dirty-flag warning on route change").

**Pitfall E**: fake timers + `vi.waitFor`. In vitest 2, `vi.waitFor` works with fake timers (advances). We also need the query fetch to resolve under fake timers — MSW/node intercepts at the `fetch` level. The response is a promise (no setTimeout-based delay). Should resolve in microtasks. `vi.waitFor` polls by advancing the timer (its implementation calls `advanceTimersByTime` per poll when fake timers are detected). Yes, vitest's `vi.waitFor` explicitly supports fake timers.

But: `userEvent` with fake timers — we avoid userEvent in the ticking test.

Also `renderApp` uses createMemoryRouter — no timers. AuthProvider's `me()` fetch → microtask. OK.

Ticking test flow:
```tsx
vi.useFakeTimers();
vi.setSystemTime(new Date('2024-04-01T08:00:03Z'));
state.user = {...}; state.activeSessionId = 's-001';
renderApp('/orders');
await vi.waitFor(() => expect(screen.getByRole('region', { name: 'Active session' })).toBeInTheDocument());
const timer = screen.getByRole('timer');
expect(timer).toHaveTextContent('0h 00m 03s');
vi.advanceTimersByTime(1000);
await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('0h 00m 04s'));
vi.useRealTimers();
```

Wait: s-001's startedAt is 2024-04-01T08:00:00.000Z (i=0: `Date.UTC(2024, 3, 1 + 0, 8, 0)`). now = 08:00:03 → 3s → "0h 00m 03s."

But — `useTickingNow`'s initial state `Date.now()` at bar mount. When does the bar mount? AppLayout mounts immediately (after RequireAuth loading → me() resolves). At that moment now=08:00:03. The bar only renders after active data arrives. The `now` value is 08:00:03 (no ticks yet because enabled=false until active && !closedAt). On first render: elapsed from 08:00:03 → "0h 00m 03s." Then enabled flips to true → effect sets up the interval. advanceTimersByTime(1000) → setNow(08:00:04) → "0h 00m 04s."

But wait: is there a subtlety that when `enabled` flips from false→true, the effect runs and the interval is created. Between active data arrival and the effect, no ticks. Fine.

Also `vi.setSystemTime` — but `renderApp` triggers a fetch via MSW. Under fake timers, does the MSW handler use any timers? The handler is synchronous. The response is delivered via a promise. OK.

Another subtlety: the `staleTime: 30_000` — irrelevant.

And `Math.max(0, …)` guard for negative (clock before startedAt).

After the test, `vi.useRealTimers()` — should restore in `afterEach`? If the test fails mid-way, real timers stay fake for subsequent tests in the file → broken. Better: `afterEach(() => vi.useRealTimers())` in my test file. And `cleanup` is automatic (testing-library auto-cleanup when globals are enabled — @testing-library/react auto-cleanup via afterEach when globals are available. Yes, with globals: true it auto-registers).

**Pitfall F**: The logout test: on /sessions with active s-001. Click "Log out." Then RequireAuth → /login. Assert: `screen.getByRole('button', { name: 'Sign in' })` and no bar. Note: after logout, `state.user=null`. The login screen shows the form. Also `queryClient.clear()` — the active data is gone anyway.

Wait, one thing: on logout, AppLayout unmounts → the bar unmounts. But could there be a moment when the bar still shows on /login? No — the login route is separate, no layout. Assert `queryByRole('region', { name: 'Active session' })` is null after the login form is visible.

**Pitfall G**: Deep-link test: renderApp('/sessions/s-004'). The detail fetch → the server sets active to s-004 → the effect mirrors → bar 'Inspection 4.' Assert heading + bar. This also confirms deep-linking still works (regression).

**Pitfall H**: The "no active" test: ensure that the orders screen's query settles: wait for 'ORD-2024-0001,' then `expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument()`. Since the active fetch returns null and the bar never renders, and once orders is shown we've had time for the active fetch to resolve too (both started on the same mount. No guarantee but in practice both resolve in the same microtask flush). To be strict, we could `await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument())` — but that passes immediately → weak. Combined: after orders renders, also `await new Promise(r => setTimeout(r, 0))`? Hmm. Or a server state assertion… the real risk: the bar appears later (false negative is impossible — if the active fetch returned a session, the bar would appear. Here the server has active null and nothing else changes it). So the only failure mode is a false "pass" if the fetch is pending and later… still null. So the assertion is actually safe: active=null forever in this test. Let's wait for the orders list, assert no bar, and additionally assert `state.activeSessionId` is null? No — behavior, not state. Fine as is.

**Pitfall I**: In the close-from-bar test, after clicking the bar's "Close session" trigger, the ConfirmDialog renders. The dialog's confirm button label: 'Close session' (confirmLabel). So two buttons with the name 'Close session': the bar's trigger + the dialog's confirm. Use `within(dialog)`. The dialog has `aria-label={title}` = 'Close this session?' → `getByRole('dialog', { name: 'Close this session?' })`.

Then click the dialog's confirm → POST close → server: s-001 closed, active cleared (was s-001) → onSuccess: detail cache set, patchLists (the list may not be cached — we're on /orders. Fine), active cleared → bar unmounts. `await waitFor(() => expect(screen.queryByRole('region', {name:'Active session'})).not.toBeInTheDocument())`.

Also assert the server-side effect: `expect(state.activeSessionId).toBeNull()` — hmm, that's implementation-leaning, but it's the "close endpoint was called" evidence that the behavior tests use (the existing tests don't assert on state… they only assert on UI). The bar emptying is the UI behavior. We could additionally assert that if we navigate to /sessions/s-001 the detail shows a 'closed' badge — that proves the endpoint was called (the server state changed). Let's do that: after the bar is gone, click the 'Sessions' nav → click 'Inspection 1' → the badge 'closed' + the "Close session" button disabled? The list's badge shows 'closed.' That's a strong behavior assertion that the close endpoint was hit. A bit long but worth it.

Cancel path too: open the dialog, click Cancel, bar still there, and then… assert the session is still open? Just the bar's presence + the dialog's absence is enough, plus no close was called — we could assert the session is still 'open' by navigating later. Keep it simple: after Cancel, the dialog is gone, the bar remains. Then do the confirm path.

Sequence: render /orders (active s-001). Click the bar's Close session → dialog. Click Cancel → dialog gone, bar present. Click the bar's Close session again → dialog. Click the dialog's Close session (confirm) → bar gone. Navigate to /sessions → 'Inspection 1' row shows badge 'closed.'

Hmm wait — on /orders after the close, the active is cleared. Then 'Sessions' link → list. Row 'Inspection 1' with a 'closed' badge. But 'closed' text appears in multiple rows (s-003, s-006… are closed). `within(row)`: `screen.getByRole('row'…`? The table rows: `screen.getByText('Inspection 1').closest('tr')` → then within it, a 'closed' text. Or `within(screen.getByText('Inspection 1').closest('tr')!).getByText('closed')`. OK.

**Pitfall J**: Multiple regions? Only one bar. OK.

**Pitfall K**: `role="timer"` — jsdom + testing-library supports any role in queries. Yes.

Now — **regression check of existing tests**: the existing `SessionsListScreen.test.tsx` — my changes must keep it passing. The list screen is unchanged. queries.ts: `useCloseSession`'s onSuccess adds an active check — no impact on the list. `useUpdateSessionNotes` is unchanged. The detail screen adds an effect + import — doesn't affect list tests. AppLayout adds the bar — the bar renders on /sessions too! In the existing list test, the bar would fetch active → null (state.activeSessionId null in those tests… wait, in the existing test files, `state.activeSessionId` starts null and is never set. The detail isn't opened. So the active=null → no bar. List tests are unaffected.

But wait — do my new tests share `state` with the existing test file? No — separate module registry per file (vitest's default isolation: each test file gets fresh modules). Actually, is vitest's default `isolate: true`? In Vitest 2, the default pool is 'forks' with per-file isolation enabled (modules are re-instantiated per file). Yes. So no cross-file state leak.

**Pitfall L**: The bar's `useActiveSession` in the existing list tests triggers an extra fetch to `/api/sessions/active` — the handler exists. No unhandled request errors. Fine.

**Pitfall M**: `onUnhandledRequest: 'error'` in the test setup — all our requests are handled. Good.

Now, **the resume button when already on the detail**: no-op navigation. Fine.

**Assumption comments**: do we need any? Let me scan for missing symbols… `api.getActiveSession` exists. `sessionKeys.active` exists. `ConfirmDialog` exists. `useNavigate` from react-router-dom (v6) exists. `within` from testing-library exists. `vi` is global (globals: true, types vitest/globals).

One question: should `useActiveSession` be `enabled`-gated on auth? Since it only renders under AppLayout (authed), no. But consider logout: `queryClient.clear()` — then the component unmounts. But the `logout()` promise: `await api.logout(); setUser(null); queryClient.clear();` — order: after the await, setUser then clear. Re-render: user null → RequireAuth → login. The bar unmounts. No active refetch. OK.

Hmm, wait — actually there is a subtle window: `setUser(null)` triggers a re-render of RequireAuth → but AppLayout is a child of RequireAuth's Outlet. When user becomes null, RequireAuth renders Navigate → AppLayout is gone. The bar never sees user=null. Fine.

**Styling**: there's no CSS file in the scaffold (no styles shown!). index.html has no stylesheet. So className is decorative only. Fine — add classNames for consistency (the app uses classes like `shell`, `actions`, `pagination`, `row--clickable`, `dialog`). Let's use `active-session-bar` and child classes. No CSS file exists → no CSS to add (don't create files we weren't asked to).

Now, also double-check **the ConfirmDialog inside the bar within `role="region"`** — the dialog div is a child of the bar div. `getByRole('dialog')` is fine.

Also **aria for the resume button**: the name 'Resume.' Fine.

Now let me write the `SessionDetailScreen` change — the full file:

```tsx
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { mirrorActiveSession, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const qc = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Opening a session promotes it to the active one on the server (unless
  // closed). Mirror that fact here so the bar follows without a refetch.
  useEffect(() => {
    if (session) mirrorActiveSession(qc, session);
  }, [qc, session]);
  ...
```

Rest unchanged.

Now, **the queries.ts** full file:

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

/**
 * The source of truth for the active session is the server
 * (GET /sessions/active). Nothing stores it client-side beyond this cache,
 * which is why a refresh simply re-fetches it.
 */
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}

/**
 * The server promotes a fetched session to the active one unless it is
 * closed (see GET /sessions/:id). Mirror that in the active cache so the bar
 * follows the screen instead of refetching.
 */
export function mirrorActiveSession(qc: ReturnType<typeof useQueryClient>, session: Session): void {
  if (session.status !== 'closed') {
    qc.setQueryData(sessionKeys.active(), session);
  }
}

export function useUpdateSessionNotes(id: string) { ...unchanged... }

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeSession(id),
    onSuccess: (updated: Session) => {
      qc.setQueryData(sessionKeys.detail(updated.id), updated);
      patchLists(qc, updated);
      // The server only drops the active pointer when it points at the
      // closed session. Mirror that: empty the bar only in that case.
      const active = qc.getQueryData<Session | null>(sessionKeys.active());
      if (active?.id === updated.id) qc.setQueryData(sessionKeys.active(), null);
    },
  });
}

export function patchLists(...) unchanged
```

Wait, one issue: typing of `qc.getQueryData<Session | null>(sessionKeys.active())` — getQueryData accepts a key and a generic. `sessionKeys.active()` is a readonly tuple `['sessions','active']`. Fine.

Hmm, also: `setQueryData(sessionKeys.active(), null)` — the initial data for the query is undefined. Setting null → `data` is null → the bar's `!active` → null render. Good.

Now **the bar file**:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3_600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts = [days > 0 ? `${days}d` : null, `${hours}h`, `${pad(minutes)}m`, `${pad(seconds)}s`];
  return parts.filter(Boolean).join(' ');
}

/** Re-renders every second while enabled, so a duration stays live. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. It lives in the authenticated shell, so
 * it shows on every screen. The active session itself always comes from the
 * server (GET /sessions/active) — the bar holds no state of its own.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const close = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(active && !active.closedAt));

  if (!active) return null;

  const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div role="region" aria-label="Active session" className="active-session-bar">
      <span className="active-session-bar__name">{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span role="timer" className="active-session-bar__elapsed">{elapsed}</span>
      <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
      <Button
        variant="danger"
        disabled={active.status === 'closed' || close.isPending}
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
          close.mutate(active.id);
        }}
      />
    </div>
  );
}
```

Wait: `useTickingNow(Boolean(active && !active.closedAt))` — when active is undefined → false. When closed → false (static). When open/paused → true.

Hmm, `now` when `enabled` is false stays stale — but we only use `now` when not closedAt. And on first activation, `now` was initialized at bar mount (layout mount) — could be up to a few ms stale. The interval will fix within a second. Acceptable. Or re-sync `now` when enabled flips:

```tsx
useEffect(() => {
  if (!enabled) return;
  setNow(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  return () => clearInterval(t);
}, [enabled]);
```

Better: sync on activation. In the fake timer test: setSystemTime 08:00:03 → mount → now=08:00:03. Same.

Let me include the sync line.

Edge case: `active.status` is 'paused' — elapsed keeps ticking (the session is paused, but… the spec says "elapsed time ticking" for key fields. The server doesn't model pause intervals. Keep it simple: from startedAt).

Now the **AppLayout**:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from './ActiveSessionBar';

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

Now the **test file** `src/app/ActiveSessionBar.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../mocks/db';
import { renderApp } from '../test/render';

const authed = { id: 'u-1', name: 'Ada', roles: ['operator'] as const };

const bar = () => screen.queryByRole('region', { name: 'Active session' });

afterEach(() => {
  vi.useRealTimers();
  state.user = null;
  state.activeSessionId = null;
  sessions[0] = { ...sessions[0], status: 'open', closedAt: null };
});
```

Hmm — wait, mutating sessions[0] in afterEach: the close test sets s-001 to closed. Reset it for the next test. But careful: reassigning `sessions[0] = {...}` creates a new object — the handlers reference `sessions` (the array) via find → they look at the current array items. Fine. But the `notes` field: `{...sessions[0]}` after the close test — close doesn't change notes. The dirty test didn't save notes. OK.

Actually, is resetting sessions[0] necessary? Tests in the file that run after the close test: order matters. Let me write tests so the close test is last, and still keep the reset as a safety net. Actually let's just have the reset for robustness.

Wait, but the reset in `afterEach` runs after every test including the fake-timer one — `vi.useRealTimers()` there is important.

Hmm, one concern: `state.user = null` in afterEach — but the existing pattern sets it per test. Fine.

Now let me write the tests:

```tsx
describe('ActiveSessionBar', () => {
  it('shows the server active session after a fresh load, on any screen', async () => {
    state.user = { ...authed };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    const active = screen.getByRole('region', { name: 'Active session' });
    expect(within(active).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(active).getByText('open')).toBeInTheDocument();
    expect(within(active).getByRole('timer')).toBeInTheDocument();
  });
```

Wait — after a "fresh load" on /orders, the active is shown. This models a refresh (a new query client + a fetch to /sessions/active).

```tsx
  it('makes a session active when it is opened, and replaces it when another is opened', async () => {
    state.user = { ...authed };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 2')).toBeInTheDocument());
    expect(bar()).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 2')).toBeInTheDocument());

    // The bar follows the operator to other screens.
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(within(bar()!).getByText('Inspection 2')).toBeInTheDocument();

    // Opening another session replaces the active one.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 1')).toBeInTheDocument());
  });
```

Hmm — `bar()!` non-null assertion. After the orders screen assertion, the bar is present. Use `screen.getByRole` instead: `within(screen.getByRole('region', { name: 'Active session' }))`. Cleaner.

Wait, a problem: after clicking 'Inspection 2' (list → detail), the detail screen shows h1 'Inspection 2' and the bar also shows 'Inspection 2' → `getByText('Inspection 2')` is ambiguous! In the waitFor I use `within(region).getByText('Inspection 2')` — good. But the earlier `getByText('Inspection 2')` for the click is on the list before opening (bar is null) — unique. OK.

But then, when we navigate to /orders: 'Inspection 2' only in the bar. Fine.

Then back to /sessions list: 'Inspection 1' is in the list row + the bar shows 'Inspection 2' (still). Click `screen.getByText('Inspection 1')` — unique (bar shows Inspection 2). Then the detail + the bar both show 'Inspection 1' → use within(region). Good.

Another: after opening s-002, its status is 'paused' → the bar badge 'paused.' Fine.

Also note: opening s-002 (paused) — server sets active (only closed is excluded). Yes.

```tsx
  it('resumes the active session from the bar', async () => {
    state.user = { ...authed };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await userEvent.click(within(screen.getByRole('region', { name: 'Active session' })).getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  });
```

Hmm — `getByRole('heading', { name: 'Inspection 1' })`: the detail's h1. The bar is also on the detail (name in a span, not a heading). Unique.

But wait: on /orders the bar's region — 'Resume' button. After clicking → navigate to detail. The detail heading appears. Good.

```tsx
  it('confirms before closing from the bar, then empties and reports the session closed', async () => {
    state.user = { ...authed };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    const active = () => screen.getByRole('region', { name: 'Active session' });

    // Asking, then cancelling, leaves the session as it was.
    await userEvent.click(within(active()).getByRole('button', { name: 'Close session' }));
    const dialog = () => screen.getByRole('dialog', { name: 'Close this session?' });
    expect(dialog()).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(active()).toBeInTheDocument();

    // Confirming closes through the existing endpoint and empties the bar.
    await userEvent.click(within(active()).getByRole('button', { name: 'Close session' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());

    // The close really happened on the server: the list now shows it closed.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    const row = screen.getByText('Inspection 1').closest('tr');
    expect(within(row!).getByText('closed')).toBeInTheDocument();
  });
```

Wait — after the bar is gone, click 'Sessions' → list. 'Inspection 1' appears in the row. But is it unique? On the list: 'Inspection 1' row link + bar? The bar is gone. Unique. `closest('tr')` is non-null. `within(row).getByText('closed')` — the row has a Badge 'closed.'

Hmm, `getByText('closed')` — the row has a Badge with a 'closed' text. OK.

Note: after Cancel, `active()` is still there — good (cancel doesn't close).

One risk: `within(active()).getByRole('button', { name: 'Close session' })` — the bar's trigger. While the dialog is open, the dialog also has a 'Close session' button — but `within(active())` scopes to the bar's region — the dialog is a child of the bar's div!! The ConfirmDialog renders inside the bar's div (its JSX is inside). So `within(bar).getByRole('button', {name:'Close session'})` would match two → error.

Fix: scope the trigger query when the dialog is closed (first click is before the dialog opens — unique). Second open: `within(active()).getByRole('button', { name: 'Close session' })` — dialog is closed at that moment (we cancelled). Unique again. Then the confirm: `within(dialog()).getByRole('button', { name: 'Close session' })`. OK, so each call happens when only one such button exists in scope. Let me trace:

1. Click the bar's Close session (dialog closed → unique in bar scope). Dialog opens.
2. `within(dialog())` Cancel — unique in dialog scope.
3. Dialog closes.
4. Click the bar's Close session — scoped to bar, the dialog is closed → the dialog's button isn't there → unique. ✓
5. Dialog opens. `within(dialog()).getByRole('button', { name: 'Close session' })` → the dialog's confirm. Unique within the dialog. ✓

Good. Alternatively move the ConfirmDialog outside the region div — but the bar returns null when no active. The dialog should be inside. Keep it inside, rely on scoping.

Also `getByRole('dialog', { name: 'Close this session?' })` — the dialog's aria-label = title. ✓.

But wait — the detail screen also has a 'Close this session?' dialog. We're on /orders, so no conflict.

```tsx
  it('keeps the bar after a refresh-like reload by refetching from the API', ...)
```

Test 1 already covers the fresh load. Should we explicitly assert the data came from the API? The `state.activeSessionId` set + a fresh render is exactly that. The title covers it.

Now the dirty test:

```tsx
  it('asks about unsaved notes before the active session is replaced', async () => {
    state.user = { ...authed };
    state.activeSessionId = 's-001';

    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Notes'), 'x');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));

    // The detail screen's existing blocker asks before letting the draft go.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    // Only after confirming does the new session replace the active one.
    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 2')).toBeInTheDocument());
  });
```

Wait — `getByLabelText('Notes')`: the label element contains the text 'Notes' and a textarea. Accessible name: 'Notes.' ✓

Concern: while blocked (dialog open), the bar still shows 'Inspection 1.' After proceeding to the list, clicking 'Inspection 2' — 'Inspection 2' is unique? On the list: row + bar shows 'Inspection 1' → unique. ✓

Heading 'Sessions' — h1 on the list. But 'Sessions' is also a nav link (not a heading). `getByRole('heading', { name: 'Sessions' })` ✓ unique.

Also: typing 'x' into a textarea with initial 'Awaiting parts.' → dirty. ✓

Then — hmm, `userEvent.click(screen.getByRole('link', { name: 'Sessions' }))` — the header nav. Blocked → dialog. ✓

Now the fake-timer ticking test:

```tsx
  it('ticks the elapsed time every second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 3, 1, 8, 0, 3))); // 3s after s-001 started
    state.user = { ...authed };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await vi.waitFor(() => expect(within(screen.getByRole('region', { name: 'Active session' })).getByRole('timer')).toBeInTheDocument());
    expect(screen.getByRole('timer')).toHaveTextContent('0h 00m 03s');

    vi.advanceTimersByTime(1_000);
    await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('0h 00m 04s'));
  });
```

`vi.useRealTimers()` in afterEach.

Concerns: under fake timers, does the MSW response resolve? MSW's node server: the `fetch` interceptor… in msw 2, node requests go through an interceptor (interceptors library, @mswjs/interceptors) that resolves the promise after the handler runs — no real timers. I believe it's pure promise. Yes.

Also `renderApp` → AuthProvider's `me()` fetch → resolves. RequireAuth → Outlet. All microtasks. `vi.waitFor` handles it.

But another gotcha: `vi.setSystemTime` — after `vi.useFakeTimers()`. ✓. And the `sessions`' startedAt is a fixed 2024-04-01T08:00:00Z. now = +3s → '0h 00m 03s.' After 1s advance → '0h 00m 04s.' ✓

Also: the interval is created when `enabled` flips to true (after active data arrives). Between setSystemTime and the data arrival, no ticks (enabled false). The initial `now` state = Date.now() at bar mount = 08:00:03 (set at render time, which is after setSystemTime). ✓. Plus the sync `setNow(Date.now())` on enable. ✓

Edge case: `vi.waitFor` with fake timers — vitest auto-advances by 50ms per poll? Its implementation: if fake timers are detected, advances the timers on each iteration. Yes (vitest ≥ 0.34 / 1.x supports this. v2 definitely).

The logout test:

```tsx
  it('clears the bar when logging out', async () => {
    state.user = { ...authed };
    state.activeSessionId = 's-001';

    renderApp('/sessions');

    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

The login screen has a 'Sign in' button. ✓ The bar is gone (the login route has no layout). ✓

The deep-link test:

```tsx
  it('deep links straight to a detail and marks it active', async () => {
    state.user = { ...authed };

    renderApp('/sessions/s-004');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 4')).toBeInTheDocument();
  });
```

s-004: i=3 → status 'open.' ✓ (3%3=0). Deep-link works + active is marked. ✓

The no-active test:

```tsx
  it('stays hidden when the server has no active session', async () => {
    state.user = { ...authed };

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

As discussed, safe.

Hmm wait, one more scenario to consider: **closed active can't happen, but what if the bar shows a closed session** — skip, the server prevents it.

Now — the **elapsed in the first test**: I only assert the timer's presence, not the value. Fine (real time, year-scale value).

Let me reconsider **requirement 2**: "The bar offers 'Resume' (navigates to the detail) and 'Close session' (calls the existing close endpoint, with confirmation. On success the bar becomes empty)." ✓ covered.

**Requirement 4**: "must survive a full page refresh (the API exposes GET /sessions/active. Use it as the source of truth — don't use client-only persistence for server-side facts)." ✓ — the query-based bar. Test 1 simulates a fresh load. No localStorage anywhere. ✓

Now, also recheck **the `mirrorActiveSession` import in the detail screen** and that the detail screen still compiles: it imports `useQueryClient` from '@tanstack/react-query.'

Now, **`noUnusedLocals`** — make sure no unused imports in the files we change.

Let me also double-check **the typing of `useTickingNow`** — `enabled: boolean.`

**Type strictness**: `parts.filter(Boolean).join(' ')` — `parts` is `(string | null)[]` → filter(Boolean) is still typed as `(string|null)[]`? `.filter(Boolean)` doesn't narrow in TS. `join` on `(string|null)[]`… actually `Array.prototype.join` accepts any element. It coerces null to ''. But TS types: `parts: (string | null)[]`, `.filter(Boolean)` → `(string | null)[]`, `.join(' ')` — join is fine on any[]. So no type error, and the runtime is correct (Boolean filter removes null). OK. But cleaner:

```ts
const parts: string[] = [];
if (days > 0) parts.push(`${days}d`);
parts.push(`${hours}h`, `${pad(minutes)}m`, `${pad(seconds)}s`);
return parts.join(' ');
```

Let's use that.

Now, **`formatElapsed` exported from the bar file** — do we use it in tests? We assert via the DOM. Keep the export? `noUnusedLocals` doesn't flag exports. Export it in case… actually, do we need the export? It's a pure helper and exporting is harmless and testable. Let's export it (the detail screen's pattern exports small helpers like `isActionable` from queries). Fine.

Now, let me reconsider whether the activation mirror should also update the **list cache**'s status? No — opening doesn't change the session's fields.

One more: **`patchLists` after updateSessionNotes** — unchanged.

**Potential regression**: the existing behavior of the detail's "Close session" — now the bar also empties (if active). That's the intended feature, not a regression.

**Now, `renderApp('/sessions')`** (the logout test) — wait for the bar's 'Inspection 1': the list also shows 'Inspection 1' (row) → use within(region). ✓ as I wrote.

Let me also think about **the initial `state.activeSessionId` for the replacement test**: it starts null (set at the top of the test: `state.activeSessionId = null`? I only set `state.user`). afterEach resets it to null. Test 2 (open & replace): at start active null → after list loads, the bar is absent → the assert `bar()).not.toBeInTheDocument()` — at that point the active fetch may still be pending! The assert could be flaky: if the fetch is pending, the bar is absent (data undefined) → passes, but for the wrong reason (pending rather than null). But behaviorally, when the data resolves (null), the bar stays absent. The assert isn't flaky-failing, it's just weaker. Acceptable? To strengthen: after clicking and waiting for the bar, we've proven the flow. The initial "no bar" is nice-to-have. Let's keep it — it doesn't flake (only false-negative risk, which is impossible since the server's active is null forever in that test… wait, could the click on the list trigger something before the assert? No, the assert is before any click. The server's active is null forever in that test → the bar would never appear → the assertion "not present" is ultimately correct. A pending query is a temporary state that resolves to absent. So fine.)

Actually, hmm, subtle: `expect(bar()).not.toBeInTheDocument()` with `bar()` = `queryByRole` → returns null if not present. ✓ no throw.

**Now, let me verify the `getByRole('timer')` uniqueness**: only the bar renders a timer. On the detail screen (dirty test), no timer assertion. OK.

**A11y check**: `role="timer"` on a span with text — valid.

**Also**: the bar's region aria-label "Active session" — used in tests. The user sees the bar visually. The name is fine.

Now, **does the `Badge` inside the bar cause the status text to duplicate with the list?** On /sessions with a bar: 'open' appears in the list rows (multiple) + the badge. We scope with `within(region)`. In test 1 we're on /orders, so 'open' is only in the bar… wait, orders statuses: pending/approved/rejected/cancelled — no 'open.' And I scope with `within(active)`. ✓

Now, **the fake-timer test and `vi.waitFor`** — let me recheck vitest 2.1: `vi.waitFor(callback, options)` — "when using fake timers, vitest automatically advances the timers." Yes.

Also, the `render` from testing-library inside fake timers: React 18's `act`… does the auto-cleanup in afterEach happen under fake timers? Cleanup is synchronous — fine.

One risk: `userEvent` isn't used in the fake-timer test. ✓

Another risk: `vi.setSystemTime` + `new Date(Date.UTC(2024,3,1,8,0,3))` — `Date.UTC` is real math, unaffected. ✓

Now — **the elapsed in the fake-timer test**: the bar mounts at… wait, when does the bar component mount? On RequireAuth pass (after `me()`), AppLayout mounts. At that moment `useTickingNow(false)`'s initial state = Date.now() = fake 08:00:03. Then the active fetch resolves (microtask) → data → `enabled` becomes true → effect: setNow(08:00:03) + interval. First paint of elapsed: `now`=08:00:03 → '0h 00m 03s.' ✓

But — could the first paint happen before the effect sync, with a stale `now` from mount (same value)? Same. ✓

And the interval tick: advance 1000 → 08:00:04 → '0h 00m 04s.' ✓

Now let me also consider **whether the `useActiveSession` fetch could be deduped with something else** — no other consumer. Fine.

**staleTime 30s**: within a test, a single render. Fine.

Now, **the file list to deliver**:

Changed:
1. `src/features/sessions/queries.ts`
2. `src/features/sessions/SessionDetailScreen.tsx`
3. `src/app/AppLayout.tsx`

New:
4. `src/app/ActiveSessionBar.tsx`
5. `src/app/ActiveSessionBar.test.tsx`

Any other changes? The mocks already support active. The `api` client already has `getActiveSession.` The `sessionKeys.active` already exists. No router changes (the bar is in the layout). No auth changes (logout already clears the query cache).

Wait — **logout**: "logout clearing all state" — `queryClient.clear()` clears the active cache. The server's mock also clears `activeSessionId` on logout. ✓ no change needed.

Hmm, one more consideration — **`queryClient.clear()` also clears the auth `user` state?** No, the user is React state. Fine.

Now, is there any scenario where the **active query needs a refetch on focus** (to pick up changes from other tabs)? `refetchOnWindowFocus: false` globally (app choice). Keep consistent.

Now, let me also re-examine **the dirty-flag replacement requirement** once more. "Opening another one replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

Alternative reading: when replacing, the confirmation dialog should specifically mention the replacement. But since the only path involves the existing blocker, and the requirement says "the detail screen already tracks a dirty flag" (a pointer to reuse), I'm confident in the blocker-based approach. The test I wrote captures exactly that behavior: with unsaved notes, a confirm is required before the replacement proceeds.

Edge case: the current active has unsaved notes and the user opens another via… the blocker covers all navigations. ✓

Now, let me also think about **the case of opening a session from the list when the current active's detail is unmounted but the draft is… gone.** No confirm needed — correct, the notes are saved or discarded.

Also — **what if the active session is A and the user opens A again (clicks A on the list)?** Server re-sets active to A (no-op). Cache mirrors. No confirm. ✓

Now, **the `mirrorActiveSession` when the detail's query refetches** (e.g., staleTime expiry on remount): same session → idempotent. But consider: the active is B (user was on B's detail, then navigated to the list, and clicks A → A's detail loads → active=A). Then they navigate to B's detail again (via… the list) → B loads → active=B. That's "opening makes it active" — consistent with the server. ✓

**One potential bug**: the detail's effect runs `mirrorActiveSession` whenever the `session` object identity changes (e.g., after a notes save, the detail cache is updated → new object → effect re-runs → re-sets active to the same session). Harmless.

But here's a real one: **user is on A's detail (active=A, dirty). Navigates to the list, and back to A's detail.** Fresh load of A (staleTime 30s — could serve the cache). Active stays A. ✓

**Race**: user is on A's detail, active=A. Navigates to B's detail (not dirty). B's query fetches. During that time active=A. B resolves → active=B. Meanwhile the list… fine.

Now — **StrictMode in tests?** `renderApp` doesn't use StrictMode. The effect runs once. ✓ In dev (main.tsx StrictMode) the effect runs twice → setQueryData twice → idempotent. ✓

Now let me also recheck **`useBlocker` with a memory router** — the existing pattern. ✓

**Let me write the final files.**

Also — the **test render helper** `renderWithProviders` is unused by me. Fine.

Wait, one more check on the **close test**: after confirming close, `useCloseSession.onSuccess` runs: `qc.setQueryData(detail('s-001'), closed)`; `patchLists` — no cached list (we're on /orders. The list wasn't loaded) → no-op. Active check: active cache is s-001 → set to null → bar unmounts. ✓ Then navigate to /sessions → the list fetches → the row for s-001 is closed (server mutated). The badge 'closed.' ✓

Hmm — but wait: after close, is there a cached detail for s-001? Yes (set by onSuccess). When we click 'Inspection 1' in the list, we go to the detail — but we only assert on the list row. We don't navigate. ✓

Also `state.activeSessionId` is null after close (server). ✓ (we don't assert).

Now — **the `waitFor` for the list after the close test**: after close, we click the 'Sessions' nav link. The list loads. `getByText('Inspection 1')` — on the list, unique (no bar). ✓

Now let me also double-check **the `within` import** and that **`screen.queryByRole`** exists (it does).

**The `role="region"` query**: `getByRole('region', { name: 'Active session' })` — a div with role region + aria-label. ✓

Now, **potential a11y testing-library nuance**: a `role="region"` element without an accessible name is not exposed, but with aria-label it is. ✓

Now, the **`useTickingNow` sync effect**:

```ts
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}
```

✓

Now the full **ActiveSessionBar.tsx**:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

/** "3d 4h 05m 09s" style — always shows seconds, so the bar visibly ticks. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3_600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`, `${pad(minutes)}m`, `${pad(seconds)}s`);
  return parts.join(' ');
}

/** The current time, refreshed every second while `enabled`. */
function useTickingNow(enabled: boolean): number { ... }

/**
 * The persistent active-session bar. It lives in the authenticated shell, so
 * it shows on every screen. The session itself always comes from the server
 * (GET /sessions/active) — the bar keeps no persistence of its own, which is
 * what makes it survive a full reload.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const close = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(active && !active.closedAt));

  if (!active) return null;

  const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div role="region" aria-label="Active session" className="active-session-bar">
      <span className="active-session-bar__name">{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span role="timer" className="active-session-bar__elapsed">
        {elapsed}
      </span>
      <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
      <Button
        variant="danger"
        disabled={active.status === 'closed' || close.isPending}
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
          close.mutate(active.id);
        }}
      />
    </div>
  );
}
```

Hmm — `close.isPending` — RQ v5 uses `isPending.` The scaffold's detail uses `updateNotes.isPending` and `approve.isPending.` ✓ consistent.

Now, **the detail screen's close dialog body** says "Closing is final. Unsaved notes will be lost." The bar's body: "Closing is final." — from the bar, the detail isn't mounted (if we're on the detail, the unsaved note case: closing from the bar while on the detail with a dirty draft — the bar's close would proceed with just "Closing is final." The detail's close warns about notes. Should the bar's body also warn? When on the detail screen with a dirty draft, the bar's close dialog: ideally "Unsaved notes will be lost." too. But the bar doesn't know about the dirty state… should it? Hmm.

Requirement 2 only says "with confirmation." The bar can't know the dirty flag without a shared store. The task says the detail "already tracks a dirty flag" in the context of replacement confirmation. Let's keep the bar's body simple ("Closing is final."). Actually — wait. Could we make the bar's close confirmation also guard against unsaved notes? That would require lifting the dirty state out of the detail screen. The task explicitly positions the existing dirty flag as the mechanism for replacement. Extending it to bar-close is scope creep ("do exactly what the task asks"). Keep it simple.

Now, **the full `queries.ts`**:

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

/**
 * The server is the source of truth for the active session
 * (GET /sessions/active). The cache is the only copy the client keeps, which
 * is why a full reload simply refetches it.
 */
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}

/**
 * The server promotes a fetched session to the active one unless it is
 * closed (GET /sessions/:id). Mirror that in the active cache so the bar
 * follows the screen instead of refetching.
 */
export function mirrorActiveSession(
  qc: ReturnType<typeof useQueryClient>,
  session: Session,
): void {
  if (session.status !== 'closed') {
    qc.setQueryData(sessionKeys.active(), session);
  }
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
      // The server drops the active pointer only when it pointed at the
      // closed session. Mirror that: empty the bar only in that case.
      const active = qc.getQueryData<Session | null>(sessionKeys.active());
      if (active?.id === updated.id) {
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

**The full SessionDetailScreen.tsx**:

```tsx
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { mirrorActiveSession, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const qc = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Opening a session promotes it to the active one on the server (unless
  // it is closed). Mirror that fact here so the bar follows without a
  // refetch.
  useEffect(() => {
    if (session) mirrorActiveSession(qc, session);
  }, [qc, session]);

  // The dirty flag. Every screen that edits uses this shape: local draft vs the
  // cached server value, and a router blocker rather than a beforeunload hack.
  const dirty = session !== undefined && notes !== session.notes;

  const blocker = useBlocker(dirty);

  if (isLoading) return <p>Loading…</p>;
  if (!session) return <p>Session not found.</p>;

  return ( ...unchanged... );
}
```

Import order: the original file imports react first, then react-router. Add the react-query import — let's place it after the router import (the order doesn't matter. Let's keep a consistent style: existing files: `import { useState } from 'react'; import { useNavigate } from 'react-router-dom'; import { Badge } ...`. In queries.ts: react-query first, then api. Mixed. Let me put react, react-router, react-query, then components. Fine.

**AppLayout.tsx** — as above.

Now the **test file** — let me assemble it fully and carefully:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../mocks/db';
import { renderApp } from '../test/render';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };
const bar = (query: 'get' | 'query' = 'get') =>
  (query === 'get' ? screen.getByRole : screen.queryByRole)('region', { name: 'Active session' });
```

Hmm, that helper is awkward. Let me just inline `screen.getByRole('region', { name: 'Active session' })` / `queryByRole`. Let me define:

```tsx
const BAR = { role: 'region', name: 'Active session' } as const;
```

And `screen.getByRole(BAR.role, { name: BAR.name })`. Slightly cleaner. Or a function:

```tsx
function activeBar() {
  return screen.queryByRole('region', { name: 'Active session' });
}
```

And use `expect(activeBar()).toBeInTheDocument()` / `within(activeBar()!)`. The non-null assertion is OK-ish. In the app's test style… they don't use non-null. Let me structure it to avoid `!` where possible:

- For presence asserts: `expect(activeBar()).toBeInTheDocument();`
- For within: `const barEl = activeBar(); if (!barEl) throw ...`? Ugly.

Alternatively, give the bar a **stable accessible landmark**: `aria-label="Active session"` — fine. Use `within(screen.getByRole('region', { name: 'Active session' }))` when we know it's present (getBy throws if absent — which is fine in those spots. It doubles as an assert).

OK let me write it with inline calls. Let me finalize each test. Also add **an assertion in the open/replace test that the server active follows** — no, keep it on the UI.

One more test worth having: **opening a closed session does not make it active** (guard): renderApp('/sessions'), click 'Inspection 3' (closed) → detail shows. Bar absent (active null). This tests `mirrorActiveSession`'s guard + the server's behavior.

```tsx
it('does not make a closed session active', async () => {
  state.user = { ...OPERATOR };

  renderApp('/sessions');

  await waitFor(() => expect(screen.getByText('Inspection 3')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Inspection 3'));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 3' })).toBeInTheDocument());
  expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
});
```

s-003: i=2 → 'closed.' ✓ Deep-linking a closed session works. No bar.

Now, let me count the tests:
1. Fresh load shows the server active (refresh survival) — /orders.
2. Open makes active + persists across screens + replaces.
3. Resume navigates.
4. Close with confirm (cancel + confirm) + the bar empties + the list shows closed.
5. Unsaved-notes confirm before replacement (blocker).
6. Ticking.
7. Logout clears.
8. Deep-link marks active (s-004).
9. No active → no bar.
10. Closed session doesn't become active.

Comprehensive. Good coverage of both the feature and the non-regressions.

Now, recheck **the ordering of test 2 and afterEach reset**: afterEach resets sessions[0] (s-001) — test 4 closes s-001. After test 4, afterEach restores it to open. Subsequent tests (5–10) use s-001? Test 5 uses s-001 (deep-link to detail) — must be open? s-001's detail: the notes work regardless of status. The close button is disabled if closed, but we don't close. The dirty blocker is fine. The bar shows s-001 (server active is set manually). Even if s-001 were closed (if the reset failed), `mirrorActiveSession` would no-op and the bar would… the server's `GET /sessions/active` with activeSessionId 's-001' — the server returns the session regardless of status (the handler: `sessions.find(x => x.id === state.activeSessionId) ?? null` — returns even if closed!). Ha. But the reset ensures it's open anyway.

Wait, actually the reset: `sessions[0] = { ...sessions[0], status: 'open', closedAt: null };` — spread the current (possibly closed) and override status/closedAt. But `closedAt` was set to `new Date().toISOString()` by the close handler — override to null. ✓

Also the `notes` for s-001: 'Awaiting parts.' (i=0, i%4===0). Not mutated (the dirty test leaves without saving). ✓

Now, **does vitest run tests in a file in order?** Yes, serially by default.

**afterEach also resets `state.user = null`** — each test sets its own. ✓ And `state.activeSessionId = null.` ✓

Now — one more possible gotcha: **`renderApp` per test → a new QueryClient each time** (makeQueryClient per call). ✓ no cross-test cache.

**`server.resetHandlers()` in the global afterEach** (setup.ts) — the state object persists in the module registry per file. Our afterEach handles it.

Now — **the fake-timer test + `afterEach` cleanup**: `vi.useRealTimers()` first, then the state reset, then the test's auto-cleanup (registered by testing-library in its own afterEach — order: does testing-library's auto-cleanup register before our file's afterEach? Auto-cleanup registers when @testing-library/react is imported (which registers an afterEach on first import). Import order: testing-library is imported first → its afterEach is registered first → runs last (afterEach is LIFO). Hmm: afterEach hooks run in reverse registration order. testing-library's is registered at import time (before our afterEach defined at module top later). So our afterEach runs first, then cleanup. Fine — `vi.useRealTimers()` runs before the DOM cleanup.

Actually wait, our `afterEach` is defined at the module top level after the imports — registered after testing-library's. Reverse order: ours runs first. ✓

Now — **`vi.setSystemTime` before render** — but `makeQueryClient`/MSW don't use Date in a problematic way. ✓

**`vi.waitFor` and the dialog assertion** — fine.

Now, **the 'Log out' button** — in the header. `getByRole('button', { name: 'Log out' })`. ✓

**The 'Sign in' button** on the login screen — variant primary, text 'Sign in.' ✓

Let me also double-check **`getByLabelText('Notes')`** — the label wraps the textarea: `<label>Notes<textarea…></label>` — the label's text content 'Notes' (plus whitespace) → accessible name 'Notes.' testing-library's `getByLabelText('Notes')` matches by name (string = exact, trimmed?). String matcher is exact match after normalizing whitespace. Name = "Notes." ✓

Now — one more thing I want to reconsider: **should the bar show when the user is on the active session's own detail?** "On all screens" — yes, including the detail. ✓ (tests 5/8 implicitly have the bar on the detail. In test 8, we assert the bar's presence on the detail screen — yes, `renderApp('/sessions/s-004')` and then we assert the bar within the region — the bar is on the detail. ✓)

Now, **the Resume button on its own detail** — a no-op. Fine.

**Potential test flake in test 3 (resume)**: on /orders the bar's 'Resume' — but wait, the orders list also has clickable rows. The 'Resume' button is unique. ✓ After the click, the detail's heading. But the bar is also there with 'Inspection 1' in the name span — `getByRole('heading', { name: 'Inspection 1' })` is unique. ✓

Now — **`within` for a row in the close test**: `screen.getByText('Inspection 1').closest('tr')` — TS: `closest` returns `HTMLElement | null` → `within(row!)`. The `!` is acceptable. Or `within(screen.getByText('Inspection 1').closest('tr')!)`. Fine.

Hmm, actually — a simpler assertion: after the close, the list shows the row. We could instead navigate to the detail and check the 'closed' badge + disabled close button. The list row badge is sufficient.

Now let me also recheck the **ConfirmDialog** rendering: `<div role="dialog" aria-modal="true" aria-label={title}>` — `getByRole('dialog', { name: 'Close this session?' })` ✓. The dialog in the dirty test: the title 'Leave with unsaved notes?' — I query `screen.getByRole('dialog')` (only one dialog is open at that point. The bar's close dialog isn't open). ✓ Then `within(dialog).getByRole('button', { name: 'Leave' })` ✓.

Now — **one more critical flow check: test 5 (dirty → leave → replace).** After clicking 'Leave' (proceed), the navigation to /sessions happens. The detail unmounts (draft discarded). Then we click 'Inspection 2.' The detail s-002 loads → the effect mirrors active to s-002 → the bar updates from 'Inspection 1' to 'Inspection 2.' The waitFor on the bar's text 'Inspection 2.' ✓

But — wait: during this, is there a moment when the blocker dialog could re-appear? The detail s-002 is fresh (not dirty) → no. ✓

Also — **while the dialog is open (blocked)**, the bar shows 'Inspection 1' — fine.

Now, **let me reconsider the "with confirmation if the current one has unsaved notes" once more.** What if the current active session A's detail is dirty and the user opens B — we handle it via the blocker on leaving. ✓ I'm confident.

**Now let me write the AppLayout with the bar** — done above.

**Let me sanity-check the TypeScript strictness issues:**

- `const authed = { id: 'u-1', name: 'Ada', roles: ['operator'] }` — `roles: string[]` ✓. `state.user`'s type: `{ id: string; name: string; roles: string[] } | null` ✓. I'll write `state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };` directly per test (the existing style does exactly this). Let me follow the existing style: set inline per test, no OPERATOR constant. The existing test: `state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };`. Match that.

- `vi` — a global via `types: ["vitest/globals"]` and `globals: true` in the config. But the existing test files explicitly import from 'vitest' (`import { describe, expect, it } from 'vitest'`). Let me import `vi` explicitly too. ✓

- The `useTickingNow` effect cleanup type is fine.

- `formatElapsed` is exported — unused import in tests? Not imported in tests (DOM only). Exported from the bar file. Used internally. ✓ no unused.

Now — **one more architectural question**: should `useActiveSession` be defined in `features/sessions/queries.ts` even though the consumer is in `app/`? The key already lives there (`sessionKeys.active`). The API client is feature-agnostic. Putting the query in sessions/queries.ts is consistent (the active session is a session fact). ✓

**Import cycle check**: `app/ActiveSessionBar.tsx` imports from `features/sessions/queries` — fine, no cycle (queries imports only api).

Now — **the "no client-only persistence" requirement**: we don't add localStorage/sessionStorage. ✓

**Now let me reconsider whether the list screen should do anything** (e.g., show which session is active in the list)? The task doesn't ask for it. Don't.

**Now let me also consider whether the bar's elapsed should pause for a 'paused' status** — the server doesn't model it. Keep ticking from startedAt. The spec says "elapsed time ticking" unconditionally. ✓

Let me also double-check **the `Badge` import in the bar** — yes, used.

**The final test file** — let me write it fully:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../mocks/db';
import { renderApp } from '../test/render';

const barName = 'Active session';
const getBar = () => screen.getByRole('region', { name: barName });
const queryBar = () => screen.queryByRole('region', { name: barName });

describe('ActiveSessionBar', () => {
  afterEach(() => {
    vi.useRealTimers();
    state.user = null;
    state.activeSessionId = null;
    sessions[0] = { ...sessions[0], status: 'open', closedAt: null };
  });

  it('shows the server active session on a fresh load, so it survives a reload', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    const bar = getBar();
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByRole('timer')).toBeInTheDocument();
  });
```

Hmm — `getByRole('timer')` inside the bar ✓.

```tsx
  it('makes a session active when opened, keeps it across screens, and replaces it', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 2')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
  });
```

Wait — after clicking 'Inspection 2' from the list, on the detail screen: `getByText('Inspection 2')` for the initial click was on the list (bar absent). ✓ After navigation, the detail h1 + the bar name both 'Inspection 2' — the waitFor uses within(bar) ✓.

Then the 'Orders' link: unique ✓. Then the 'Sessions' link: on /orders, the nav has both. ✓ Then the list: 'Inspection 1' — but the bar shows 'Inspection 2,' so 'Inspection 1' is unique (the list row). ✓ Click → detail. The bar updates to 'Inspection 1.' within(bar) ✓.

Hmm — subtle: after clicking 'Inspection 1' (row link) — wait, could `getByText('Inspection 1')` match the bar? The bar shows 'Inspection 2' at that moment. No. ✓

```tsx
  it('does not make a closed session active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 3')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 3'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 3' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });
```

s-003 is closed. The detail loads (deep-link-ish from the list). No bar. ✓

But wait — after the detail loads, the `mirrorActiveSession` guard no-ops. The active query: was it fetched? The bar (AppLayout) mounts and fetches active → null (server activeSessionId null) → no bar. ✓

```tsx
  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
  });
```

After resume, on s-001's detail: the heading + the bar's name. ✓

```tsx
  it('asks before replacing the active session while its notes are unsaved', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Notes'), 'x');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());
  });
```

Wait — `within(getBar()).getByText('Inspection 1')` while the dialog is open: the bar also contains… the dialog is a child of the bar div!! `within(bar)` would include the dialog's content. The dialog has 'Leave with unsaved notes?' text + buttons, but not 'Inspection 1.' OK fine.

But — `getBar()` returns the region div. The dialog is inside it. `within(bar).getByText('Inspection 1')` — the bar name span 'Inspection 1.' Unique within (the dialog doesn't have it). ✓

Then after Leave → list. 'Inspection 2' click — on the list, unique? The bar shows 'Inspection 1' → yes, unique. ✓ Then the bar → 'Inspection 2.' ✓

Also, the assertion that the bar still showed 'Inspection 1' while blocked — nice: the replacement didn't happen without the confirm. ✓

```tsx
  it('confirms before closing from the bar and empties on success', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());

    // Asking, then cancelling, changes nothing.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(queryBar()).toBeInTheDocument();

    // Confirming goes through the existing close endpoint and empties the bar.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Close this session?' })).getByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(queryBar()).not.toBeInTheDocument());

    // The close is real: the list now reports the session closed.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    expect(within(screen.getByText('Inspection 1').closest('tr')!).getByText('closed')).toBeInTheDocument();
  });
```

Trace the buttons: first `within(getBar()).getByRole('button', { name: 'Close session' })` — at that moment, only the bar's trigger (dialog closed). ✓ Then the dialog opens. Cancel via `within(dialog)`. ✓ The dialog closes.

Second open: `within(getBar()).getByRole('button', { name: 'Close session' })` — the dialog is closed → unique within the bar. ✓ Then confirm via `within(dialog)`. ✓

After the close resolves: the bar unmounts. But — the mutation is async: `close.mutate` → POST → onSuccess → setQueryData(null) → the bar's re-render removes the region. The waitFor catches it. ✓

Then the 'Sessions' nav link — on /orders, the bar is gone. ✓ The list loads. 'Inspection 1' is unique (no bar). The row → 'closed' badge. ✓

Hmm wait — `closest('tr')!` — TS strict: `Element | null` → `!`. Acceptable in a test. Alternatively, restructure: `const row = screen.getByText('Inspection 1').closest('tr'); expect(row).not.toBeNull(); within(row)...` — let me keep the `!` — common in tests. Hmm, actually `closest` on an `HTMLElement` returns `HTMLElement | null.` testing-library's `getByText` returns `HTMLElement.` So `closest('tr')` → `HTMLElement | null.` `within()` expects `Element | HTMLElement | Document | DocumentFragment.` null is not allowed → `!` needed. Fine.

```tsx
  it('clears the bar on logout', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions');

    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });
```

On /sessions with the bar: within(bar) 'Inspection 1' (the list also has it. Scope). ✓

```tsx
  it('deep links to a detail and marks it active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions/s-004');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 4')).toBeInTheDocument();
  });
```

✓ (s-004 is open.)

```tsx
  it('ticks the elapsed time once per second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 3, 1, 8, 0, 3)));
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
    expect(screen.getByRole('timer')).toHaveTextContent('0h 00m 03s');

    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('0h 00m 04s'));
  });
```

And:

```tsx
  it('stays hidden when the server has no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });
```

Now — **a concern about `vi.waitFor` + fake timers + MSW**: I claimed MSW's resolution is timer-free. Let me recheck msw 2 node: `setupServer` uses `@mswjs/interceptors`' FetchInterceptor. A request is made → the interceptor resolves the response via a promise chain after the handler runs. No setTimeout in the critical path. There's a known caveat: MSW + fake timers can hang if the implementation uses `setTimeout` for something (e.g., some versions schedule). In msw 2.x, I recall it's promise-based. vitest's `vi.waitFor` docs explicitly mention MSW compatibility with fake timers… I'm fairly confident it works. Alternatively, we could avoid fake timers and test ticking another way: render the bar with a real clock, capture the elapsed text, `await vi.waitFor` for a change within ~1.5s (real time) — flaky-ish (up to ~2s wait), no fake timers needed:

```tsx
it('ticks the elapsed time', async () => {
  ...
  const t = screen.getByRole('timer');
  const first = t.textContent;
  await waitFor(() => expect(screen.getByRole('timer').textContent).not.toBe(first), { timeout: 2500 });
});
```

That's real-time-based (a 1s tick) — a bit slow but robust to the MSW timer concern. Hmm. But the precise assertion with fake timers is nicer and faster. Which is lower risk?

The risk with fake timers: if MSW/node uses any timers in the request/response pipeline, the promise would never resolve → `vi.waitFor` times out → test failure. Let me think about @mswjs/interceptors: it wraps fetch. The intercepted request is resolved by invoking the listener, and the response is… in `FetchInterceptor`, the flow: `fetch` is called → the interceptor's `onRequest` returns a promise. The handler's response is converted and returned. It's all promise-based (async/await). No timers. I'm fairly confident.

Also React's `act`-based rendering under fake timers: rendering is synchronous. Effects are scheduled via the scheduler — React uses `MessageChannel`/`setTimeout` for scheduling updates!! React 18's concurrent scheduling uses `MessageChannel` in browsers, `setTimeout` fallback in Node. Under fake timers, if React schedules an update via a faked `setTimeout`, `vi.waitFor` advances the timers → the update flushes. Does vitest's `vi.waitFor` advance timers by 50ms per poll? Actually I think it advances by `interval` (default 50ms)… if React's scheduler delay is up to ~5ms, the 50ms advance covers it. But `MessageChannel` — does sinon fake `MessageChannel`? Does `vi.useFakeTimers()`'s default `toFake` include `messageChannel`? In Vitest 2, the default `toFake` is all of sinon's supported timers: setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, Date, requestAnimationFrame, cancelAnimationFrame, requestIdleCallback, cancelIdleCallback, performMicrotask, nextTick… hmm, MessageChannel is included in vitest's fakeable APIs ('queueMicrotask', 'requestAnimationFrame,' etc.). I think vitest's default fakes everything it supports, including MessageChannel. And `vi.waitFor` handles the advancement.

There's a known pattern of testing-library + React + fake timers in vitest working (with `advanceTimers` in waitFor). I'll go with fake timers + `vi.waitFor` + precise assertions. If `vi.waitFor` doesn't advance enough… it polls in a loop advancing each time until the callback passes or the timeout (default 1s? the default timeout for `vi.waitFor` is 1000ms of "fake" time — hmm, with fake timers, the timeout is in fake time units. It advances… I think it advances up to the timeout). To be safe, let's give `vi.waitFor` a larger timeout: `{ timeout: 5000 }`? If it's in fake-time, that means advancing up to 5s of fake time per waitFor call. Fine.

Hmm wait, actually there's a subtlety with `vi.waitFor` + fake timers: vitest's implementation (v2): `vi.waitFor` uses `setInterval` internally to poll, and if fake timers are active, it advances them. Let me recall the source: vitest's `waitFor` (from the `@vitest/expect`'s `vi.waitFor`) — the implementation:

```js
async function waitFor(cb, options) {
  ...
  if (getConfig().fakeTimers?.toFake?.includes('setInterval') ...) 
```

I recall vitest's `vi.waitFor` docs: "When using fake timers, vitest automatically advances the timers, so that the function can resolve." And it handles it. I'll trust it, with a generous timeout.

Actually — a safer alternative structure that avoids `vi.waitFor` for the initial load under fake timers: use `await waitFor` (testing-library) with `advanceTimers`? testing-library's `waitFor` accepts `advanceTimers` in its config for fake timers. But mixing both waitFors is confusing.

Or: in the ticking test, do the initial load with real timers, then switch to fake? No — Date is also real. The elapsed would be a year-scale. Ticking would still be testable: capture the text, advance… but the interval was created under real timers. We can't advance real timers.

Hmm, let me go with fake timers throughout. This is a standard vitest pattern. I'll add `{ timeout: 5000 }` to the `vi.waitFor` calls to be safe. Actually, the default timeout for `vi.waitFor` is 1000 (same as testing-library's waitFor default? no, testing-library's default is 1000ms too). With fake timers, a 1000ms timeout = 1s of fake time. The load completes in ~0 fake ms (microtasks). 1000 is fine. But let me be generous: 5000.

Hmm, another possible pitfall: **`vi.setSystemTime` and the `sessions` array** — created at module load with `new Date(Date.UTC(...))` — fixed strings, no effect. ✓

**`Date.now()` in `useTickingNow`'s initializer** — the fake Date after setSystemTime → 2024-04-01T08:00:03Z. ✓

Now — **`new Date(active.startedAt).getTime()`** — startedAt is '2024-04-01T08:00:00.000Z.' end - start = 3000ms. formatElapsed(3000) → total=3 → '0h 00m 03s.' ✓

After a 1000ms advance: now=08:00:04 → 4000 → '0h 00m 04s.' ✓

Now — **the bar's region is present when the active is loaded** — `within(getBar()).getByRole('timer')` — the timer renders immediately with the bar. ✓

Also `screen.getByRole('timer')` — a single timer. ✓

Now — **`toHaveTextContent('0h 00m 03s')`** — jest-dom matcher, exact substring by default. The span's text is exactly that. ✓

Now, **the order of `vi.useFakeTimers()` before setting state** — irrelevant.

One more: **the `afterEach` in my file also calls `vi.useRealTimers()` for tests that didn't fake** — harmless.

Now, **does the ticking test leave the interval running after the component unmounts?** The cleanup clears it. The afterEach restores real timers. ✓

**Another possible issue**: in the ticking test, after the assertion, the test ends. The unmount cleanup runs (testing-library's auto-cleanup). Under fake timers — synchronous. ✓

Now, **the `vi.waitFor` import** — `vi` is imported. `vi.waitFor` exists in vitest 2. ✓

Now — let me reconsider **the existing list tests** once more: with the bar in AppLayout, on /sessions the bar fetches `/api/sessions/active` → handler returns null (activeSessionId null) → no bar. The existing assertions are unchanged. ✓ And `onUnhandledRequest: 'error'` — the active URL is handled. ✓

**The deep-link regression** (existing): the RequireAuth waiting on `me()` — unchanged. Test 8 also covers the deep link now.

**Now — is there anything that needs to change in `auth-context`?** Logout already clears the query client. ✓ No.

**`main.tsx`?** No change.

Let me also reconsider **the bar's `useCloseSession` and the detail's `useCloseSession`** — same hook instance semantics. The mutation cache is shared per queryClient (mutationFn is the same) — if both are mounted simultaneously (the detail + the bar on the detail screen), two separate mutation states (each hook instance), but same mutationFn. Closing from either updates the cache identically. If both were pending simultaneously — impossible via UI (one dialog at a time… actually, the detail's close dialog and the bar's close dialog could both be openable: the user opens the detail's close dialog, then the bar's? The dialogs don't stack visually (both render). Edge case: click the detail's 'Close session' (dialog opens), then click the bar's 'Close session' (its dialog also opens), then confirm both → two close POSTs. The second POST: server: the session is already closed → status is set to closed again, closedAt is reset, active already null → returns the session. onSuccess: active check — the active is already null → no-op. The detail cache is set again. Harmless. Not worth guarding.)

Now — **the requirement "on success the bar becomes empty"** ✓.

**Let me also recheck the `ConfirmDialog` props**: `open, title, body, confirmLabel, onConfirm, onCancel` ✓.

**The Button's props**: `variant, disabled, onClick, type` ✓.

Now — **the AppLayout's comment** says "Anything that must appear on every authenticated screen belongs here, above the <Outlet />." The bar is placed in main above the Outlet — consistent with the doc comment (above the Outlet). ✓

Now, **file naming for the bar**: `src/app/ActiveSessionBar.tsx` — matches the PascalCase of `AppLayout.tsx`/`LoginScreen.tsx` in the same directory. ✓

**Test file**: `src/app/ActiveSessionBar.test.tsx` — matches the `SessionsListScreen.test.tsx` co-location. ✓

Now let me reconsider **the `enabled` flag for `useActiveSession`** once more… the bar only renders under the layout. But consider the **login → authenticated transition**: the layout mounts, the query fires. ✓ Consider **logout**: the unmount. But there's a window: `logout()` awaits the API, then setUser(null) + clear. Between the click and setUser, the bar is still mounted (user is still set). No refetch. ✓

And the **`queryClient.clear()` inside logout** — clears the active data. The bar would render null on re-render if it stayed. But the layout unmounts anyway. ✓

**I think the design is solid.** Let me also think about whether the `mirrorActiveSession` call should be in `useSession` via a `useEffect` — or if we should use the query's `select`/`onSuccess` — queries don't have onSuccess. The effect is the right place.

Alternatively, a cleaner place: a `useEffect` in AppLayout that mirrors the current detail route? No — the detail screen owns the session data.

OK — also, **the `mirrorActiveSession` naming** — maybe `setActiveSession`? The file's pattern: `patchLists`, `patchOrder` (orders) — imperative cache-write names. `mirrorActiveSession` is descriptive. Or `writeActiveSession`? Let me go with `mirrorActiveSession` — it conveys "the server is the source, we mirror."

Hmm, actually, to match the app's concise naming (`patchOrder`, `patchLists`), maybe `setActiveSession(qc, session)`. But "set" could imply a client-originated fact. "mirror" is accurate. Keep `mirrorActiveSession.`

Now, **final check on the `SessionDetailScreen` import ordering**:

```tsx
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
...
```

The original order: react, react-router, components, queries. Insert the react-query line — fine.

Now, let me write the **final `queries.ts`** in full (done above).

**The final `AppLayout.tsx`** (done).

Let me also re-examine the **`getBar`/`queryBar` helpers** — I define them. But `getBar` used in `within(getBar())` throws if absent — which is fine in spots where presence is established. In the dirty test, `within(getBar()).getByText('Inspection 1')` while the dialog is open — the bar is present (server active is set). ✓

Wait, in the dirty test — is the bar actually present at that point? The initial render on `/sessions/s-001`: the active query fetches → s-001 (server activeSessionId 's-001') → the bar shows 'Inspection 1.' And the detail also loads. The `waitFor` on the heading doesn't guarantee the bar has loaded. The subsequent `within(getBar())` could throw if the active fetch is still pending! Race. Fix: use `waitFor` for the bar first, or assert the bar's presence before the click:

```tsx
await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
```

after the heading waitFor (or before). Let me restructure:

```tsx
renderApp('/sessions/s-001');
await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
await userEvent.type(screen.getByLabelText('Notes'), 'x');
...
```

✓ safer.

Similarly the **close test**: I wait for the orders list, then click the bar's close — the bar may be pending! Need `await waitFor(() => getBar())` — actually, the first action queries the bar: `within(getBar()).getByRole(...)` — could throw if pending. Add:

```tsx
await waitFor(() => expect(getBar()).toBeInTheDocument());
```

before interacting. Let me add this pattern to every test that interacts with the bar: resume test, close test, dirty test, logout test. The open/replace test's waitFor already waits on the bar's content. The fresh load test waits on the orders list, then `getBar()` — same race! Add the bar waitFor there too. Let me standardize: after the list/detail settle, `await waitFor(() => expect(getBar()).toBeInTheDocument())` (or the content waitFor, which implies presence).

Updated:

Test 1:
```tsx
await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
await waitFor(() => expect(getBar()).toBeInTheDocument());
```
Then assert the content.

Test 3 (resume):
```tsx
await waitFor(() => expect(getBar()).toBeInTheDocument());
await userEvent.click(within(getBar()).getByRole('button', { name: 'Resume' }));
```

Test 4 (close): add `await waitFor(() => expect(getBar()).toBeInTheDocument());` after the orders wait.

Test 7 (logout): I already wait on the bar's content. ✓

Test 6 (ticking): `vi.waitFor(() => within(getBar())...)` ✓.

Test 2: the `waitFor` on the bar's content after opening ✓. The "keep across screens" assert `within(getBar()).getByText('Inspection 2')` — the bar is already established. ✓

Test 5 (deep link): the heading waitFor, then the bar content waitFor — `expect(within(getBar())...)` could race → use waitFor:
```tsx
await waitFor(() => expect(within(getBar()).getByText('Inspection 4')).toBeInTheDocument());
```
✓

Test 9 (no active): after the orders wait, assert no bar — safe (it would never appear). ✓

Test 3b (closed session): after the heading, assert no bar — could the active query still be pending? The server's active is null → the bar would never appear. Safe. ✓

Now, **one more race in test 2**: after clicking 'Inspection 2' (list→detail), the `waitFor` on the bar's 'Inspection 2' — the bar appears when: the detail fetch resolves (server sets active) AND the effect mirrors. ✓ covered.

Then the 'Orders' link click → the orders list wait. Then `within(getBar()).getByText('Inspection 2')` — the bar is present (already established, and persists — the query isn't cleared on navigation). ✓

Then the 'Sessions' link → the list wait → 'Inspection 1' click → the bar's 'Inspection 1' waitFor. ✓

Now — **the subtle issue in test 2**: `screen.getByText('Inspection 2')` at the start — on the list, that text is in a `<Link>`. But the bar is absent (active is null) — though pending. The `waitFor` waits for 'Inspection 2' (the list row). The list loads independently. Then `expect(queryBar()).not.toBeInTheDocument()` — the active fetch may be pending → the bar is absent (correctly, since it would never appear). ✓ Then the click. ✓

Now, **userEvent + the blocker dialog in test 5**: click the 'Sessions' link → blocked. The dialog renders. `screen.getByRole('dialog')` — synchronous after the click? The navigation attempt → the blocker state change → a synchronous re-render during the click's act. `userEvent.click` is awaited → the update is flushed. `screen.getByRole('dialog')` should find it. ✓ (existing app relies on this pattern.)

Now — **`userEvent.type(screen.getByLabelText('Notes'), 'x')`** — the textarea exists after the heading waitFor (same render). ✓

Now, **the dialog's 'Leave' button**: `within(dialog).getByRole('button', { name: 'Leave' })` ✓.

After Leave: `waitFor` the heading 'Sessions' — the list. But the 'Sessions' heading — h1 'Sessions.' And the nav link 'Sessions' (not a heading). ✓ unique.

Then click 'Inspection 2' — on the list: the row + the bar shows 'Inspection 1' → unique. ✓

Then `waitFor` on the bar's 'Inspection 2.' ✓

Now, **the order of tests in the file and the `sessions[0]` reset** — the close test (test 4 in my list) mutates s-001. afterEach restores. The tests that follow use s-001 assuming it's open ✓.

Also the **ticking test** uses s-001 — must be open (it is, after the reset. And before the close test in file order if I order it that way). Let me order the tests so the close test is last. Order:

1. Fresh load (s-001 active, read-only).
2. Open/keep/replace (s-002, s-001 — read-only open).
3. Closed session not active (s-003).
4. Resume (s-001).
5. Unsaved-notes confirm (s-001, no save).
6. Deep link (s-004).
7. Ticking (s-001, fake clock).
8. Logout (s-001).
9. No active → no bar.
10. Close with confirm (s-001) — last (mutates).

afterEach reset covers the mutation anyway.

Now — **the `sessions[0]` reset in afterEach**: `{ ...sessions[0], status: 'open', closedAt: null }` — the `Session` type requires all fields. The spread provides them. ✓

Also reset `notes`? No test saves notes. The dirty test types 'x' but leaves without saving → no PATCH. ✓ (The textarea is local state.)

Hmm wait — actually let me double-check: in the dirty test, after typing 'x' and leaving via the blocker, the component unmounts. No PATCH was sent (the 'Save notes' button wasn't clicked). The server's s-001.notes is unchanged. ✓

Now — **the `state.user` reset**: set to null in afterEach. But the next test sets it before render. ✓

Now, **let me reconsider the `renderApp` signature**: `renderApp(initialPath = '/sessions')` ✓.

**Import path for `renderApp` from `src/app/`**: `../test/render` ✓ (test is at src/test/render.tsx).

**Import for `state`, `sessions`**: `../mocks/db` ✓.

Now — let me also think about whether the **`bar` region's name could collide with something else** — no other region with that name. ✓

**A11y**: a `role="timer"` element — testing-library queries by role work for any ARIA role. ✓

Now, **the `formatElapsed` for a paused session** — ticks. Fine.

**Let me reconsider the requirement "the bar shows its key fields (name, status, elapsed time ticking)"** — ✓ name span, status badge, timer span.

**"Visible on every authenticated screen"** — ✓ AppLayout.

Now, any **`aria-busy` or loading state for the bar**? Not required.

I think I'm ready to write the final answer. Let me also double-check **no `ASSUMPTION` comments are needed** — everything was present in the scaffold. One point: the semantics that "opening a session makes it active" — the mock server implements it on GET detail. We mirror it. That's the "most defensible reading" grounded in the provided handlers — no assumption needed.

Wait — one more: **`useActiveSession` when the user is not authenticated** — the bar doesn't render outside the layout. But the deep link: `/sessions/:id` → RequireAuth → `me()` → 401 → user null → /login. The layout doesn't render. The active query isn't called. ✓ (If called, the server returns 401 → the query errors → the bar… the layout doesn't render anyway.)

**Now let me write the final files.**

Actually — wait. Let me reconsider **the `mirrorActiveSession` effect's dependency on the `session` object**. The `session` from `useSession(id)` — the data. When the detail cache is updated by a notes save, the new object → the effect re-runs → re-sets active (same id) — fine.

But here's a subtle scenario: **the user is on A's detail (active=A). Navigates to the list. Clicks A again** — the detail cache is fresh (30s) → the data is the same object? `useSession` returns the cached data (same reference) → the effect doesn't re-run (no identity change) — but active is already A. ✓

And **stale-while-revalidate**: the refetch yields a new object → the effect re-runs → same id. ✓

**Scenario: the active is A. The user opens B (active becomes B). Then the user navigates back to A's detail** — A loads (fresh or cache) → A becomes active again (the server does this on GET). Consistent with "opening makes it active." ✓

OK. Now — **the `qc` variable name in the detail** — fine.

**One more consideration for the `useCloseSession` change**: `qc.getQueryData<Session | null>(sessionKeys.active())` — the `active()` key is `readonly ['sessions', 'active']`. `getQueryData` accepts `QueryKey`. ✓

Let me also confirm **`setQueryData(sessionKeys.active(), null)`** — allowed. Data is typed `Session | null | undefined.` ✓

Now the **final test file** — let me assemble it with all the waits. Also, I want each test to have meaningful assertions (per the rules: never assert only on calls. Each test asserts on the UI). ✓

Also **the "fresh load" test title** — models a refresh. In a comment: a fresh `renderApp` = a new query client + router, i.e., a page reload.

Let me also re-examine **`vi.waitFor` vs `waitFor` in the fake-timer test** — I use `vi.waitFor` for both. ✓

And **`vi.advanceTimersByTime(1000)`** — triggers the interval callback → `setNow` → a React re-render (batched, scheduled). `vi.waitFor` advances until the text updates. ✓

Potential issue: React 18's `setInterval` callback → `setNow` → the update is scheduled via the scheduler (MessageChannel — faked). `vi.waitFor` advances the fake timers including the message channel? If MessageChannel is faked, its port messages are driven by timer advancement. sinon's fake `MessageChannel` — when the channel is ported, it's triggered via `setTimeout(0)` internally, which is faked → advanced by `vi.waitFor.` I believe vitest handles this (common pattern: testing React with fake timers in vitest works, e.g., for `useEffect` intervals). Yes — the classic "ticking clock" test with fake timers is a documented vitest pattern. ✓

Let me set the `vi.waitFor` timeout to 5000 in the ticking test to be safe.

Now — **`await vi.waitFor(() => expect(...))`** — the callback returns a promise. vi.waitFor awaits it. On throw, it retries. ✓

Edge case: **the first `vi.waitFor` in the ticking test** — the bar + timer must appear. Under fake timers, the load is microtask-only. ✓

Now, **the `renderApp` inside the fake-timer test** — `createMemoryRouter` is fine.

**Final: let me also make sure I don't break the `tsc -b` build** — all types are OK. `noUnusedLocals`: in the bar file, all imports are used: useEffect, useState, useNavigate, Badge, Button, ConfirmDialog, useActiveSession, useCloseSession. ✓ In the detail: useQueryClient used. mirrorActiveSession used. ✓ In the test file: screen, waitFor, within, userEvent, afterEach, describe, expect, it, vi, sessions, state — all used? `vi` used in the ticking test + the afterEach useRealTimers. ✓ `sessions` used in the afterEach reset. ✓

**AppLayout**: imports the ActiveSessionBar and uses it. ✓

Now let me write everything out.

One more stylistic check on the **test file header comment** — the existing tests have no header comment. Let me keep it minimal.

Also — **the `getBar`/`queryBar` helpers**: I'll define:

```tsx
const getBar = () => screen.getByRole('region', { name: 'Active session' });
const queryBar = () => screen.queryByRole('region', { name: 'Active session' });
```

Used appropriately.

Let me also reconsider the **assertion on the dialog title in the close test** — I query `getByRole('dialog', { name: 'Close this session?' })` which asserts the dialog opened with that title. ✓ That's the "with confirmation" evidence.

Now — in the close test, after Cancel: `expect(queryBar()).toBeInTheDocument()` — the bar persists. ✓ And the dialog is gone ✓.

Also — **should the close test assert the bar is still there during the dialog** (i.e., the close hasn't happened yet)? Implicit.

Also, **the `within(screen.getByText('Inspection 1').closest('tr')!)` in the close test** — hmm, `closest` on an HTMLElement: `screen.getByText` returns `HTMLElement.` `.closest('tr')` → `HTMLElement | null.` The `!` → OK.

Actually, let me simplify: use `within(screen.getByRole('row', { name: /Inspection 1/ }))`? Row role: `<tr>` has the implicit row role inside a table. `getByRole('row', { name: 'Inspection 1' })` — the row's accessible name = concatenation of its cells: "Inspection 1 Ada closed" (for s-001 after close: name, operator Ada, closed). Use the regex `/Inspection 1/`. Then `within(row).getByText('closed').` That's cleaner and more a11y-native. Let me use:

```tsx
const row = screen.getByRole('row', { name: /Inspection 1/ });
expect(within(row).getByText('closed')).toBeInTheDocument();
```

Wait — `getByRole('row', { name: /Inspection 1/ })` — the name matcher is a regex against the computed name "Inspection 1 Ada closed" → matches. Unique (only one Inspection 1 row). ✓

Good.

Now, the **logout test** — after logout, the login form: `getByRole('button', { name: 'Sign in' })` ✓.

Also assert `state.activeSessionId`? No — UI only.

I think I'm done. Let me also reconsider **whether to add `aria-label` on the elapsed's parent for the timer role** — a `role="timer"` with text content is self-named. ✓

**Writing the files now.**

Order of the file output: any order. Let me do: queries.ts, SessionDetailScreen.tsx, ActiveSessionBar.tsx, AppLayout.tsx, ActiveSessionBar.test.tsx.

Let me write the complete SessionDetailScreen:

```tsx
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { mirrorActiveSession, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const qc = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Opening a session promotes it to the active one on the server (unless it
  // is closed). Mirror that fact here so the bar follows without a refetch.
  useEffect(() => {
    if (session) mirrorActiveSession(qc, session);
  }, [qc, session]);

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

✓ minimal diff (add import, qc, effect).

Now — a final thought on **the `mirrorActiveSession` when the detail's query refetches** (e.g., staleTime expiry on remount): same session → idempotent. But consider: active is B (user was on B's detail, navigated to list, clicks A → A's detail loads → active=A). Then they navigate to B's detail again (via… the list) → B loads → active=B. That's "opening makes it active" — consistent with the server. ✓

**Final answer files.** I'll also re-verify the test's use of the `bar` region's name for `getByRole` with the `{ name }` option — testing-library's ByRole options accept `name.` ✓

Also — **`queryBar()` used with `expect(queryBar()).toBeInTheDocument()`** — jest-dom's toBeInTheDocument works on null? `expect(null).toBeInTheDocument()` → fails with a message. ✓ And `expect(queryBar()).not.toBeInTheDocument()` ✓.

The **ticking test's `expect(screen.getByRole('timer')).toHaveTextContent('0h 00m 03s')`** — after the initial `vi.waitFor` established the bar. The text is computed with now=08:00:03. But — could the interval have already ticked between the load and the assertion? The interval is created on enable. No advance happened → no tick. `vi.waitFor` may advance the fake clock internally! Hmm — `vi.waitFor` advances timers to poll. If it advances, say, 50ms per poll, and several polls are needed for the async load… could it advance past 1000ms and tick to 04s before my assertion?? The load completes in the first few polls (microtask resolution — no timer advancement needed. But `vi.waitFor`'s implementation advances on each iteration). Let me think: `vi.waitFor`'s loop: run the callback (async). If it rejects, wait `interval` (default 50ms) — under fake timers, it advances 50ms and re-runs. The number of iterations until the load resolves: the load requires several microtask turns (me() fetch, then active fetch, then render). Each `vi.waitFor` iteration awaits the callback, which itself awaits internally? testing-style: the callback `() => expect(...)` — a synchronous throw, no internal await. So the iteration: try → throw → advance 50ms → try → … the fetch resolution happens during the await of the advance (microtasks flush between advances). The fetch resolves in 1-2 microtask turns → the first or second iteration after the promise resolves. The advancement total: a few × 50ms = up to ~150ms < 1000ms → no tick. The text is '03s.'

But is that guaranteed? The MSW round trip: `me()` (AuthProvider) → render the layout → the active fetch → render the bar. Each HTTP round trip via the interceptor: a few microtasks. `vi.waitFor`'s advance: I believe it awaits a real-timer promise?? No — under fake timers, it must use the faked mechanism… vitest's `vi.waitFor` implementation (v2):

```js
async function waitForState(fn, options) {
  const { interval = 50, timeout = 1000 } = options;
  ...
  // If fake timers are enabled, use them
  const advanceTimers = ...
}
```

I recall it uses `await new Promise(resolve => setTimeout(resolve, interval))` — which under fake timers never resolves without advancement. So it must advance. The vitest source (packages/vitest/src/integrations/vi.ts or the expect package) — `vi.waitFor`:

```ts
if (fakeTimers) {
  // advance timers while waiting
}
```

The actual implementation: it catches the rejection, then `if (isFakeTimers) { vi.advanceTimersByTime(interval) }` and loops. The exact mechanism aside, the total advancement before resolution is small (a few intervals). A few × 50ms = a few hundred ms. Even 10 polls = 500ms < 1s. Safe.

To be even safer, I could set the system time to 08:00:05 so even a stray tick or two wouldn't break the exact assertion… no — a stray 1000ms advancement changes '03s'→'04s' and my exact assert would fail. Let me make the first assertion a format check rather than exact, then test the delta:

Option:
```tsx
await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
const first = screen.getByRole('timer').textContent;
vi.advanceTimersByTime(1000);
await vi.waitFor(() => expect(screen.getByRole('timer').textContent).not.toBe(first));
```

This asserts ticking (text changes after 1s) without fragility about the exact second. But it's weaker (a format assertion is nice too). Combine:

```tsx
const timer = () => screen.getByRole('timer');
await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
expect(timer().textContent).toMatch(/^\d+h \d{2}m \d{2}s$/);
const first = timer().textContent;
vi.advanceTimersByTime(1000);
await vi.waitFor(() => expect(timer().textContent).not.toBe(first));
```

The regex asserts the format including seconds (evidence that it ticks). The delta asserts the live update. Robust against stray advances.

But the exact '03s' assertion is a stronger proof that the elapsed is computed from startedAt… the format regex + the fact that it's non-zero… hmm, if the computation were wrong (e.g., 0), it'd be '0h 00m 00s' — the regex still matches. To assert a positive elapsed: with the system time at 2024 (a year after start), the days part should appear: `expect(timer().textContent).toMatch(/^\d+d \d+h \d{2}m \d{2}s$/)`. Since now ≈ 2025-06 (real) but the fake is set to 2024-04-01T08:00:03 → elapsed 3s → no days! '0h 00m 03s.' So with the fake time 3s after start, the days part is absent. Set the fake time to, say, 2024-04-02T09:03:03 → elapsed 1d 1h 3m 3s → '1d 1h 03m 03s' — the regex `/^\d+d \d+h \d{2}m \d{2}s$/` proves the days/hours/minutes/seconds computation. Then advance → '1d 1h 03m 04s' (the delta).

Let me do:
```tsx
vi.setSystemTime(new Date(Date.UTC(2024, 3, 2, 9, 3, 3)));
...
expect(timer().textContent).toBe('1d 1h 03m 03s');
```
Exact! startedAt s-001 = 2024-04-01T08:00:00Z. now = 2024-04-02T09:03:03Z → delta = 1d 1h 3m 3s = 86400+3600+183 = 90183s. formatElapsed: days=1, hours=(90183/3600 floor=25)%24=1, minutes=(90183/60 floor=1503)%60=3, seconds=90183%60=3 → '1d 1h 03m 03s.' ✓ Exact assertion is possible — if `vi.waitFor` doesn't stray past 1s. The risk of a stray tick: the first waitFor advances a few × 50ms. Even in the worst case, 20 polls = 1s → a tick → '04s' → failure. How many polls does the load need? Each poll awaits the callback (synchronous) and then a 50ms fake advance (with microtask flush in between). The load chain: me() fetch (microtask) → auth render → active fetch (microtask) → bar render. React's rendering with `act`… the fetch promises resolve in microtasks that flush on each `await`. The first waitFor iteration: the callback runs (bar absent) → advance 50ms (await → microtasks flush: me() resolves) → iteration 2: bar? the auth state is updated, the layout renders synchronously? React state updates outside act → in the test env, RTL's render wraps in act. Subsequent updates from the promise callback — does React 18 batch and flush in microtasks? The update is scheduled → flushed… in the test, `await`ing the advance gives React a chance. So by iteration 2-3 the layout is there. The active fetch is issued. Resolves on the next microtask flush → the bar is there by iteration 3-4. Total advance ≈ 150-200ms. Well under 1s. Safe enough. And even if one extra poll happened — 500ms — still fine. Let me go with the exact assertion, and also assert the tick:

```tsx
vi.advanceTimersByTime(1000);
await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 04s'));
```

Exact again. If the first assertion passed with '03s,' then exactly one 1s advance → '04s' — but `vi.waitFor` may advance more (polling) → '05s,' '06s'… → failure!! Ugh. `vi.waitFor` advances 50ms per poll. To reach '04s'… the tick happens when the cumulative advance crosses a 1s boundary of the interval. The interval fires on each 1000ms elapsed from the interval creation. Hmm, the interval was created at fake time T0 (on enable). It fires at T0+1000, T0+2000, … My `advanceTimersByTime(1000)` moves the clock 1s. Plus waitFor's polling advances add more. The text at the end of waitFor = however many interval fires happened. If the cumulative from T0 is 1000+x (x from polling, <1000), exactly one fire → '04s.' As long as waitFor's own polling advance < 1000ms (i.e., the assertion passes within ~20 polls), it's '04s.' The assertion becomes true after the tick renders. The tick fires during the 1000ms advance (the advanceTimersByTime runs all timers due in that window) → the setNow happens during advanceTimersByTime (synchronously running the interval callback) → React schedules the update. waitFor's first poll (50ms later) sees '04s' (if the render flushed). So it passes on the first or second poll → +0 or 50ms → still only one fire. '04s' holds. ✓

And the first exact assert: the risk is a stray fire before it. The bar appears ~150-200ms of fake advance. The interval is created at T0 ≈ when the bar enabled (the same time). A fire at T0+1000 would require 1000ms of advance after T0 — but T0 is near the end of the load (~150ms), and the assertion runs right after → the total advance after T0 ≈ 0-50ms. No fire. '03s.' ✓

OK, confident. Let me finalize the ticking test:

```tsx
it('ticks the elapsed time, starting from the server startedAt', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2024, 3, 2, 9, 3, 3))); // 1d 1h 3m 3s after s-001 started
  state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  state.activeSessionId = 's-001';

  renderApp('/orders');

  await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
  expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 03s');

  vi.advanceTimersByTime(1000);
  await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 04s'));
});
```

Good.

Now let me double-check **`Date.UTC(2024, 3, 2, 9, 3, 3)`** — month 3 = April. April 2, 09:03:03 UTC. startedAt April 1 08:00:00. Delta: April 1 08:00 → April 2 08:00 = 86400s. +1h 3m 3s = 3600+183=3783. Total 90183s ✓. days=90183//86400=1. hours=(90183//3600)%24=25%24=1. minutes=(90183//60)%60=1503%60=3 (1503=25*60+3). seconds=90183%60=3 (90183=1503*60+3). ✓ '1d 1h 03m 03s.'

Now, also re-verify **`vi.useRealTimers()` in afterEach** — for every test. ✓

Also — **the `getBar` helper defined at module scope** uses `screen` — fine.

Now, also — **the test 1 title mentions "survives a reload"** — I'll add a comment line: "A fresh renderApp is a new router + query client: the same state as a full page reload. The bar must come back from GET /sessions/active, not from client persistence."

Let me also reconsider: should I add a **test that the bar data specifically comes from the API** (not client-only)? Test 1 does: state.activeSessionId is set server-side. A fresh render has no prior client state. The bar appears. That proves the API source. ✓

Now — **the final file list**:

1. `src/features/sessions/queries.ts`
2. `src/features/sessions/SessionDetailScreen.tsx`
3. `src/app/ActiveSessionBar.tsx`
4. `src/app/AppLayout.tsx`
5. `src/app/ActiveSessionBar.test.tsx`

Format: a level-3 heading with the path, followed by a fenced block. Nothing else.

Let me write the full test file once more, carefully, checking every line:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../mocks/db';
import { renderApp } from '../test/render';

const getBar = () => screen.getByRole('region', { name: 'Active session' });
const queryBar = () => screen.queryByRole('region', { name: 'Active session' });

describe('ActiveSessionBar', () => {
  afterEach(() => {
    vi.useRealTimers();
    state.user = null;
    state.activeSessionId = null;
    sessions[0] = { ...sessions[0], status: 'open', closedAt: null };
  });

  it('shows the server active session on a fresh load, so it survives a reload', async () => {
    // A fresh renderApp is a new router and query client — the same starting
    // point as a full page reload. The bar must come back from
    // GET /sessions/active, not from any client-side persistence.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());

    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(getBar()).getByText('open')).toBeInTheDocument();
    expect(within(getBar()).getByRole('timer')).toBeInTheDocument();
  });

  it('makes a session active when opened, keeps it across screens, and replaces it', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 2')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());

    // The bar follows the operator to other screens.
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument();

    // Opening another session replaces the active one.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
  });

  it('does not make a closed session active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 3')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 3'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 3' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('asks about unsaved notes before the active session is replaced', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Notes'), 'x');

    // Leaving with a dirty draft is confirmed by the detail screen's existing
    // blocker; the replacement only happens after that confirmation.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());
  });

  it('confirms before closing from the bar and empties on success', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());

    // Asking, then cancelling, changes nothing.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(queryBar()).toBeInTheDocument();

    // Confirming goes through the existing close endpoint and empties the bar.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Close this session?' })).getByRole('button', { name: 'Close session' }),
    );
    await waitFor(() => expect(queryBar()).not.toBeInTheDocument());

    // The close is real: the list now reports the session closed.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /Inspection 1/ })).toBeInTheDocument());
    expect(within(screen.getByRole('row', { name: /Inspection 1/ })).getByText('closed')).toBeInTheDocument();
  });

  it('deep links straight to a detail and marks it active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions/s-004');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
    await waitFor(() => expect(within(getBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('clears the bar on logout', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions');

    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('ticks the elapsed time from the server startedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 3, 2, 9, 3, 3))); // 1d 1h 3m 3s after s-001 started
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
    expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 03s');

    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 04s'));
  });

  it('stays hidden when the server has no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });
});
```

Let me check a few remaining details:

- **The 'does not make a closed session active' test**: after the click on 'Inspection 3' (a closed row link), the detail s-003 loads. `mirrorActiveSession` is a no-op. But wait — could the active query have cached something? No, the server active is null. And `expect(queryBar()).not.toBeInTheDocument()` — the active fetch may be pending → the bar is absent anyway. Safe (it would never appear).

  Hmm, but also — **the list's row click**: the row is a `<tr>` with a Link inside. `userEvent.click(screen.getByText('Inspection 3'))` clicks the link. ✓

- **The deep-link test**: `renderApp('/sessions/s-004')` — RequireAuth: `me()` → user set → Outlet → layout + detail. The detail fetch → the server sets activeSessionId='s-004' → the effect mirrors → the bar. Also the layout's active query — when was it fetched? On layout mount — before the detail fetch set the server's active! Order: the layout mounts → the active query is issued → the server's activeSessionId is null at that moment?? Wait — the detail query is also issued (the detail screen mounts at the same time). Both in flight. The mock handlers run in the order the requests arrive. If the active GET resolves before the detail GET, the active cache = null. Then the detail GET sets the server's active. The effect mirrors s-004 into the active cache. Bar shows. ✓ If the detail resolves first, the active GET returns s-004 → the cache is s-004. The effect re-sets it. ✓ Either way the bar ends up with s-004. And the `waitFor` handles the timing. ✓

  But hmm — a subtle race: the active query fetches null (resolves first), caches null. Then the effect sets s-004. Bar appears. ✓ The reverse order: the active fetch returns s-004. ✓ Both fine.

- **The resume test**: after clicking Resume, the detail s-001 loads (a fresh fetch, since a new client) → the effect mirrors (already active). The heading. ✓

- **The logout test**: on /sessions, the bar's 'Inspection 1' — the list also has 'Inspection 1' (a row) → scoped to within(bar) ✓. Click Log out → api.logout → the server's user is null, active is null → setUser(null) → RequireAuth → /login → the 'Sign in' button. The bar is gone (no layout). ✓

  Wait — one thing: after logout, is there a redirect that briefly shows the layout? RequireAuth: user null → Navigate. The layout unmounts in the same commit. ✓

- **The 'stays hidden' test**: the orders list loads. The active fetch is null. No bar. ✓

- **The open/replace test's initial `expect(queryBar()).not.toBeInTheDocument()`** — discussed, safe.

- **userEvent + the link click that triggers the blocker** — the click on the 'Sessions' link is blocked: does userEvent throw? No — the navigation is intercepted. The DOM is unchanged (the dialog appears). ✓

- **`within(dialog).getByText('Leave with unsaved notes?')`** — the dialog's h2. ✓

- **After 'Leave':** the proceed → the navigation to /sessions → the list. `getByRole('heading', { name: 'Sessions' })` — h1. ✓ But wait — the blocker dialog: after proceed, it unmounts. ✓

- **Then `screen.getByText('Inspection 2')`** — on the list: unique (the bar shows 'Inspection 1'). ✓ Click → detail s-002 → the bar replaces. ✓

Now, **`vi.waitFor` with the default timeout of 1000 fake ms** — the load needs < 1s of fake advance. The microtask-only chain → yes.

Hmm, one more: **`vi.useFakeTimers()` also fakes `Date`** — so `new Date()` in the MSW handler (the close handler uses `new Date()` for closedAt) — not used in the ticking test. Fine.

Also **`userEvent` isn't used in the fake-timer test** ✓.

**TS strict on `sessions[0] = { ...sessions[0], status: 'open', closedAt: null }`** — `sessions` is `Session[]`. `sessions[0]` is `Session` (noUncheckedIndexedAccess isn't enabled — the tsconfig has strict but no `noUncheckedIndexedAccess` → index returns `Session`). ✓ The spread + override → `Session.` `status: 'open'` is assignable to SessionStatus ✓.

**`state.activeSessionId = null`** ✓ the type is `string | null.`

Now — **the `afterEach` registration**: my file's `afterEach` is inside the describe — runs after each test in the describe. ✓

**One more possible snag**: the **`sessions[0]` reset via reassignment** — the `sessions` array is imported as a module binding. Reassigning an element is fine (the handlers read the array on each request). ✓

**`getByRole('row', { name: /Inspection 1/ })`** — the row's accessible name: "Inspection 1 Ada closed" (the cells). The regex matches. ✓ (Before close it'd be "Inspection 1 Ada open" — but we query after close.)

Wait — in the close test, after the close, the list is freshly fetched (we weren't on /sessions before). The row's status is closed. ✓

Also — **`within(row).getByText('closed')`** — the Badge's text. But the row's name also contains 'closed' — `getByText` matches an element's text content. The Badge span contains 'closed.' ✓

Now, **any collision with `getByRole('button', { name: 'Log out' })`** — the header. ✓

I'm fairly confident in the solution. Let me also double-check **that the existing `SessionsListScreen.test.tsx` still passes** with my changes — the list is unchanged. The layout adds the bar (the active fetch is null → no bar). The tests' assertions are unaffected. ✓

And **the `tsc` check**: the test file uses `vi.setSystemTime(new Date(...))` ✓. The `vi.waitFor` typing: `(cb: () => Promise<void> | void, options?)` — my callback returns a void from the expect… `() => expect(...)` returns the `expect` result (void-like). The signature expects `() => Promise<void>`. `() => expect(x).toBeInTheDocument()` returns `void` (the matcher returns void). ✓ Actually, `expect().toBeInTheDocument()` returns `void.` A `() => void` is assignable to `() => Promise<void> | void`? Hmm, the callback type for `vi.waitFor`: `() => Promise<void>`. A `() => void` function — is it assignable to `() => Promise<void>`? In TS, void return vs Promise<void> return: a function type `() => void` is not assignable to `() => Promise<void>`… actually, vitest's typing: `waitFor: (fn: () => Promise<void>, options?: ...)`. Passing `() => expect(...).toBeInTheDocument()` (which returns void) — TS: `() => void` vs `() => Promise<void>` — not directly assignable? Hmm. Let me recall vitest's actual signature (v2):

```ts
waitFor: (fn: () => Promise<void>, options?: { timeout?: number, interval?: number }) => Promise<void>
```

And the common usage: `await vi.waitFor(() => expect(x).toBeInTheDocument())` — this is the documented usage! Because the matcher `toBeInTheDocument()` returns `void`… and TS accepts `() => void` where `() => Promise<void>` is expected? No — TS's assignability: the return type void vs Promise<void>: a source returning void is assignable to a target returning T? The rule: the source's return type must be assignable to the target's return type. void is not assignable to Promise<void>… but there's a special rule: when the target's return type is `Promise<void>`? No such special rule.

Hmm wait — actually jest-dom matchers return `void`… but the documented vitest usage `vi.waitFor(() => expect(...).toBe(...))` is ubiquitous. Let me think about why it compiles: vitest's `vi.waitFor` signature in v2 is:

```ts
waitFor: (fn: () => void | Promise<void>, options?: WaitForOptions) => Promise<void>
```

I believe it accepts `() => void | Promise<void>`. Yes — looking at the vitest source (vitest/src/integrations/vi.ts): `waitFor: (fn, options) => expectPoll(fn, options)` and `expectPoll`'s typing is `PollFn = () => void | Promise<void>`. The polling function can throw synchronously. So `() => void` is fine. ✓ The ubiquitous pattern compiles. Good.

And testing-library's `waitFor(() => expect(...))` — the standard pattern, `() => void` accepted (`(callback: () => void) => Promise<void>`). ✓

Now — **`toHaveTextContent('1d 1h 03m 03s')`** — jest-dom. ✓

**`screen.getByRole('timer')`** — the role query works with any ARIA role ✓.

One more: **the `<span role="timer">` with `className`** ✓.

Also, **the `Badge` inside the bar renders a `data-tone` span** — fine.

Now let me finalize **the AppLayout** — keep the original comment. Add the import and the element.

Let me write the final output. Format: for each file, `### path` + a fenced block. Nothing else.

Also — the instructions say "start with the first heading." So my response starts with `### src/features/sessions/queries.ts` etc. No prose.

Let me write the complete `queries.ts` once more, ensuring the `useActiveSession` comment mentions the source of truth:

Done above. Final check on the `mirrorActiveSession` parameter type: `qc: ReturnType<typeof useQueryClient>` — matches the `patchLists` style. ✓

And the bar's file — the `formatElapsed` export.

Let me reconsider once more **the `useTickingNow(Boolean(active && !active.closedAt))`** — when `active` is `Session | null | undefined`: `Boolean(active && !active.closedAt)` → false for undefined/null. ✓

Edge case: `active.closedAt` is a non-null string for a closed session → false → static elapsed via closedAt. But as established, a closed active shouldn't occur. Handled gracefully either way. ✓

Also — **the `end` computation**: `new Date(active.closedAt).getTime()` — closedAt is ISO ✓.

Now, **the output.**

Actually, wait — let me reconsider once more whether the activation should also be triggered from the **list screen** (e.g., an optimistic set on click). No — the server is the source of truth. The mirror on detail load is the consistent approach. The small delay (the bar updates when the detail loads) is acceptable and matches the "API as source of truth" requirement.

And the **`GET /sessions/active` as the "source of truth"** — the bar's query. The mirrors are cache writes of server facts (the detail GET's response is a server fact: the server promoted it). Fine.

One more consideration — **the `staleTime` 30s on the active query**: if the bar is mounted and the active changes externally (another tab), no refetch. The app chose `refetchOnWindowFocus: false` globally. Consistent.

Final: writing the files.

Also, the instructions say to mark truly missing symbols with an ASSUMPTION comment — nothing is missing. The mock already implements the server-side activation. Good.

Let me double-check the **complete content of `SessionDetailScreen.tsx`** once more — I'll reproduce it in full with the two additions. ✓

And **AppLayout.tsx** in full. ✓

Let me verify the **imports in the test file** — `sessions` is used (afterEach). `state` is used. ✓ `vi` is used. ✓ `afterEach` is used. ✓

I'm ready.
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
  return useQuery({ queryKey: sessionKeys.detail(id), queryFn: () => api.getSession(id) });
}

/**
 * The server is the source of truth for the active session
 * (GET /sessions/active). This cache is the only copy the client keeps —
 * nothing is persisted client-side — which is why a full reload simply
 * refetches it and the bar comes back.
 */
export function useActiveSession() {
  return useQuery({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
}

/**
 * The server promotes a fetched session to the active one unless it is
 * already closed (see GET /sessions/:id). Mirror that server fact in the
 * active cache so the bar follows the screen instead of refetching.
 */
export function mirrorActiveSession(
  qc: ReturnType<typeof useQueryClient>,
  session: Session,
): void {
  if (session.status !== 'closed') {
    qc.setQueryData(sessionKeys.active(), session);
  }
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
      // The server drops the active pointer only when it pointed at the
      // session that was just closed. Mirror that: empty the bar only then.
      const active = qc.getQueryData<Session | null>(sessionKeys.active());
      if (active?.id === updated.id) {
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
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { mirrorActiveSession, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const qc = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Opening a session promotes it to the active one on the server (unless it
  // is closed). Mirror that fact here so the bar follows without a refetch.
  useEffect(() => {
    if (session) mirrorActiveSession(qc, session);
  }, [qc, session]);

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

### src/app/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

/** "1d 4h 05m 09s" — always shows seconds, so the bar visibly ticks. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3_600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`, `${pad(minutes)}m`, `${pad(seconds)}s`);
  return parts.join(' ');
}

/** The current time, refreshed every second while `enabled`. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. It lives in the authenticated shell, so
 * it shows on every screen. The session itself always comes from the server
 * (GET /sessions/active); the bar keeps no persistence of its own, which is
 * what makes it survive a full page reload.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const close = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(active && !active.closedAt));

  if (!active) return null;

  const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div role="region" aria-label="Active session" className="active-session-bar">
      <span className="active-session-bar__name">{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span role="timer" className="active-session-bar__elapsed">
        {elapsed}
      </span>
      <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
      <Button
        variant="danger"
        disabled={active.status === 'closed' || close.isPending}
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
          close.mutate(active.id);
        }}
      />
    </div>
  );
}
```

### src/app/AppLayout.tsx
```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from './ActiveSessionBar';

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

### src/app/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../mocks/db';
import { renderApp } from '../test/render';

const getBar = () => screen.getByRole('region', { name: 'Active session' });
const queryBar = () => screen.queryByRole('region', { name: 'Active session' });

describe('ActiveSessionBar', () => {
  afterEach(() => {
    vi.useRealTimers();
    state.user = null;
    state.activeSessionId = null;
    sessions[0] = { ...sessions[0], status: 'open', closedAt: null };
  });

  it('shows the server active session on a fresh load, so it survives a reload', async () => {
    // A fresh renderApp is a new router and query client — the same starting
    // point as a full page reload. The bar must come back from
    // GET /sessions/active, not from any client-side persistence.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());

    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(getBar()).getByText('open')).toBeInTheDocument();
    expect(within(getBar()).getByRole('timer')).toBeInTheDocument();
  });

  it('makes a session active when opened, keeps it across screens, and replaces it', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 2')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());

    // The bar follows the operator to other screens.
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument();

    // Opening another session replaces the active one.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
  });

  it('does not make a closed session active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 3')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 3'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 3' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('asks about unsaved notes before the active session is replaced', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Notes'), 'x');

    // Leaving with a dirty draft is confirmed by the detail screen's existing
    // blocker; the replacement only happens after that confirmation.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());
  });

  it('confirms before closing from the bar and empties on success', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());

    // Asking, then cancelling, changes nothing.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(queryBar()).toBeInTheDocument();

    // Confirming goes through the existing close endpoint and empties the bar.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Close this session?' })).getByRole('button', {
        name: 'Close session',
      }),
    );
    await waitFor(() => expect(queryBar()).not.toBeInTheDocument());

    // The close is real: the list now reports the session closed.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /Inspection 1/ })).toBeInTheDocument());
    expect(within(screen.getByRole('row', { name: /Inspection 1/ })).getByText('closed')).toBeInTheDocument();
  });

  it('deep links straight to a detail and marks it active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions/s-004');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
    await waitFor(() => expect(within(getBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('clears the bar on logout', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions');

    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('ticks the elapsed time from the server startedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 3, 2, 9, 3, 3))); // 1d 1h 3m 3s after s-001 started
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
    expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 03s');

    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 04s'));
  });

  it('stays hidden when the server has no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });
});
```


---
