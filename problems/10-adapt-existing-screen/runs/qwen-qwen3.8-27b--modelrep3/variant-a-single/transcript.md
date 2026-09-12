# Transcript — 10-adapt-existing-screen / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me carefully analyze the task.

The task is Variant A: "Persistent active session bar in back-office." The scaffold is a React + TS + react-query + router app. What I need to do:

1. A persistent active session bar, shown on every authenticated screen:
   - Opening a session from the list makes it the active session; the bar shows the main fields (name, status, elapsed time ticking) on all screens.
   - The bar provides "resume" (navigate to detail) and "close session" (call the existing close endpoint, with confirmation; on success the bar becomes empty).
   - Only one active session at a time; opening another replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag).
   - The active session survives a full page refresh (the API exposes `GET /sessions/active`; use it as the source of truth — no client-only persistence of server state).

2. Behaviors that must not regress:
   - List filtering/pagination
   - Detail editing + dirty flag warning on route change
   - Logout clears all state
   - Deep-linking directly to the detail URL

Let me look at the existing code and think about what changes are needed.

Key observations from the existing code:

1. `src/api/client.ts` already has `getActiveSession: () => request<Session | null>('/sessions/active')`. Good.

2. `src/features/sessions/queries.ts` already has an `active: () => ['sessions', 'active'] as const` key in `sessionKeys`. Good.

3. `src/mocks/handlers.ts`:
   - `GET /api/sessions/active` returns the session matching `state.activeSessionId`, or null.
   - `GET /api/sessions/:id` sets `state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;` — so opening a session detail activates it (server side) unless it's closed.
   - `POST /api/sessions/:id/close` clears `state.activeSessionId` if it was the active one.
   - `POST /api/auth/logout` clears `state.activeSessionId`.

So the server (mock) already handles the "opening a session makes it active" behavior via the GET detail endpoint. Interesting. So the client-side flow: when a user opens a session from the list, the detail screen fetches it, the server sets it as active, and the active bar should reflect that. The bar uses `GET /sessions/active` as the source of truth.

Wait, but the mock's `GET /sessions/:id` sets the active session. That's a side effect of the mock. The real API presumably does the same ("opening a session makes it active" is server behavior). So the client should refetch the active session after opening a detail.

Hmm, how should the client know? The bar queries `GET /sessions/active`. When a user navigates to a session detail, the server marks it active. The bar's query needs to be invalidated/refetched to show the new session. Options:

- The `useSession` query's onSuccess invalidates the active key. But `useSession` is a plain query; I could add a subscriber, or invalidate in a component. Better: in `SessionDetailScreen` (or the `useSession` hook), on success, invalidate the active query. Actually, cleaner: in `SessionDetailScreen`, on session load success, invalidate the `['sessions', 'active']` cache so the bar refetches. Hmm, but "invalidation" — the app's pattern says "this is a pattern the app uses everywhere; copy it rather than invalidate." But that's about writing rows into the list cache. For the active session, we don't have the row from the active endpoint itself... actually we do: when we open session `:id`, if it's not closed, the server sets it as active, so the active session becomes that session. But the client doesn't know for sure whether the server set it as active (e.g., if the session is closed, the server doesn't set it active). The mock does: `state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;`.

The safest, and the task states: "use it as the source of truth — no client-only persistence of server state." So the client should refetch `GET /sessions/active` after operations that might change it (opening a session, closing a session, and on app load / login).

Design:

1. Add `useActiveSession` query in `src/features/sessions/queries.ts`:
```ts
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}
```

Wait — `queryFn: () => api.getActiveSession()` returns `Session | null`. A react-query queryFn returning null... that's fine, the data will be null. But note: `isLoading` when data is null... in react-query v5, `isLoading` is true when status is 'pending' and no data. Once fetched, status is 'success' and data is null. Good.

2. Add `ActiveSessionBar` component, rendered in `AppLayout` above the `<Outlet />`. It:
   - Uses `useActiveSession()`.
   - Shows name, status, elapsed time ticking.
   - "Resume" button → navigate to `/sessions/{id}`.
   - "Close session" button → confirmation dialog → `closeSession` mutation → on success the bar becomes empty (server clears active; refetch active).

3. Elapsed time ticking: compute from `startedAt`, tick every second. For a paused session, hmm — "elapsed time ticking" — the main fields are name, status, elapsed time. Simplest: elapsed = now - startedAt, ticking every second, probably only while the status is 'open'? The spec says "elapsed time ticking" without conditions. I'll tick while the session is open; for paused, maybe freeze. Hmm. Let me think about what's defensible. The Session type has `startedAt` and `closedAt` but no `pausedAt`. So we can't accurately compute the elapsed time of a paused session. Simplest and most defensible: display elapsed since `startedAt`, tick every second, and if `closedAt` exists, show total (closed - started). Status will be closed anyway, so for closed sessions, display the fixed total. For paused... we just keep ticking from startedAt (approximate), or freeze at startedAt? There's no data to compute pause duration.

Let me keep it simple: elapsed = (closedAt ?? now) - startedAt, ticking every second while there's no closedAt. That handles open and paused uniformly (paused just keeps ticking from start; it's approximate, but the data model doesn't track pause time). I could add `// ASSUMPTION: paused sessions have no pause timestamp in the data model, so elapsed is computed from startedAt`. Actually the instructions say to mark assumptions where symbols are truly absent. This is a semantic choice; a short comment is fine.

Actually, reconsidering: should the bar only show for the active session? The active session is by definition non-closed (server sets activeSessionId to null on close). So the bar shows a session that is open or paused. Elapsed ticks every second.

4. "Only one active session at a time; opening another replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

This is the trickiest part. Scenario: user is on the detail screen of session A with unsaved notes (dirty). Then... "opening another replaces it" — opening another session. How does the user open another while on A's detail screen? By navigating to another session's detail (e.g., via the list? no — from the list they'd navigate through A's detail to the list first...). Actually: the user is on A's detail with dirty notes and clicks "Resume" in the bar? No, the bar's resume goes to the active session which is A itself.

Hmm, how does "opening another replaces it" happen? Paths:
- From the list: user is on the list, opens session B. Active is... the list's screen doesn't have a dirty flag; only the detail screen tracks dirty. If the user was previously on A's detail with dirty notes, they'd already have been asked to confirm via the dirty blocker when navigating to the list. So by the time they're on the list, A is not dirty (they either saved or discarded... wait, the blocker just asks "leave with unsaved notes?" — confirming "Leave" discards the unsaved changes).

Hmm wait, but there's a subtle point: what if the user is on A's detail with dirty notes, and somehow opens B's detail directly (e.g., via URL, or the bar shows A and user... no). Actually, if the user is on A's detail and clicks "Sessions" in the nav, the blocker fires. OK.

But consider: user is on A's detail, dirty, and clicks "Resume" in the bar — that navigates to A's detail (the active session is A). No replacement.

What about deep-linking directly to B's detail while A is active? The dirty flag only exists in A's detail screen's memory. If A's detail screen isn't mounted, there's no dirty state to confirm. The confirmation "if the current one has unsaved notes" can only be triggered when the detail screen is mounted and dirty.

So where does "opening another replaces with confirmation" actually happen? I think the intended flow is: the user is on session A's detail screen (active = A, dirty notes), and from there... hmm, they can't open another from the detail screen. Unless...

Wait — maybe the flow is: user is on the list. The bar shows active session A. User clicks session B in the list. B's detail loads, server sets active = B. Replacement happened. Where's the confirmation? "with confirmation if the current one has unsaved notes" — the current one (A) only has unsaved notes if the user is on A's detail screen. But the user is on the list...

Hmm, unless the dirty state is shared: the detail screen's dirty flag is local. Let me re-read the task:

"3. Only one active session at a time; opening another replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

I think the intended interaction is this: the user is on session A's detail screen with unsaved notes. The bar shows A (active). The user... hmm, from A's detail screen, how do they open another? Via the list: nav → Sessions (blocker fires, they choose Leave) → click B. At that point A's dirty is gone (left).

Alternatively — the intended UX might be: the user is on A's detail, dirty, and the bar's "close session" or something... no.

Another interpretation: the replacement-with-confirmation happens when navigating from A's detail (dirty) to B's detail (or the list) — that's exactly the existing dirty blocker behavior! The existing blocker already prompts on route change when dirty. So requirement 3 is largely satisfied by the existing dirty blocker: you can't silently open another session while the current one is dirty; the blocker asks.

Hmm, but wait. Let me think about the flow where the bar causes a navigation: user is on A's detail, dirty. Bar shows A. User clicks "Close session" in the bar → confirmation → closes A → bar empties. Fine.

What if user is on the list, and the bar shows A? Clicks B in the list → B's detail. A has no unsaved notes (not mounted, or already left). Server replaces active with B. No confirmation needed. Fine.

What if user is on A's detail (not dirty), bar shows A, clicks "Sessions" in nav → list → clicks B → replacement. No confirmation needed (not dirty). Fine.

The only case where confirmation is needed: user is on A's detail, dirty, and initiates opening another session. The only way from A's detail to open another is:
1. Nav to Sessions list → blocker fires (existing behavior) → user confirms "Leave" → now on list → open B.
2. Direct URL / deep link to B → in-app? The user can't type a URL in-app without leaving... well, via the browser bar, the app is an SPA; typing a URL causes a full page load, which loses the dirty state anyway.
3. Hmm — what about the bar itself? If the bar shows A and the user clicks Resume → goes to A's detail. If the user is already on A's detail, no-op.

Wait, actually there's one more scenario I missed: user is on B's detail (B is active — no wait, only one active; opening B made B active). Then A isn't active.

Hmm, so actually, with the server-side "GET detail sets active" behavior, the active session is always the one whose detail you last opened (if non-closed). So "opening another replaces it" happens naturally via the server.

The confirmation part: "with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag." The detail screen's dirty blocker fires on any route change when dirty. So if you're on A's detail (dirty) and navigate anywhere (list, another detail, orders), the blocker asks. This existing behavior already covers the confirmation. But does the new bar change anything? The bar adds a "Resume" button which navigates to the active session's detail. If I'm on a different screen (say B's detail where B is active... but then the active is B, and the resume goes to B).

Hmm, wait, let me reconsider: is it possible that I'm on A's detail (dirty) and the active session is B? The server sets active on GET detail. If I'm on A's detail, A was fetched, so A is active (if not closed). So while on A's detail, the active session is A. Unless A is closed... in which case GET A doesn't set active, and active remains B. Edge case: A is closed, I'm on A's detail (notes on a closed session? the detail screen allows editing notes even for closed? The close button is disabled for closed, but notes are editable? `updateNotes` is only disabled when `!dirty`. Hmm, notes on a closed session can still be saved. And dirty can be true on a closed session's detail.)

I think I'm over-analyzing the mock. Let me focus on what a coherent, testable implementation looks like:

**Core deliverables:**

1. `useActiveSession()` hook in `src/features/sessions/queries.ts` — query for `GET /sessions/active`.

2. `ActiveSessionBar` component (new file, e.g., `src/features/sessions/ActiveSessionBar.tsx`):
   - Reads `useActiveSession()`.
   - Renders nothing (or renders nothing at all) if there's no active session.
   - Shows name, status badge, ticking elapsed time.
   - "Resume" button → `navigate(`/sessions/${id}`)`.
   - "Close session" button → ConfirmDialog → on confirm, close mutation.
   - On close success: server has cleared active; invalidate/refetch the active query → bar empties. Also patch lists with the updated (closed) session — `useCloseSession` already does `patchLists`. So reuse `useCloseSession`.

3. Wiring into `AppLayout`: render `<ActiveSessionBar />` above `<Outlet />` (inside `<main>` or between header and main). "Shown on every authenticated screen" — AppLayout is the authenticated shell. Put it in AppLayout, above `<main>` (or at the top of main). I'll put it between the header and main.

4. Keeping the bar fresh:
   - When a session detail is opened, the server marks it active → the bar must refetch. Where to hook this? In `SessionDetailScreen`, on `useSession` success, invalidate the active query. Or in the `useSession` hook? The hook is also used for the detail; adding a side effect there (invalidate active on every success) is reasonable: opening a detail (including refetch) updates active server-side, so refetching active is correct. But refetching active on every detail refetch (e.g., 30s stale) is a bit wasteful but harmless. Better to only do it on transition... simpler: in `SessionDetailScreen`, use an effect on `session` data: when loaded, invalidate `sessionKeys.active()`. Hmm.

   Actually wait — there's a subtlety with the "replacement with confirmation if dirty" requirement. If the user is on A's detail (dirty) and the bar shows A, and the user clicks "Resume" in the bar... it goes to `/sessions/a` — they're already there. No issue.

   But here's a real conflict: user is on A's detail, dirty (unsaved notes). The bar... shows A. OK, no conflict.

   The replacement flow with confirmation: I think the intended design is — the dirty blocker on the detail screen already guards route changes; that IS the confirmation when opening another session while the current is dirty. So I need to make sure I don't break it and that the bar's Resume works when dirty...

   Hmm wait, actually there IS a real scenario: user is on A's detail, dirty. Bar shows A (name/status/elapsed). User clicks "Close session" in the bar → confirmation dialog → confirm → A is closed server-side, active cleared → bar empties. But the user is on A's detail with dirty notes — the detail screen still shows A (now closed via detail cache? `useCloseSession.onSuccess` sets the detail cache to the updated closed session and patches lists). The detail screen re-renders with the closed status; the user's unsaved notes are... the detail screen's local `notes` state remains; `dirty` is computed by comparing to `session.notes` — the server-side notes are unchanged (close doesn't change notes), so dirty remains true. OK, fine.

   Now the main scenario for "opening another replaces it (with confirmation if the current one has unsaved notes)": I think this describes navigation from a dirty detail to another session's detail. The existing `useBlocker(dirty)` handles this: it fires on any route change. So if I'm on dirty A and click "Sessions" in the nav → blocker dialog "leave with unsaved notes?" → proceed → list → click B → B becomes active (replacement). The confirmation happened (albeit with generic wording).

   But wait — is there a case where the bar itself triggers a navigation that should confirm? "The bar provides 'Resume' (navigate to detail)." If I'm on a dirty screen and I'm on... which screen can be dirty? Only the session detail. If I'm on a dirty session detail, the active session IS that session (server set it on GET), so Resume navigates to the same route — the blocker doesn't fire (no route change).

   Hmm, OK, another thought — what about a dirty A detail, active session is B (possible? only if A is closed... or if active was set to B earlier and A's GET didn't set active because A is closed). Then the bar shows B. Clicking Resume navigates to B's detail → blocker fires (dirty) → confirmation. So the existing blocker handles it automatically.

   So requirement 3 is essentially: (a) server replaces active on open (already in the mock), (b) client bar reflects it, (c) dirty blocker guards (existing). I need to make sure the bar's state updates on replacement and that nothing breaks.

   Actually, hmm, wait. Let me reconsider. Let me re-read: "opening another replaces it (with confirmation if the current one has unsaved notes — the detail screen already tracks a dirty flag)."

   I now think this is precisely: when a user on the list (or elsewhere) opens session B, B replaces A as active — and if at that moment the current session (A) has unsaved notes (i.e., the user is on A's detail and dirty), the app should confirm before letting them leave (existing blocker). The parenthetical "(the detail screen already tracks a dirty flag)" tells me the dirty flag already exists and I should rely on it — not build new persistence of dirty state.

   So: don't persist the dirty flag client-side; rely on the blocker. Good — this is consistent with "no client-only persistence of server state."

5. Refresh survival: on load (deep link, or full refresh on any authenticated screen), the bar queries `GET /sessions/active` on mount (AppLayout renders on every authenticated screen, so the query starts when the layout mounts). The mock preserves `state.activeSessionId` across requests (in-memory in the mock; the "server" state persists across the client's reloads — in dev mode, the MSW worker is in the same page... hmm, actually a full refresh in dev resets the MSW in-memory db! Wait: `src/mocks/db.ts` state resets on page reload. So in dev, a full refresh loses `activeSessionId`. But that's a mock limitation — the real API persists server-side. In tests, we simulate a refresh by rendering a new app with a new memory router; the mock db `state` persists across renders in the test process (module-level), so we can test: set state.activeSessionId, render a fresh app, expect the bar to show.

   Also login: after login, the bar should show active if one exists. `state.activeSessionId` persists across logout in the mock? No — logout clears it: `http.post('/api/auth/logout', () => { state.user = null; state.activeSessionId = null; ...})`. "Logout clears all state" — yes, the mock clears active on logout, and the client's `queryClient.clear()` clears the cache. Good.

6. Keeping the bar fresh on detail operations:
   - Opening a detail (server sets active) → bar should update to the opened session. Implementation: in `SessionDetailScreen`, after `session` loads, invalidate the active query. But careful: invalidation causes a refetch; fine.

   Hmm, but actually, there's a cleaner approach that fits the app's "write returned row to the cache" pattern: when the detail query succeeds, we know the session; if it's not closed, the server has set it as active (mock behavior). But per the task, the source of truth is `GET /sessions/active` — "use it as the source of truth — no client-only persistence of server state." So the client shouldn't write "active = X" from client-side inference; it should refetch. Invalidation + refetch of the active query is the correct approach.

   Where exactly? Options:
   a. `useSession` hook: `onSuccess` isn't available on `useQuery`... actually v5's `useQuery` doesn't have onSuccess. Can subscribe via queryClient. Too magical.
   b. `SessionDetailScreen`: `useEffect` on `[session]` → when session is defined, `queryClient.invalidateQueries({ queryKey: sessionKeys.active() })`. But note: this effect fires whenever the `session` object changes (e.g., after saving notes, the cache update makes session new → invalidate active again → refetch → harmless).
   c. The bar itself: poll? No.

   Also, after close (from bar or from detail): the active session is cleared server-side; the `useCloseSession.onSuccess` should also invalidate the active query. I'll add it to `useCloseSession.onSuccess`: `qc.invalidateQueries({ queryKey: sessionKeys.active() })`. Hmm, or `setQueryData(sessionKeys.active(), null)`? That would be client-side writing a server fact — but we know the server cleared it (the close response implies it). The task says to use GET as the source of truth, no client-only persistence of server state. Setting null in the cache is not "persistence" per se, it's cache management; but the safest interpretation: refetch. Invalidation is fine and simple.

   Actually, let me think about the "bar empties on success" requirement: "close session (call the existing close endpoint, with confirmation; on success the bar empties)." If I invalidate on success, the bar will show stale for a moment and then empty. Alternatively, optimistically set the active cache to null on success... The requirement is "on success the bar empties" — an invalidation refetch will satisfy this quickly (mock is synchronous). I could also do both: on success, `qc.setQueryData(sessionKeys.active(), null)` to empty immediately, and also invalidate to sync? Setting to null is safe here because the server guarantees the cleared (mock does; real API presumably). Hmm, but if active was a different session? Can't close a session that isn't active? Actually, you can: the bar only shows close for the active session. The detail screen also has "Close session" for the viewed session, which may not be active (edge: viewing a closed session? close button disabled when closed; viewing an open non-active session — possible? if the server sets active on GET, then any open session viewed becomes active. So the only non-active session viewable is a closed one, where close is disabled. So in practice, the close is always for the active session.)

   I'll go with invalidation in `useCloseSession.onSuccess` (refetch from the server — the source of truth). And for immediate UX, I can also `setQueryData(active, null)`. Hmm, let me not overthink; an invalidation will refetch immediately, and the bar will empty after the mock's instant response. Tests use `waitFor`, fine.

   Wait, actually there's a subtle point about `invalidateQueries` + `retry: false` — fine.

   Another subtlety: when the active session is opened by the detail (server sets active), the bar's invalidation triggers a refetch. But what if the active query isn't mounted? AppLayout is always mounted on authenticated screens, so it's always mounted. Good.

   Also: the `staleTime: 30_000` default — after opening a detail, the invalidation makes the active query stale → refetch regardless of staleTime (invalidation triggers refetch of active query). Good.

   But hmm — there's a wrinkle: `useActiveSession` in the bar; after close, invalidation refetches; fine.

   And on refresh: on mount, the query is fresh, fetches. Good.

7. Elapsed time ticking: need a `useNow`-style hook with a `setInterval` in the bar, or a small `useElapsed` hook. I'll write it inside the bar file. Format like `1h 04m 32s` or `04:32`. Let me pick a readable format: `Xh Ym Zs`. Simpler: `H:MM:SS`? For ops, "elapsed" like `1h 02m 05s`. I'll write a small formatter `formatElapsed(ms)` → `${h}h ${m}m ${s}s`, omitting zero leading units? Keep it simple: always `Xh Ym Zs` with hours zero as `0h`? Hmm. Let's do: if h > 0 → `Xh Ym Zs`; if m > 0 → `Xm Ys`; else → `Xs`. Clean.

   Ticking: `useState(Date.now())` + `useEffect` with a 1000ms interval. To keep it from ticking when there's no active session or the session is closed, the effect depends on the presence of the session. In the mock the active session is never closed (server clears active on close), but guard anyway: tick only if `session && !session.closedAt`.

   Test considerations: ticking tests need fake timers. `vi.useFakeTimers()` in vitest with react-query + MSW can be tricky (react-query uses timers for scheduling). Hmm. Alternatively, test that the elapsed text updates after advancing timers, or just assert the initial value and that it's present. A robust test: with fake timers, advance and check the text changes. React Query with fake timers: useQuery's initial fetch is a promise, not a timer, so it works with `vi.useFakeTimers()` + `await waitFor` (waitFor also uses timers... under fake timers, does waitFor use `vi.advanceTimersByTime`? Actually @testing-library/dom's waitFor uses setTimeout/interval; with fake timers you have to advance manually — tricky).

   Alternative: test the elapsed formatter as a pure function (export `formatElapsed`), and test that the bar shows the name/status/buttons without asserting the exact tick, or assert the elapsed matches a regex (e.g., `/0h 0m \d+s/`). Since the mock's startedAt is fixed (2024), the elapsed is huge (from 2024 to now) — e.g., `7000h ...`. Fine, regex `/^\d+h \d+m \d+s$/`.

   Hmm, but "never assert only that a call happened" and "no tests without assertions" — I'll assert the actual displayed text.

   Let me include a tick test with fake timers, but be careful. Pattern:
   ```tsx
   it('ticking', async () => {
     vi.useFakeTimers();
     try {
       renderApp('/sessions');
       // wait for initial data with fake timers:
       await vi.waitFor(...)?
     } finally {
       vi.useRealTimers();
     }
   });
   ```
   vitest has `vi.waitFor` that handles fake timers well (advances time while waiting for promises). Yes, `vi.waitFor` works with fake timers. MSW responses are promise-based (interceptors resolve asynchronously) — with fake timers, microtasks still run, but `setTimeout`-based things don't advance unless we do. MSW's node server uses node's http; responses come through promises/events — `vi.waitFor` advances timers in a loop and awaits, so it should work. But is it reliable? `vi.waitFor` calls `advanceTimersByTime` repeatedly and flushes microtasks. I think it works, but there's risk with real network event loop (MSW node actually uses `@mswjs/interceptors`'s intercept — it patches fetch, so it's all promise-based, no real sockets). Should be fine.

   But to reduce risk, maybe I'll test the tick by asserting the initial elapsed text, then advancing timers, and using `vi.waitFor` to check the text changed. Let me write:

   ```tsx
   it('ticking elapsed time', async () => {
     state.user = {...};
     state.activeSessionId = 's-001';
     vi.useFakeTimers();
     try {
       renderApp('/orders');
       const el = await vi.waitFor(() => screen.getByTestId('active-session-elapsed'));
       const first = el.textContent;
       vi.advanceTimersByTime(5000);
       await vi.waitFor(() => {
         expect(el.textContent).not.toEqual(first);
       });
     } finally {
       vi.useRealTimers();
     }
   });
   ```
   Need a stable reference: use `getByTestId` and keep the element reference — but React re-renders replace the DOM node? The span's textContent updates but the element identity: React updates the text node in place, the span element itself is reused (same key/position), so `el` remains valid. OK.

   Hmm, wait, actually the elapsed updates every second; 5s advance guarantees a change. But the initial render's `Date.now()` under fake timers = 1970-01-01! With fake timers, `Date.now()` is mocked to the fake "now" (which starts at the real time by default? `vi.useFakeTimers()` sets the clock to the current time by default — yes, it starts from the actual current date and time). Actually, `vi.useFakeTimers()` mocks the Date to the current real time at the point of the call. So startedAt 2024 → elapsed is computed from real now. Fine.

   But react-query's `staleTime` and scheduling also use timers; `vi.waitFor` handles it.

   Alternatively, skip fake timers and just assert that the elapsed format matches the regex. The ticking behavior... I want to verify it updates. Let me do the fake-timer test carefully. Actually, let me reconsider: the risk that `vi.waitFor` + MSW doesn't resolve... `vi.waitFor`'s implementation: it uses `setTimeout` with fake timers, and each iteration advances the clock by `interval` (default 50ms) and checks the callback. The MSW interceptor resolves the fetch promise via microtasks, which are flushed when the promise awaits resume. `vi.waitFor` awaits real async (its own loop uses fake `setTimeout`, but `await` yields to the microtask queue, so pending promises resolve). I'm fairly confident it works. Many projects test RQ with fake timers via `vi.waitFor`.

   Actually, safer approach for the tick: make the elapsed tick testable without fake timers... hmm, or inject a `now` provider? No, keep it simple, standard: a real setInterval; test with fake timers via `vi.waitFor`.

   Hmm, one more consideration: `setInterval(1000)` under fake timers — after advancing 5000ms, the callback fires 5 times, state updates, re-render. The `vi.waitFor` loop advances timers between checks, so it'll catch it.

8. "Resume" navigation: the bar is inside `AppLayout`, which is inside the RouterProvider — `useNavigate` is available. Good.

9. Confirm on close: reuse `ConfirmDialog`. The bar: "Close session" button opens a dialog; confirm → `closeSession.mutate(active.id)`.

10. Bar location: "shown on every authenticated screen." AppLayout wraps all authenticated routes. Add `<ActiveSessionBar />` inside `<main>` before `<Outlet />`? Or between header and main. Visually, a bar under the header. I'll put it between `<header>` and `<main>`.

    Also: the login screen must not show the bar — LoginScreen is outside AppLayout. Good.

11. Deep-linking to a detail URL: on refresh at `/sessions/:id`, RequireAuth waits for `me()`, then AppLayout + detail render; the bar fetches active. The server sets active on GET detail — so if the deep-linked session is non-closed, it becomes active. The bar's initial fetch of `/sessions/active` may race with the detail's fetch. Order: both fire on mount; the active fetch may return before the detail fetch completes → bar temporarily shows old/null, then after the detail sets active server-side, the detail's success invalidates the active query → refetch → correct. My invalidation in SessionDetailScreen handles the ordering.

    Wait, but the invalidation fires when `session` data changes — the effect on `[session]`. On initial load: session undefined → data → effect fires → invalidate → refetch active → shows the deep-linked session.

    Hmm, one issue: `invalidateQueries` refetches the active query only if it's currently observed (mounted) — it is (the bar). OK.

    Another subtlety: `staleTime: 30_000`. Invalidation marks stale → active observers refetch. Yes.

12. "Logout clears all state": `auth-context.logout` does `queryClient.clear()`, which drops the active cache; the mock clears `state.activeSessionId`. After logout, RequireAuth redirects to /login; the bar unmounts (AppLayout unmounts). Good. No changes needed there.

13. Now — "opening a session from the list makes it the active session." The list uses a `Link` to the detail. The detail's GET sets active server-side (mock). So the client only needs to refetch active after the detail loads. Covered by the invalidation in the detail screen.

    But hmm — should the list itself mark it active on click? The server does it on GET. Fine, no client action needed.

    Edge: opening a closed session from the list — the server does not set it active (mock: `s.status === 'closed' ? state.activeSessionId : s.id`). So the bar stays with the previous active (or empty). The detail's invalidation refetches active → still the previous one. Consistent with the source of truth.

14. Now, "with confirmation if the current one has unsaved notes" — existing blocker. But let me re-check the blocker's behavior when the bar triggers navigation. Scenario: user is on A's detail, dirty. Bar shows A. User clicks "Close session" in the bar → closes A. No navigation. Fine.

    Scenario: user on A's detail, dirty; the active session is... A. Fine.

    But: user on A's detail, dirty. They click the "Sessions" nav link → blocker fires → Leave → list. Now click B → B's detail loads, B active. The confirmation happened via the blocker. That IS the required confirmation. I believe the requirement is satisfied by the existing behavior; I just need to make sure my changes don't break it, and I should add a test that verifies: on a dirty detail, navigation (e.g., opening another session) prompts the confirm and only replaces active after confirmation.

    Test for requirement 3:
    - Set user; render `/sessions/s-001`; wait for load; type in notes (dirty); click nav "Sessions" → expect dialog "leave with unsaved notes?"; confirm "Leave" → now on list; click "Inspection 2" (s-002) → wait for detail; server now has active = s-002; bar shows "Inspection 2".
    - Also negative: cancel the dialog → still on s-001.

    Wait — but there's a subtlety with `useBlocker` under a memory router + React 18 in tests: the existing detail screen uses `useBlocker(dirty)`, and there must be existing tests? The given test file only tests the list. `useBlocker` works with createMemoryRouter (data router). Should be fine.

    Hmm, but one pitfall: `useBlocker(dirty)` with `dirty` computed as `session !== undefined && notes !== session.notes`. When I type into the textarea, dirty=true. Click "Sessions" link → blocked → dialog. OK.

    After "Leave" (proceed), the detail unmounts, the list mounts. Click "Inspection 2" → detail s-002. The mock's GET sets `state.activeSessionId = 's-002'`. The bar (mounted in AppLayout, persists across route changes!) — its `useActiveSession` query: when did it last fetch? On AppLayout mount (when I rendered `/sessions/s-001`). At that time, the initial render fetches `/sessions/active` — if `state.activeSessionId` was null initially, data=null. Then the detail GET set active to s-001; the detail's effect invalidated active → refetch → bar shows s-001. Then navigate to list (bar persists — same AppLayout instance, no remount). Then open s-002 → its effect invalidates → refetch → bar shows s-002.

    So the bar persists across route changes (AppLayout is the parent layout route).

15. What about the "Resume" button — when on the active session's detail, clicking Resume is a no-op navigation (same route). Fine.

16. Now let me also think: should the bar be hidden when there's no active session? Yes — "the bar becomes empty" on close success. "Bar becomes empty" — either the entire bar disappears, or it's shown empty. I'll render nothing when there's no active session (the bar disappears). "Bar becomes empty" ≈ the bar no longer shows a session. Simplest: no bar if no data. I think that's the intended UX.

    Hmm, "on success the bar becomes empty" — maybe the bar stays but is empty? That's weird UX. Disappearing bar = empty. I'll go with conditional rendering and describe it in the component doc.

17. File layout:
    - `src/features/sessions/queries.ts` — add `useActiveSession`, update `useCloseSession` (invalidate active), keep `useUpdateSessionNotes`.
    - `src/features/sessions/ActiveSessionBar.tsx` — new component (name? `ActiveSessionBar`).
    - `src/features/sessions/SessionDetailScreen.tsx` — add invalidation on load (useEffect + queryClient).
    - `src/app/AppLayout.tsx` — render the bar.
    - Tests: `src/features/sessions/ActiveSessionBar.test.tsx` — new test file. Also add tests for list behavior? "Deliver the edits as a consistent diff + tests in the app's style."

    Where do the tests live? Existing: `src/features/sessions/SessionsListScreen.test.tsx` (colocated). So I'll add `src/features/sessions/ActiveSessionBar.test.tsx`.

    Tests to write (in the app's style — real router + MSW, MSW, no hook mocks):
    a. Bar shows active session's fields on a non-detail screen (e.g., `/orders`): name, status, elapsed; after full refresh (new render), still shows (survival) — "survives refresh" test: set `state.activeSessionId = 's-001'`, render `/orders`, bar shows Inspection 1. That simulates a refresh with server-side active.
    b. Opening a session from the list makes it active: render `/sessions`, click "Inspection 1", wait for detail; bar (still in the layout) shows "Inspection 1". Actually the bar shows it on the list too after returning. I'll assert on the detail screen: bar shows the session name + status.
       Also, opening a second one replaces: from the list click Inspection 1 → bar shows 1 → back to list (click "Sessions" nav) → click Inspection 2 → bar shows 2, not 1.
    c. Resume navigates to detail: set active = s-003, render `/orders`; click "Resume" → detail of s-003 shows (h1 "Inspection 3").
    d. Close from the bar: set active, render (any screen), click "Close session" → confirm dialog → confirm → bar empties (queryByRole bar absent / name absent); the session becomes closed in the list too? The mock updates. I can assert the bar is gone.
    e. Ticking: fake timers test (as above).
    f. Dirty guard: render `/sessions/s-001`, type in notes, click "Sessions" nav → dialog appears; assert still on s-001 (h1 Inspection 1). Confirm "Leave" → list → open s-002 → bar shows s-002. Also test that cancel keeps you.
       Hmm wait — when I render `/sessions/s-001` directly, the GET sets active to s-001 (server). So the bar shows s-001 already.
    g. No bar when no active: fresh state (activeSessionId null), render `/sessions` → no bar (e.g., queryByTestId absent).
    h. Logout clears: probably already covered by the existing auth behavior; but "logout clears all state" must not regress. I can add a test: set active, render, click "Log out" → redirected to login → bar gone. Let me include a light version: after logout, login screen shows; and the active query is cleared — hard to assert directly; the bar's absence is enough (unmounted). Meh, that's just a route change assertion. Include it as regression coverage? The requirement lists "logout clears all state" as a behavior that must not regress. A test: render with active session, click Log out → see "Sign in" → bar's testid absent. But that's trivially true since the layout unmounts. The real assertion is `queryClient.clear()` — not observable from outside. Maybe skip; but the instructions say to test behaviors. Logout redirect behavior is existing (probably untested). Let me add a small test to lock in "after logout, the bar is gone and login shows."

       Actually wait: `logout` does `queryClient.clear()`, then `setUser(null)` → RequireAuth → Navigate to /login. The bar unmounts. After re-login, the bar should refetch active (mock cleared it on logout, so null). I can assert: log in again → bar absent (since the mock cleared active). That's a decent behavioral assertion for "logout clears all state" as far as the bar is concerned.

    Also, I need to make sure existing tests still pass — they should; my changes don't affect the list.

    Also: `renderApp` uses the real `routes` and `createMemoryRouter`. MSW server is set up in setup.ts. `state` from `src/mocks/db` is mutable.

    Important: tests must reset `state.activeSessionId` between tests (afterEach or in each test). The mock db is a module singleton; `afterEach(server.resetHandlers())` doesn't reset state. I'll set `state.activeSessionId = null` at the start of each test (and `state.user` as needed).

    Also, the existing tests set `state.user = {...}` but don't reset — order dependency. I'll be explicit in my tests.

    Also note: sessions array in db is mutable (close mutates `s.status`). A test that closes s-001 would leave it closed for later tests! I need to be careful: my close test closes a session permanently in the module state. To avoid cross-test pollution, I should restore it. Options: pick a specific session to close and restore its status in a finally, or reset the relevant fields. Since the `sessions` array is a module-level export, I can save/restore in the test:
    ```ts
    const target = sessions.find((s) => s.id === 's-001')!;
    const original = { ...target };
    ... close ...
    // restore in finally
    Object.assign(target, original);
    ```
    Hmm, but is that "testing behavior not implementation"? Restoring mock state is test hygiene, fine.

    Also, `startedAt` is fixed 2024 — the elapsed will be like `~9000h`. The regex `/^\d+h \d+m \d+s$/` matches.

    Wait, actually, hmm: let me reconsider the elapsed format. If I omit leading zero units: hours from 2024 are huge, so `Xh Ym Zs` always. For a session started just now, `0s`. My formatter:
    ```ts
    export function formatElapsed(ms: number): string {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }
    ```
    Test: `formatElapsed(0)` = `0s`, `formatElapsed(65_000)` = `1m 5s`, `formatElapsed(3_665_000)` = `1h 1m 5s`, negative → `0s`. I'll unit-test the formatter in the same file.

18. Now let me think more concretely about the invalidation in `SessionDetailScreen`. Currently:

    ```tsx
    const { id = '' } = useParams();
    const { data: session, isLoading } = useSession(id);
    ```

    Add:
    ```tsx
    const queryClient = useQueryClient();
    useEffect(() => {
      if (session) {
        // Opening a session makes it the server's active session (unless it's
        // already closed). Refetch the source of truth so the bar reflects it.
        void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
      }
    }, [session, queryClient]);
    ```

    Wait — but this fires on every `session` change, including after saving notes (the cache updates the detail → session object new → effect → invalidate → refetch active). Harmless (the active hasn't changed; a refetch). And on close (detail cache updates to closed) → invalidate → refetch → server's active is null → bar empties. Actually that covers the close-from-detail case too! But the bar's close also needs it — the bar uses `useCloseSession` whose onSuccess I'll also add the invalidation to (so close from the bar empties the bar). Both paths → same handler in `useCloseSession.onSuccess`.

    Hmm, so maybe I don't need the detail-screen effect if... no — the "open makes active" case requires a reaction to the detail's load. The detail-screen effect is the cleanest place. But wait — is it a "service-level" concern? It's a React app; fine.

    Alternative: in the `useSession` hook itself, wrap with a custom hook that subscribes... over-engineered. The effect in the screen is fine and local.

    But note: the effect depends on `session` (the data object). On initial load undefined→object: fires. Good.

    One concern: `invalidateQueries` returns a promise; in StrictMode the effect fires twice — fine.

    Another concern: does the invalidation refetch even if the active query hasn't been fetched yet (the bar's query)? Both mount together; the invalidation triggers a fetch if not present. `invalidateQueries` only refetches active observers, and creates a fetch if not present... actually, `invalidateQueries` marks stale and refetches active (mounted) queries. If the bar isn't mounted (impossible in an authenticated screen)... the detail is under AppLayout, so the bar is always mounted. Fine. Even if not, the next mount fetches fresh.

19. `useCloseSession.onSuccess` — add:
    ```ts
    void qc.invalidateQueries({ queryKey: sessionKeys.active() });
    ```
    After patching lists. This handles the close-from-bar (bar empties) and close-from-detail.

    Wait, is there a case where closing a session shouldn't clear the bar? If the closed session isn't the active one — then refetch returns the same active session; the bar is unchanged. Correct.

20. Now the bar component:

    ```tsx
    import { useEffect, useState } from 'react';
    import { useNavigate } from 'react-router-dom';
    import { Badge } from '../../components/ui/Badge';
    import { Button } from '../../components/ui/Button';
    import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
    import { useActiveSession, useCloseSession } from './queries';

    function useNow(active: boolean): number {
      const [now, setNow] = useState(() => Date.now());
      useEffect(() => {
        if (!active) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
      }, [active]);
      return now;
    }

    export function formatElapsed(ms: number): string { ... }

    export function ActiveSessionBar() {
      const { data: active } = useActiveSession();
      const closeSession = useCloseSession();
      const navigate = useNavigate();
      const [confirmClose, setConfirmClose] = useState(false);

      const now = useNow(Boolean(active && !active.closedAt));
      if (!active) return null;

      const elapsed = formatElapsed((new Date(active.closedAt ?? undefined).getTime() ...
    ```

    Hmm wait, closed active can't happen (server clears on close), but the cache could hold a closed session transiently? After close, the invalidation refetches → null. Between close success and refetch, the active cache still holds the old (open) session. So a closed `active` in the bar is unlikely. Still, compute elapsed as `end - start` with `end = closedAt ?? now`.

    ```tsx
    const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
    const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());
    ```

    Render:
    ```tsx
    return (
      <div className="active-session" data-testid="active-session-bar" aria-label="Active session">
        <strong>{active.name}</strong>
        <Badge tone={active.status}>{active.status}</Badge>
        <span data-testid="active-session-elapsed" aria-label="Elapsed time">{elapsed}</span>
        <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
        <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>Close session</Button>
        <ConfirmDialog
          open={confirmClose}
          title="Close this session?"
          body="Closing is final. Unsaved notes will be lost."
          confirmLabel="Close session"
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => { setConfirmClose(false); closeSession.mutate(active.id); }}
        />
      </div>
    );
    ```

    Wait — "close session (call the existing close endpoint, with confirmation; on success the bar empties)." Reuse `useCloseSession` — which calls `api.closeSession`.

    Note the ConfirmDialog renders a `role="dialog"` div — fine.

    One issue: two ConfirmDialogs with the same title in the DOM? The detail screen has "Close this session?" too. When on the detail screen, if both open — unlikely (one per trigger). Fine.

    Accessibility for the test: use `getByRole('button', { name: 'Resume' })` etc.

21. AppLayout change:

    ```tsx
    import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
    ...
    <header>...</header>
    <ActiveSessionBar />
    <main>
      <Outlet />
    </main>
    ```

    The doc comment says "anything that should appear on every authenticated screen belongs here, above <Outlet />."

22. Now `useActiveSession`:

    ```ts
    export function useActiveSession() {
      return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
    }
    ```

    Type: data is `Session | null`.

    Hmm — react-query v5: `queryFn` returning `Promise<Session | null>` → data: `Session | null`. Fine.

23. Potential issue: the mock handler `GET /api/sessions/active` — exists. Good.

24. Now let me think about the "survives a full page refresh" test more. A true full refresh is not possible in a unit test; the simulation: the server-side state (`state.activeSessionId`) persists, and a new app instance (new memory router + new query client) fetches `GET /sessions/active` on mount. That's exactly the behavior to test: with activeSessionId set and a fresh `renderApp('/sessions')`, the bar shows. Note that `renderApp` creates a fresh QueryClient and AuthProvider per call — the AuthProvider calls `api.me()` — needs `state.user` set. OK.

    So test:
    ```ts
    it('shows the active session after a refresh (fresh app, server still holds it)', async () => {
      state.user = ada;
      state.activeSessionId = 's-001';
      renderApp('/orders'); // anywhere
      await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    });
    ```
    Wait — "Inspection 1" is also the row in the list; on /orders, the order reference is ORD-..., so "Inspection 1" is unique to the bar.

    But note: with `renderApp('/orders')`, the bar is in AppLayout. The orders list shows ORD references. The bar shows "Inspection 1". Good.

    Hmm — but does the bar show on `/orders`? Yes, AppLayout wraps all authenticated routes including orders. "Shown on every authenticated screen."

25. Test: opening a session makes it active + bar updates:
    ```ts
    it('opening a session from the list makes it the active one', async () => {
      state.user = ada; state.activeSessionId = null;
      renderApp('/sessions');
      await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
      // bar absent initially
      expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
      await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
      // bar shows name; the detail's h1 also shows the name — use testid-scoped query
    });
    ```
    Hmm, "Inspection 1" appears in both the bar and the h1. Use `within(bar)`.

    Then "replaces":
    ```ts
    // back to the list
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));  // nav link
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => expect(within(bar).getByText('Inspection 2')).toBeInTheDocument());
    expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
    ```
    Wait — the nav link "Sessions": `getByRole('link', { name: 'Sessions' })` — the list rows also have "Inspection N" links, and the nav has "Sessions" and "Orders" links. Unique. But note: on the detail screen, the nav "Sessions" link exists; the detail has h1 + badge + textarea + buttons. OK.

    Hmm wait, one gotcha: clicking the nav "Sessions" while on a non-dirty detail — no blocker (dirty=false) → navigates. Good.

    But another gotcha: the bar's "Resume" and detail's "Close session" buttons, etc. Names are mostly unique.

    Also, `within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')` — the bar re-renders with the new session.

26. Resume test:
    ```ts
    it('resume navigates to the active session detail', async () => {
      state.user = ada; state.activeSessionId = 's-003';
      renderApp('/orders');
      await waitFor(() => expect(within(bar).getByText('Inspection 3')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Inspection 3' })).toBeInTheDocument());
    });
    ```
    Note: does the bar's name text conflict with the order? The orders list shows "ORD-2024-0001" etc. Fine.

    Wait, when on the detail, the bar's "Inspection 3" and the h1 "Inspection 3" both exist; use heading role.

27. Close-from-bar test:
    ```ts
    it('close session from the bar empties the bar after confirm', async () => {
      state.user = ada; state.activeSessionId = 's-005';
      const target = sessions.find((s) => s.id === 's-005')!;
      const snapshot = { ...target };
      try {
        renderApp('/orders');
        const bar = await screen.findByTestId('active-session-bar');
        await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
        await userEvent.click(screen.getByRole('button', { name: 'Close session' })); // dialog confirm
        await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
        // the list cache should reflect the closed status too? assert via the list
      } finally {
        Object.assign(target, snapshot);
      }
    });
    ```
    Note: there are two buttons named "Close session" (the bar's trigger and the dialog's confirm). After clicking the bar's trigger, the dialog opens with a confirm button also named "Close session." `getByRole('button', {name: 'Close session'})` would match 2 → error. Use `within(dialog)`. The dialog has `role="dialog"` with `aria-label={title}` = "Close this session?". So:
    ```ts
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));
    ```
    The detail screen's close dialog has the same label — but the detail isn't mounted here.

    Also, to make "on success the bar empties" more meaningful, assert the close actually happened: after closing, navigate to the list? Or assert `state.activeSessionId === null`? That's asserting on mock state (implementation-ish). Better behavioral: after close, bar absent; and the session in the list is closed — render is already on /orders; I can navigate to /sessions and check the badge "closed" for Inspection 5. That also verifies the `patchLists` path. Let me add:
    ```ts
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('closed')).toBeInTheDocument());
    ```
    Hmm, there are multiple "closed" badges on page 1 (statuses cycle: i%3==2 → closed: s-003, s-006, s-009). So "closed" is not unique. I'll check within the row of Inspection 5: `within(screen.getByRole('row', { name: /Inspection 5/ })).getByText('closed')`. The row name: the row's accessible name includes the cell text "Inspection 5," the operator, and the status. `getByRole('row', { name: /Inspection 5/ })` — note: "Inspection 5" would match... the row's accessible name is the concatenation of cells: "Inspection 5 Alan closed"? Wait s-005: i=4 → operator ['Ada','Grace','Alan'][4%3=1] = 'Grace', status ['open','paused','closed'][1] = 'paused'. So after close → 'closed'. Row name /Inspection 5/ — does it match "Inspection 50" too? No, only 27 sessions. But the regex /Inspection 5/ would match "Inspection 5" and also "Inspection 5..."? Only "Inspection 5" exists (1-27; "Inspection 5" appears only once... wait, "Inspection 15" contains "15" not " 5"; the regex "Inspection 5" — "Inspection 15" is "Inspection 15" — substring "Inspection 5"? No: "Inspection 15" = I-n-s-p...space-1-5. "Inspection 5" requires a space then 5. "Inspection 15" has space then 1. No match. Good. But page 1 only shows 1-10. s-005 is on page 1. Good.

    Actually, maybe simpler: after close from the bar, just assert the bar is gone + `state.activeSessionId === null`? I'd rather assert the visible list. Let me keep the list assertion — it's behavioral and locks in the "patch the list" pattern for the close path.

    Hmm wait, actually there's a subtlety: the close mutation's onSuccess patches `['sessions','list']` caches — but when I'm on /orders, the list cache isn't loaded; `patchLists` on a nonexistent cache is a no-op; then navigating to /sessions fetches fresh from the server → shows closed anyway. So the assertion would pass via refetch, not via patch. Still behaviorally valid. Fine.

28. Dirty guard test (replacement with confirmation):
    ```ts
    it('replacing the active session with unsaved notes asks first', async () => {
      state.user = ada; state.activeSessionId = null;
      renderApp('/sessions/s-001');
      // wait for detail
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
      // bar now shows s-001 (server set active on GET)
      const bar = await screen.findByTestId('active-session-bar');
      expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText(/Notes/), 'x');

      // try to open another session via nav -> list
      await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
      const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
      expect(within(dialog).getByText(/have not been saved/)).toBeInTheDocument();

      // cancel stays
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

      // confirm leaves, then open another
      await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
      await waitFor(() => expect(screen.findByRole('dialog', { name: 'Leave with unsaved notes?' })));
      ...
    });
    ```
    Hmm, this is getting long. Also `getByLabelText(/Notes/)`: the label wraps a textarea: `<label>Notes<textarea .../></label>` — the accessible name of the textarea is "Notes." `getByLabelText('Notes')` works (the label text includes "Notes"). Good.

    `useBlocker`'s dialog: the blocker's ConfirmDialog has title "Leave with unsaved notes?", body "Your changes to the notes have not been saved.", confirm "Leave", cancel "Cancel."

    Note: clicking "Sessions" while blocked: the first click triggers the blocker state (navigation is prevented). Does the second click need to re-trigger? After cancel (blocker.reset), the blocker state returns to 'unblocked'; I need to click the nav link again to re-trigger. Yes, as above.

    After proceed, the list mounts. Then click "Inspection 2" link → detail; server sets active to s-002; the bar updates (invalidation in s-002's detail effect). Assert the bar shows Inspection 2.

    This test covers requirement 3 end-to-end.

    Hmm wait — but when I click "Inspection 2" from the list, is there any blocker? s-001's detail has unmounted; s-002's detail is fresh (not dirty). No blocker. Good.

    Also note: after "proceed," the unsaved notes are discarded (local state unmounts). The server's notes are unchanged. Fine.

29. No-bar test:
    ```ts
    it('shows no bar when there is no active session', async () => {
      state.user = ada; state.activeSessionId = null;
      renderApp('/sessions');
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
      expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
    });
    ```
    Hmm — but wait: the list screen loads sessions; does any of those GETs set active? No — only GET /sessions/:id sets active. The list's GET doesn't. Good, active remains null.

    But note: the `waitFor` heading — the h1 "Sessions" appears after the data loads (before that, "Loading…" is shown). Actually, the screen renders "Loading…" until data; the h1 "Sessions" only renders when data exists. So waiting for the heading = data loaded = no bar. But the bar's active query is also loading — with data null → no bar. Could there be a race where the active fetch hasn't resolved but is pending and the bar renders? `useActiveSession` — while pending, `data` is undefined → `!active` → null. So no bar flash. Good.

30. Logout test:
    ```ts
    it('logout clears the bar and server active session', async () => {
      state.user = ada; state.activeSessionId = 's-001';
      renderApp('/sessions');
      const bar = await screen.findByTestId('active-session-bar');
      await userEvent.click(within(header?)...
    });
    ```
    The "Log out" button in the header. `getByRole('button', { name: 'Log out' })`. Click → logout → `queryClient.clear()` + user null → RequireAuth → /login → LoginScreen shows "Sign in." Assert `await screen.findByText('Sign in')` (button) and bar absent. Then re-login: `await userEvent.type(screen.getByLabelText('Name'), 'Ada')` — the input's label is "Name." And click "Sign in." Then `/sessions` — bar should be absent (the mock cleared active on logout).
    ```ts
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
    ```
    Wait — but after re-login, `me()`... AuthProvider's `login` sets user; RequireAuth passes; AppLayout mounts; bar fetches active → null (mock cleared). Assert no bar. Also assert the list loaded to ensure timing (so the absence isn't a flash before load). I'll wait for heading Sessions, then assert no bar. Hmm, but the bar's fetch may still be in flight — the heading appearing is independent. The absence of the bar while the active fetch is pending is expected (renders nothing). To make the assertion meaningful, wait for the active fetch to settle... hard from outside. Alternative: assert the bar is absent, then also assert that after opening a session, the bar appears (proving the bar works after re-login)? That's a lot.

    Simpler meaningful version: after logout → login screen visible, bar gone. That locks in "logout clears all state" at the bar level. The re-login refetch part is the same query mechanics already covered. I'll do logout → assert login screen + no bar. Keep it lean.

    Hmm, but "a test that only exercises the happy path is worse than no test"... these tests include negative/edge cases: no bar, guard, cancel, close flow. Good coverage.

31. Ticking test — let me write it carefully:
    ```tsx
    it('ticks the elapsed time once per second', async () => {
      vi.useFakeTimers();
      try {
        state.user = ada; state.activeSessionId = 's-001';
        renderApp('/orders');
        const bar = await vi.waitFor(() => screen.getByTestId('active-session-bar'));
        const elapsed = screen.getByTestId('active-session-elapsed');
        const first = elapsed.textContent;
        expect(first).toMatch(/^\d+h \d+m \d+s$/);
        vi.advanceTimersByTime(3000);
        await vi.waitFor(() => {
          expect(elapsed.textContent).not.toBe(first);
        });
      } finally {
        vi.useRealTimers();
      }
    });
    ```
    Concern: `vi.waitFor` with fake timers — per vitest docs, `vi.waitFor` is designed for fake timers. `screen.getByTestId` inside — fine.

    Concern: initial fetch under fake timers — MSW's intercept resolves via microtasks; `vi.waitFor`'s loop: each iteration calls the callback (which throws if not found), then awaits a fake-timer-driven delay that vitest advances. Since `vi.waitFor` advances the fake clock, and microtasks are flushed on await, the fetch promise resolves. I'm reasonably confident.

    But hmm, one more concern: react-query's query scheduling uses `setTimeout` (for retries, etc.) — with fake timers, `retry: false` so no retries. GC uses intervals — `cacheTime` default 5 min — irrelevant.

    Also, AuthProvider's `api.me()` fetch — same mechanism.

    Alternatively, to be safer, I can avoid fake timers: render, wait for the bar with real timers (waitFor), read the first text, then... can't wait a real second (slow but tolerable? 1s test). Actually, a real 1s wait is a bit slow but robust. Hmm, fake timers are the cleaner approach and vitest supports it. I'll go with fake timers + `vi.waitFor`.

    Hmm, wait: there's a known gotcha — `vi.useFakeTimers()` also mocks `Date.now()`, and @testing-library's `waitFor` uses `setTimeout` — under fake timers, a plain `waitFor` (from testing-library) would hang unless you advance. That's why I use `vi.waitFor`. Yes.

    Also `userEvent` under fake timers is problematic — but I don't use userEvent in that test. Good.

    Another gotcha: rendering with fake timers active — React 18's `createRoot` uses `MessageChannel` for scheduling... does `vi.useFakeTimers()` mock `MessageChannel`? By default, vitest's fake timers (based on @sinonjs/fake-timers) do not fake `MessageChannel` unless configured (`toFake: ['MessageChannel']` is not in the default? actually @sinonjs/fake-timers' default `toFake` includes: 'setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','clearImmediate','Date'... and `queueMicrotask`? Hmm. Vitest's default fake timers fake: setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, process.hrtime, process.nextTick, performance.now, Request, Response, fetch?? No. Let me recall: vitest's `vi.useFakeTimers()` fakes by default everything in `['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date']` plus in Node `process.nextTick`, `performance`, `queueMicrotask`?

    Hmm, if `process.nextTick` is faked, that could stall promise resolution chains that depend on nextTick... but microtasks (promise resolution) are not faked. Node's `setTimeout` is faked; but promise `.then` callbacks are microtasks — not faked. React's concurrent scheduling uses MessageChannel — not in the default fake list (I think vitest doesn't fake MessageChannel by default). So React rendering works. MSW/fetch resolution: msw's intercepts fetch and responds — uses `Promise.resolve().then(...)` chains and possibly `process.nextTick`?? If nextTick is faked and `vi.waitFor` only advances `setTimeout`-family timers... does `vi.advanceTimersByTime` also run "next-tick" timers? In @sinonjs/fake-timers, `process.nextTick` timers are a separate "tick" list, and `clock.tick` runs them in order. Vitest's `advanceTimersByTime` calls `clock.tickAsync`, which handles nextTicks. OK, should be fine.

    To minimize risk, I can configure the test with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })`. That fakes only what I need: the interval and Date. Then everything else (nextTick, MessageChannel, microtasks) is real. The elapsed computation uses `Date.now()` — faked, consistent with the interval. `vi.waitFor` with these fakes: its internal wait uses setTimeout (faked) and vitest advances it.

    Hmm, does `vi.waitFor` work when only some timers are faked? vitest's `vi.waitFor` detects fake timers and uses `advanceTimersByTime` in its loop. Should be fine.

    Actually, let me reconsider — maybe a simpler, fully robust approach: don't fake anything; assert that the elapsed text matches the format, and separately test the tick by rendering, waiting for the bar (real waitFor), capturing `t0 = text`, then `await new Promise(r => setTimeout(r, 1100))`, then assert the text changed. A ~1.1s real delay in one test is acceptable for vitest. This avoids all the fake-timer/React/MSW interaction risks. Hmm. But it makes the suite slower.

    Which is more "in the app's style"? The app has no existing timer tests. Let me go with fake timers + `vi.waitFor` — it's the standard vitest way and I'll scope `toFake` to reduce risk... actually, the default `toFake` is probably fine. Let me just use plain `vi.useFakeTimers()`. I've seen RQ+fake-timer tests work with `vi.waitFor`.

    Hmm, actually wait. One more risk with default fake timers: vitest fakes `fetch`?? No. Fakes `performance`? Yes, `performance.now` is faked (not a problem). Fakes `Date` — yes, needed for us.

    OK let me go with `vi.useFakeTimers()` + `vi.waitFor`.

    Actually, hold on, let me reconsider whether to include a tick test at all. "A test without assertions, or a test that only exercises the happy path, is worse than no test" — my test suite has plenty of non-happy-path tests. The tick test verifies requirement 1's "ticking elapsed time." I'll include it.

32. Now — let me double-check the existing behavior that "detail editing + dirty flag warning on route change" doesn't regress: I'm modifying `SessionDetailScreen` (adding an effect + a queryClient). The blocker logic is unchanged. My dirty-guard test covers this.

33. Wait, one more thing about the dirty-guard flow: the bar shows the active session's name; when I'm on s-001's detail and dirty, the blocker dialog opens on nav click. But the bar's "Close session" or "Resume" too — the Resume click navigates to the same route → no blocker. OK.

34. Now, a potential problem with `useBlocker` + the bar: none.

35. Let me also double-check `AppLayout` — the `user?.name` span. Fine.

36. Now, is there a risk that the bar's active query refetches on every route change (remount)? The bar is inside AppLayout, which doesn't remount on child route changes (same layout route). The query observer persists. Good.

37. Edge: `useActiveSession` is only used by the bar. The `enabled` option? Should the active query only run when authenticated? The bar only renders inside AppLayout (authenticated). Fine.

38. Let me also handle: what if `active` is a session, but... fine.

Now — one more requirement detail: "the bar shows the main fields (name, status, elapsed time ticking) on all screens." So name, status badge, elapsed. Plus resume/close. Covered.

"Opening a session from the list makes it the active session" — server-side on GET detail; the client refetches active via the invalidation in the detail effect. Also — hmm, should the list trigger activation on click instead? The task says the API exposes GET /sessions/active as the source of truth; it doesn't say there's an "activate" endpoint. The mock's GET detail sets active. So the flow is via the detail's GET. My design aligns.

But wait — let me consider the deep-link scenario more carefully, since it's an explicit non-regression: "deep-linking directly to the detail URL." On a fresh load at `/sessions/s-001`:
- AuthProvider: `me()` → user.
- RequireAuth → AppLayout → bar (active query fires) + detail (session query fires).
- Both fetches race. If the active fetch resolves before the detail: bar shows old active (null if none). Then the detail resolves → effect → invalidate → refetch → bar shows s-001.
- If the detail resolves first: server sets active; then the active fetch resolves with s-001 directly.
Either way, converges.

Another scenario: deep link to a closed session's detail: the server doesn't set active; the bar shows the previous active (or nothing). The detail effect invalidates → refetch → unchanged. Correct.

39. Now, "only one active session at a time" — server invariant (single `activeSessionId`). The client never holds two. Good.

40. Now let me write out all the files.

Which files do I deliver? "Deliver every file the solution needs, complete, from the first line to the last." So files I change:
1. `src/features/sessions/queries.ts` (add useActiveSession, invalidate active in close mutation)
2. `src/features/sessions/ActiveSessionBar.tsx` (new)
3. `src/features/sessions/SessionDetailScreen.tsx` (add invalidation effect)
4. `src/app/AppLayout.tsx` (render bar)
5. `src/features/sessions/ActiveSessionBar.test.tsx` (new tests)

Files I don't change: client.ts (already has getActiveSession), types, mocks (already support active), render.tsx, setup, auth, etc. Per the format: "don't restate files you're not changing." So I only output the 5 files above.

Wait — do the mocks need any change? Let me re-check the handlers:
- `GET /api/sessions/active` ✓ exists.
- `GET /api/sessions/:id` sets active ✓.
- `POST /api/sessions/:id/close` clears active if matched ✓.
- `POST /api/auth/logout` clears active ✓.

No mock changes needed.

Do the mocks support PATCH notes (unsaved notes scenario)? ✓ exists.

Now let me write `queries.ts` in full:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionQuery } from '../../api/client';
import type { Page, Session } from '../../api/types';

/** Query keys live next to their queries, one factory per feature. */
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
 * The server-side active session. This is the only source of truth the bar
 * reads: opening and closing sessions change it server-side, and the client
 * refetches instead of tracking it locally.
 */
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useUpdateSessionNotes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.updateSession(id, { notes }),
    onSuccess: (updated: Session) => {
      // targeted update, not invalidation: the server already returned the row,
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
      // The server drops the session from active on close; ask for the
      // source of truth again so the bar empties (or keeps the next active).
      void qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}

/**
 * Write one changed row into every cached list page that holds it.
 * This is a pattern the app uses everywhere; copy it rather than invalidating.
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

Hmm wait, one issue: `invalidateQueries` inside the close mutation's `onSuccess`, plus the detail screen's effect also invalidates on session change (the detail cache update triggers the effect). Redundant but harmless.

But — subtle issue: when I close from the bar (not on the detail screen), only the mutation's invalidation runs. Good. When I close from the detail screen, both run. Fine.

Now `SessionDetailScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Opening a session makes it the server's active session (unless it's
  // already closed). We don't write that fact client-side; we refetch the
  // source of truth so the active session bar converges.
  useEffect(() => {
    if (session) void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
  }, [session, queryClient]);

  // The dirty flag. Every screen that edits uses this shape: local draft vs the
  // cached server value, and a router blocker rather than a beforeunload hack.
  const dirty = session !== undefined && notes !== session.notes;

  const blocker = useBlocker(dirty);
  ...
```

Wait, one concern: the `notes` sync effect: `useEffect(() => { if (session) setNotes(session.notes); }, [session])` — this runs every time the session object changes. Including after the detail cache updates from a close (the notes are unchanged, so setNotes to the same value — a no-op re-render, fine). And after saving notes (the updated session has the new notes → setNotes to the same → dirty false). Fine.

But — subtle: my invalidation effect depends on `[session]`; when I save notes, session changes → invalidate active → refetch (a wasted fetch, but consistent). OK.

Hmm, is there a risk of a loop? invalidate → active refetch → bar re-renders → detail's `session` doesn't change → no new invalidation. No loop.

Now `ActiveSessionBar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar. It renders on every authenticated screen
 * (from AppLayout) and shows the server's active session, if any.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  // 1-second tick while there is a running session to measure.
  const now = useNow(Boolean(active) && active.closedAt === null);

  if (!active) return null;

  const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
  const started = new Date(active.startedAt).getTime();
  const elapsed = formatElapsed(end - started);

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <strong>{active.name}</strong>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="active-session-elapsed">{elapsed}</span>
      <div className="actions">
        <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
        <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
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
          closeSession.mutate(active.id);
        }}
      />
    </div>
  );
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

Wait — `active.closedAt === null` — the type is `string | null`. `Boolean(active) && active.closedAt === null` — TS: `active` could be undefined; `Boolean(active)` narrows? Actually, `Boolean(active)` doesn't narrow in the second operand. `Boolean(active) && active.closedAt === null` — after `Boolean(active) &&`, does TS narrow `active` to non-undefined? `Boolean(x)` returns boolean; does TS 4.4+ narrow via aliased conditions? `const running = Boolean(active) && active.closedAt === null` — in the `&&` expression, after the left side `Boolean(active)`... TS does narrowing via boolean guards: `Boolean(x)` as a guard narrows x in subsequent && operands? Actually, aliased condition narrowing works: `const isString = typeof x === 'string'` then `if (isString)`. But `Boolean(active) && active.closedAt === null` — the left operand `Boolean(active)` — TS treats `Boolean(active)` as a type guard for `active !== null && active !== undefined`? I believe modern TS narrows via `Boolean(x)` in logical expressions (it's a documented "truthiness" narrowing: `if (Boolean(x))` narrows). Yes — TS narrows on `Boolean(x)` conditions. To be safe, I'll write it as `const ticking = active !== undefined && active.closedAt === null;`. Cleaner. Actually since the type is `Session | null | undefined` (query data), `active !== undefined`... data can be `null` or `undefined`. `active && active.closedAt === null` — `active &&` narrows to Session. Let me use that.

    Hmm, and when closed (which shouldn't happen for active), `now` is frozen at mount — fine, we'd display the total with the closedAt end anyway.

    Wait, actually there's an ordering issue: I call `useNow` before the early return `if (!active) return null;` — good, hooks are called unconditionally. ✓.

    The elapsed span's aria: add `title` or aria-label? For tests, the testid is enough. Maybe `aria-label="Elapsed time"` — but then the accessible name is "Elapsed time," and the text content is the duration; `getByTestId` works. I'll add it for a11y.

    Actually, hmm, one design question: does the bar have a heading/label "Active session"? For a11y, the container could be `role="region" aria-label="Active session"`. But the region role requires... fine. Or just a div. The existing UI is simple (no regions). Let me keep it a div with testid. Maybe add `aria-label="Active session"` to the div — a div with aria-label without a role is ignored by a11y, but harmless. I'll skip extra a11y noise; testids + real button/dialog semantics are enough and match the app's style.

`AppLayout.tsx`:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';

/**
 * The authenticated shell. Anything that should appear on every authenticated
 * screen belongs here, above <Outlet />.
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

Now the test file `src/features/sessions/ActiveSessionBar.test.tsx`:

Style notes from the existing tests:
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
```

They use global `describe/expect/it` (vitest globals enabled) but import them explicitly — actually they import from 'vitest'. I'll follow.

Also need `within` from testing-library.

Test list:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

afterEach(() => {
  state.activeSessionId = null;
});
```

Hmm — also, the close test mutates the sessions array; I'll restore in the test. And `state.user` — set per test. Should I reset the user in afterEach too? The existing tests don't; but my tests need control. I'll set `state.user = OPERATOR` at the start of each test, and add `state.user = null` in afterEach? Wait — the `renderApp` in another test file might depend on... the test files run in separate workers (vitest isolates by file), so no cross-file pollution. Within my file, I set explicitly. For safety, I'll reset both in afterEach.

Actually wait — vitest runs each test file in an isolated environment (default `isolate: true`), so module state is per-file. Within my file, I set explicitly. For safety, I'll reset both in afterEach.

Tests:

1. `formatElapsed` unit test:
```tsx
it('formats elapsed time', () => {
  expect(formatElapsed(0)).toBe('0s');
  expect(formatElapsed(999)).toBe('0s');
  expect(formatElapsed(5_000)).toBe('5s');
  expect(formatElapsed(65_000)).toBe('1m 5s');
  expect(formatElapsed(3_665_000)).toBe('1h 1m 5s');
  expect(formatElapsed(-42)).toBe('0s');
});
```

2. No bar without active:
```tsx
it('shows no bar while the server has no active session', async () => {
  state.user = OPERATOR;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
});
```
Hmm — is this a weak test? It asserts the absence after the list loads. The active fetch could still be pending — but even when it resolves with null, no bar. To be thorough, I could also assert after a short settle... the heading appearing means the list fetch resolved; the active fetch (same timing) probably has too, but not guaranteed. Since data null → no bar either way, the assertion holds regardless of timing. Actually, that makes the test slightly vacuous (the bar would be absent even mid-fetch). But combined with test 3 (bar present when active), it's meaningful: the presence/absence tracks the server state. I'll keep it.

3. Refresh survival (server-side state, fresh app):
```tsx
it('restores the active session from the API after a refresh', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-002';
  renderApp('/orders'); // a fresh app instance, as after a full page load
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
  expect(within(bar).getByText('paused')).toBeInTheDocument();
});
```
s-002: i=1 → status ['open','paused','closed'][1] = 'paused'. Badge text 'paused'. But "paused" might also appear... on /orders, the order status is pending/approved/... no 'paused'. The bar's badge shows 'paused.' `within(bar)` scoped. Good.

Hmm wait — "survives a full page refresh" — my simulation: a fresh `renderApp` = fresh QueryClient + fresh router + fresh AuthProvider, with the mock server state persisting (as the real server would). This is the standard way to test this here. Good.

4. Opening from the list activates + bar shows on the detail screen:
```tsx
it('marks a session active when it is opened, on every screen', async () => {
  state.user = OPERATOR;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

  // the bar persists when leaving the detail screen
  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
});
```
Wait — clicking "Inspection 1" — the link. But there might be two elements with the name "Inspection 1"? The table row's link. And after navigation, the bar shows "Inspection 1" text (strong) and the h1. The initial `getByRole('link', {name: 'Inspection 1'})` — only the list row. OK.

Note: `waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument())` — initially the screen shows "Loading…" and then the table. Good.

Then click the nav "Sessions" link — from the detail. Not dirty → navigates. Wait for heading "Sessions." Hmm — the heading "Sessions" — the list's h1. But the nav link is also "Sessions" (not a heading). `getByRole('heading', { name: 'Sessions' })` is unique. Good.

5. Replacement:
```tsx
it('replaces the active session when another one is opened', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await waitFor(() =>
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
  );
  expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
});
```
Wait — the list initially loads with state.activeSessionId = 's-001' — the bar shows from the start. Then click Inspection 2 → detail → server active=s-002 → invalidation → bar updates. Note: while on the detail, the bar shows "Inspection 2" and the h1 "Inspection 2." Fine.

Hmm, one timing concern: after clicking Inspection 2, the detail's `useSession` fetches → the mock sets active → the detail's effect invalidates active → the bar's query refetches → shows s-002. The `waitFor` handles the async. Good.

6. Resume:
```tsx
it('resumes the active session from the bar', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-004';
  renderApp('/orders');
  const bar = await screen.findByTestId('active-session-bar');
  await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument(),
  );
});
```
s-004: i=3 → status open. h1 "Inspection 4." Also the bar shows "Inspection 4" — but I'm using the heading role. Good.

Wait — `renderApp('/orders')`: the orders list loads; the bar fetches active → s-004. But hmm — the GET /orders/:id? No. Only the active fetch. Good.

7. Close from the bar:
```tsx
it('closes the active session from the bar and empties the bar', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-005';
  const target = sessions.find((s) => s.id === 's-005')!;
  const snapshot = { ...target };
  try {
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
    expect(state.activeSessionId).toBeNull();

    // the close is also visible in the list
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() =>
      expect(within(screen.getByRole('row', { name: /Inspection 5/ })).getByText('closed')).toBeInTheDocument(),
    );
  } finally {
    Object.assign(target, snapshot);
  }
});
```
Hmm — `expect(state.activeSessionId).toBeNull()` is an assertion on mock state; borderline implementation. But it's the "server" state in this test world; the behavioral proof is the bar's absence + the list showing closed. Should I drop the state assertion? It's actually a fine proxy for "server cleared active." The instructions warn against asserting only that a call happened; I have UI assertions. I'll keep the UI assertions and drop the raw state check to keep it behavioral. Actually... keeping it is harmless and clarifies intent. Hmm. I'll drop it — the list assertion + bar absence is sufficient and purely behavioral.

    Wait, one issue: `screen.getByRole('row', { name: /Inspection 5/ })` — the table row: `<tr><td><Link>Inspection 5</Link></td><td>Grace</td><td><Badge>closed</Badge></td></tr>`. Accessible name of the row: computed from cells: "Inspection 5 Grace closed." The regex /Inspection 5/ matches. But does it match "Inspection 5" only? Among rows 1-10, only row 5. But careful — the regex /Inspection 5/ also matches... "Inspection 5" is a substring of "Inspection 5" (row 5) only. OK.

    But wait — after closing s-005, the list navigation: the list cache for `{status:'', q:'', page:1}` — was it cached before? I was on /orders, so the sessions list cache doesn't exist (the initial render was /orders). Wait, test 7 renders /orders directly — the sessions list isn't fetched. So navigating to /sessions fetches fresh → shows closed. Good. (If it were cached, patchLists would have updated it — also fine.)

    Also: `waitFor` for the bar's absence: `queryByTestId` returns null → `expect(null).not.toBeInTheDocument()` passes immediately. But the bar's absence could be transient? The mutation's onSuccess invalidates active; the refetch returns null (server cleared). Until the refetch completes, the bar shows the old session (the cache still holds s-005 open!). So I need a `waitFor` — yes, I do `await waitFor(() => expect(screen.queryByTestId(...)).not.toBeInTheDocument())`. Good — this waits for the refetch.

    Hmm, wait: is there a possibility that the refetch fails and the bar stays? `retry: false`, the mock is fine. OK.

    Another subtlety: the close mutation's `onSuccess` also does `qc.setQueryData(sessionKeys.detail('s-005'), updated)` — the detail isn't cached (I'm on /orders) — setQueryData on a nonexistent key just creates a cache entry; harmless.

8. Dirty guard / replacement with confirmation:
```tsx
it('asks before replacing the active session while its notes are unsaved', async () => {
  state.user = OPERATOR;
  renderApp('/sessions/s-001');
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument(),
  );
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.');

  // trying to open another session is intercepted by the dirty guard
  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
  expect(within(dialog).getByText('Your changes to the notes have not been saved.')).toBeInTheDocument();

  // cancelling keeps the operator on the session
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();

  // leaving for real, opening another session replaces the active one
  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  const again = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
  await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument(),
  );

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await waitFor(() =>
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
  );
  expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
});
```

Concerns:
- `getByLabelText('Notes')`: the label element contains the text "Notes" and a textarea. The label's text is exactly "Notes" (no other text). `getByLabelText('Notes')` — matches by the label's accessible name. The label is a wrapper: `<label>Notes <textarea/></label>` — the textarea's accessible name = the label text = "Notes." ✓. But note: the string in the label node: "Notes" plus a newline/space — testing-library normalizes whitespace. ✓.

- After `userEvent.type` adds text, dirty = notes !== session.notes. session.notes for s-001: i=0 → `i % 4 === 0` → 'Awaiting parts.' So the initial notes = 'Awaiting parts.'; after typing → dirty. ✓.

- Clicking the nav "Sessions" while dirty: `useBlocker` intercepts. The dialog opens. But — important: does the navigation attempt actually get blocked in a memory router? `useBlocker` from react-router-dom v6.26+ (unstable? no — is `useBlocker` stable in 6.26? It was `unstable_useBlocker` in 6.7+, renamed to `useBlocker` in 6.26? Actually: React Router 6.19 introduced `useBlocker` as stable? Hmm. The existing code imports `{ useBlocker }` from 'react-router-dom' and the package is ^6.26.2 — the existing detail screen already uses it, so it works in this scaffold. My test just triggers it. ✓.

- After cancel (blocker.reset()): the blocker state is 'unblocked.' The dialog closes (open={blocker.state==='blocked'}). The user is still on the detail. ✓.

- Second click → blocked again → dialog → click "Leave" (proceed) → navigation completes → list. ✓.

- Then click "Inspection 2" → detail s-002 → the bar updates to Inspection 2 (server active=s-002; the invalidation). ✓.

- Note: after proceeding from a dirty state, the unsaved notes are gone (unmounted). Then on the list, click Inspection 2. The list shows rows 1-10. ✓.

- One risk: `waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument())` after the proceed — the list's h1. But the nav link "Sessions" is also present (a link, not a heading). ✓ unique.

- Another risk: while the blocker dialog is open, `screen.findByRole('dialog', { name: 'Leave with unsaved notes?' })` — the ConfirmDialog has `aria-label={title}` and role dialog. ✓.

9. Ticking:
```tsx
it('ticking the elapsed time once per second', async () => {
  vi.useFakeTimers();
  try {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');
    const bar = await vi.waitFor(() => screen.getByTestId('active-session-bar'));
    const elapsed = within(bar).getByTestId('active-session-elapsed');
    const first = elapsed.textContent ?? '';
    expect(first).toMatch(/^\d+h \d+m \d+s$/);

    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => {
      expect(elapsed.textContent).not.toBe(first);
    });
  } finally {
    vi.useRealTimers();
  }
});
```
Concern: `vi.waitFor` — is it available in vitest 2.1? `vi.waitFor` was added in vitest 0.34/1.0? Yes, vitest 1+ has `vi.waitFor`. 2.1 ✓.

Concern: under fake timers, the `setInterval` tick updates `now` state → re-render → the elapsed text changes every second. Advance 3000 → 3 ticks (well, tick at 1s, 2s, 3s — but the interval starts on mount after the first render; `advanceTimersByTime(3000)` fires 3 times). The text changes. But — does `vi.waitFor` advance the timers between checks? Yes, `vi.waitFor` internally advances the fake clock. So even if the first check is early, subsequent iterations advance. ✓.

But wait — a subtle issue: the `elapsed` element reference — React re-renders replace the text node but the span element persists (same position in the tree, no key change). `elapsed.textContent` reads the current. ✓.

Another concern: `renderApp` under fake timers — the AuthProvider's `api.me()` fetch — MSW responds via the interceptor (promise-based). `vi.waitFor`'s loop: each iteration runs the callback (throws if the bar isn't found yet), then awaits a delay implemented with the faked `setTimeout`; vitest's `vi.waitFor` handles advancing the fake clock. During those awaits, pending promises (the fetch response) resolve via microtasks. ✓. I believe this works.

Hmm, but one known pitfall: does @sinonjs/fake-timers, when `toFake` includes `queueMicrotask`? Vitest's default `toFake` — let me recall from vitest's source: the default config for `useFakeTimers` fakes: `['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date', 'performance', 'process.nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback']`?? Hmm, I really recall vitest faking `queueMicrotask` by default? Let me think... in vitest's `fakeTimers.ts`, the default `toFake` is `Object.keys(timers)`? There was an issue about `queueMicrotask` breaking promise-based tests when faked...

Actually, I recall: vitest's default fake timers config fakes everything that @sinonjs/fake-timers supports in the environment, except... hmm. The vitest docs: "vi.useFakeTimers() — by default, fakes all timer methods, except nextTick and queueMicrotask"? Or the opposite?

Let me check my memory of the vitest source (v2):
```ts
const defaultToFake = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date']
```
Hmm, no. I really recall that vitest's `FakeTimersConfig` has `toFake?: Iterable<keyof typeof globalThis>`, and the default is all timers except `nextTick` and `queueMicrotask` (deliberately excluded to keep promise-based code working). Yes! I'm fairly sure: vitest's docs say something like "by default, vitest fakes all timers except process.nextTick and queueMicrotask" — or was that the sinon default? @sinonjs/fake-timers' `install()` by default fakes everything available including nextTick... but vitest explicitly passes a list.

From vitest's docs (vi.useFakeTimers): "This uses @sinonjs/fake-timers... by default fakes setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, Date, performance..." I can't recall 100%.

To be safe, I'll be explicit:
```ts
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
```
That fakes exactly what I need (the interval + Date), leaving microtasks/nextTick/MessageChannel real. Then `vi.waitFor` — when fake timers are active (partially), `vi.waitFor` uses the fake clock for its polling delay. Since `setTimeout` is faked, `vi.waitFor`'s internal scheduling is faked, and vitest advances it. ✓. And the fetch/promise chain uses real microtasks. ✓. This is the most robust configuration.

Hmm, but does `vi.waitFor` know to advance when only some timers are faked? It checks `isFake` on the timers... vitest's `vi.waitFor` implementation: it uses `setTimeout` for delays if `typeof setTimeout === 'function'` and the config is fake... I think it checks `vi.isFakeTimers()` (which returns true if any timer is faked) and then advances with `vi.advanceTimersByTime`. With partial faking, `advanceTimersByTime` advances the faked ones. Should be fine.

Actually — a simpler alternative that avoids `vi.waitFor` entirely: after rendering with fake timers, use a manual loop:
```ts
for (let i = 0; i < 100 && !document.querySelector('[data-testid="active-session-bar"]'); i++) {
  await vi.advanceTimersByTimeAsync(50);
}
```
`advanceTimersByTimeAsync` — vitest has it (added in 0.34?). In 2.1, yes: `vi.advanceTimersByTimeAsync`. That flushes microtasks between timer firings. This is explicit and robust. Then read the text, advance 3000 with `advanceTimersByTimeAsync`, and re-read (the state update from the interval callback happens during the async advance). Then assert the change.

Let me use that pattern:

```tsx
it('ticking the elapsed time once per second', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  try {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await vi.advanceTimersByTimeAsync(500); // let me()/active fetch settle
    const bar = screen.getByTestId('active-session-bar');
    const elapsedEl = within(bar).getByTestId('active-session-elapsed');
    const first = elapsedEl.textContent;
    expect(first).toMatch(/^\d+h \d+m \d+s$/);

    await vi.advanceTimersByTimeAsync(2500);
    expect(elapsedEl.textContent).not.toBe(first);
  } finally {
    vi.useRealTimers();
  }
});
```

Hmm — but will 500ms be enough for the fetch to settle? The fetch is promise-based (microtask), not timer-based; `advanceTimersByTimeAsync` awaits and flushes microtasks. Even 0ms of advance + `await` would flush microtasks... but the MSW interceptor might use `setImmediate`/`process.nextTick` internally (not faked here) — those run on the real event loop; `advanceTimersByTimeAsync` yields to the event loop between steps (it's async and awaits real promises), so pending immediates/nextTicks run. 500ms of fake advance with multiple flushes should be plenty. But to be safe, I'll loop until the bar appears, capped:

```ts
for (let i = 0; i < 20; i++) {
  await vi.advanceTimersByTimeAsync(100);
  if (screen.queryByTestId('active-session-bar')) break;
}
const bar = screen.getByTestId('active-session-bar');
```
20 × 100ms = 2s of fake time — plenty. If not there, getByTestId throws (test fails, which is correct).

Hmm wait, but there's a subtle point: the elapsed tick interval starts on mount. During the 20×100ms advance, the interval also fires (every 1000ms fake) — irrelevant, I just need the bar.

Then read `first`, advance 2500 → at least 2 ticks → text changes (the seconds digit changes). The seconds from 2024 to now — any 1s change alters `...s`. Unless the minute rolls over in a way that... no, any 1s change alters the string. ✓.

Edge: `first` could be undefined type-wise (textContent: string | null) — I'll assert non-null via `expect(first).toMatch` (if null, it fails). Then `expect(elapsedEl.textContent).not.toBe(first)` — fine.

Actually, hmm, `advanceTimersByTimeAsync` — does it exist in vitest 2.1? Yes: `vi.advanceTimersByTimeAsync(ms)` was added in vitest 0.34 (as a backport of jest's). ✓.

Also, I need to make sure `vi.useFakeTimers` doesn't break `renderApp`'s React rendering — React 18's createRoot uses `MessageChannel` (not faked in my toFake list) → scheduling is real. But wait: React's initial render is mostly synchronous; subsequent updates go through the MessageChannel port → real → works. State updates from the interval callback → scheduled via MessageChannel (real) → the microtask/event loop runs during `advanceTimersByTimeAsync`'s awaits. ✓.

OK. But actually, wait: is the fake `Date` needed? The elapsed uses `new Date(startedAt)` (real parsing) and `Date.now()` (the `now` state updated by the interval callback, which calls `Date.now()`). If I don't fake Date, `Date.now()` is real and the interval is faked — the elapsed would jump by real milliseconds per tick — the text still changes on each tick (real time passes during awaits? under fake timers, real time also passes a bit... flaky). Faking Date makes it deterministic: each tick, now advances exactly 1000ms. Keep 'Date' in toFake. ✓.

But faking Date also affects the mock db's `closedAt = new Date().toISOString()` on close — not in this test. And the AuthProvider — no Date use. OK.

10. Logout test:
```tsx
it('logout clears the bar and the server active session', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  await screen.findByTestId('active-session-bar');

  await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
  await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
});
```
After logout: user null → RequireAuth → /login → LoginScreen: the form with the "Sign in" button. `findByRole('button', {name: 'Sign in'})`. The bar is gone (the layout unmounted). ✓.

Should I also assert re-login → bar absent (server cleared)?
```ts
  // re-login: the server cleared the active session on logout
  await userEvent.type(screen.getByLabelText('Name'), 'Ada');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
```
Hmm — `getByLabelText('Name')` — LoginScreen's label "Name." ✓. After login, navigate to /sessions (location.state.from? we're at /sessions → from is /sessions). The list loads. The bar fetches active → the mock cleared it on logout → null → no bar. This assertion is meaningful: it proves the bar reflects the cleared server state after re-authentication (not a cached stale session).

But wait — `queryClient.clear()` on logout dropped the active cache; on re-login, the bar refetches. If the implementation had "client-only persistence" (e.g., localStorage), the bar would show s-001 — this test would catch that. Good, it directly tests the "no client-only persistence of server state" requirement. I'll include the re-login part.

Note: after `userEvent.type` into the name input and submit, `login(name)` → user set → RequireAuth → AppLayout → list fetch. ✓.

11. Should I also test that the bar is visible on the orders screen (every authenticated screen)? Test 3 covers /orders. Enough.

Now — let me double-check test 4's "the bar persists when leaving the detail screen": after clicking the nav Sessions from the detail (not dirty), the list loads; the bar should still show Inspection 1. The active cache is still s-001 (fetched earlier), no refetch needed (staleTime 30s). ✓. But wait — actually, is there a subtle issue: when I clicked "Inspection 1" (the list row link), the detail's GET set active=s-001. The bar initially showed... the bar's active query: on mount (the list render), the active fetch → null (initially). After the detail's effect invalidates → refetch → s-001. ✓. Then back to the list — the bar holds s-001 (fresh data). ✓.

Now — potential pitfall in test 4: `screen.findByTestId('active-session-bar')` after clicking Inspection 1. The invalidation triggers the refetch. Timing: the detail's effect runs after the session data is set (after the fetch). Then the invalidation → the active refetch (another MSW round trip). `findByTestId` waits up to 1s. The mock is fast. ✓.

Now — let me reconsider the mock's `GET /sessions/:id` side effect again. It sets active on every GET, including refetches. E.g., stale refetch of the detail → active is reset to the same session. Fine.

But — here's a really subtle issue: in test 5 (replacement), I initially render `/sessions` with active=s-001. The bar shows Inspection 1. Then I click the "Inspection 2" row. But wait — the list rows: "Inspection 2" — s-002, status paused, notes '' (i=1, i%4!==0 → ''). ✓. The detail loads; the mock sets active to s-002 (not closed). The bar updates. ✓.

Now, let me also think about StrictMode double effects: the detail's invalidation effect fires twice → two invalidations → fine.

And StrictMode + `useBlocker` — the existing pattern; fine.

Now — one more consideration: `SessionDetailScreen`'s invalidation effect — it depends on `[session, queryClient]`. `queryClient` is stable. `session` — the data object. When I first navigate to the detail: undefined → object. Fires. But also: when the active query refetches... that doesn't change `session`. OK.

But hmm — another scenario: I'm on the detail of s-001, and the bar's "Close session" closes s-001 (the active). The detail cache updates (the mutation's onSuccess sets the detail to closed) → `session` changes → my effect invalidates active → refetch → null → the bar empties. Also the mutation's own invalidation. Both converge. The detail screen now shows the closed badge; the close button is disabled. The notes remain in the textarea (local). Fine.

Now, let me reconsider: should the invalidation effect run when `session` is a closed session (deep link to a closed one)? It invalidates → refetches → the active is unchanged. Harmless.

Now — the type of `useActiveSession`'s data: `Session | null`. In the bar: `const { data: active } = useActiveSession();` → `active: Session | null | undefined`. `if (!active) return null;` ✓.

Now, let me re-check the `Badge` component: `<Badge tone={active.status}>{active.status}</Badge>` — a span with the status text. In the bar's test, `within(bar).getByText('paused')` — matches the span. ✓. But note — the badge also has a `data-tone` attribute; the text is a direct child. ✓.

Now — the `aria-label` for the elapsed span: I said I'd add `aria-label="Elapsed time"`. Hmm, if I add it, `getByTestId` still works. But a screen reader would read "Elapsed time" instead of the value... for a live ticking value, aria-label actually overrides. Better: no aria-label; the text is the value. Maybe `title`? Skip. Keep the plain span with testid.

Now, let me also think about whether the bar should show on the login screen — no, it's outside AppLayout. ✓.

Now — "the bar provides 'Resume' (navigate to detail)." The button name "Resume." On the detail screen of the active session, Resume is a no-op. Fine.

Potential test name collision: in the close test, the bar has a "Close session" button and the detail screen (when on the detail) also has a "Close session" button. In test 7 I'm on /orders — no collision. In the dirty test I'm on the detail with the dialog "Leave with unsaved notes?" — the dialog buttons are "Cancel"/"Leave" — the detail also has a "Close session" button (disabled if closed; s-001 is open → enabled). But I'm not clicking it. `getByRole('button', { name: 'Close session' })` in the dirty test would match... I don't query it there. OK.

Wait, in test 8 (dirty), after the proceed and opening s-002, I assert the bar's text. Fine.

Now — one more regression check: the existing `SessionsListScreen.test.tsx` — does my change break it? It renders /sessions and checks the list. With my change, the bar would render above the list if there's an active session — in those tests, `state.activeSessionId` is null (fresh module state; my other file? no — separate files run in isolation). Within that file, no test sets active. So no bar. The existing assertions (getByText('Inspection 1')) still work. ✓. But wait — test file isolation: vitest by default runs each file in a separate worker/environment (threads pool with isolate). So the mock db is fresh per file. ✓. And within the sessions list test file, no active is set. ✓.

Hmm, but actually — within my test file, the tests run sequentially in the same environment. I set `state.activeSessionId` explicitly at the start of each test, and reset in afterEach. The `sessions` array mutation (close) is restored. `state.user` is set per test. ✓.

Another: my `afterEach` resets `state.activeSessionId = null` — but not the session's status; the close test handles that with try/finally. ✓.

Now — let me also double-check `userEvent` and `userEvent.setup()`: the existing tests use the default `userEvent` (no setup) — in user-event v14, the direct API `userEvent.click` works (with implicit setup). ✓ follow the style.

Now — the `within` import from `@testing-library/react`. ✓.

Now, let me reconsider the format requirement: "for each file, a level-3 heading containing only the repository-relative path, followed immediately by a single fenced block containing only that file's content."

So I output 5 files:
1. `src/features/sessions/queries.ts`
2. `src/features/sessions/ActiveSessionBar.tsx`
3. `src/features/sessions/SessionDetailScreen.tsx`
4. `src/app/AppLayout.tsx`
5. `src/features/sessions/ActiveSessionBar.test.tsx`

Wait — the naming convention here: TS files are `kebab-case.role.ts`? That's from the general codebase convention block (NestJS) — but this app uses PascalCase component files: `SessionDetailScreen.tsx`, `SessionsListScreen.tsx`, `AppLayout.tsx`. The app's actual convention (shown) wins: feature files are PascalCase, e.g., `ActiveSessionBar.tsx`. ✓.

Let me now write the final code carefully.

**queries.ts** — final:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionQuery } from '../../api/client';
import type { Page, Session } from '../../api/types';

/** Query keys live next to their queries, one factory per feature. */
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
 * The server's active session. `GET /sessions/active` is the single source of
 * truth: nothing on the client decides or remembers which session is active —
 * it only refetches after the server changes its mind (open, close, refresh).
 */
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useUpdateSessionNotes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.updateSession(id, { notes }),
    onSuccess: (updated: Session) => {
      // targeted update, not invalidation: the server already returned the row,
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
      // Closing clears the server's active session. Refetch the source of
      // truth so the bar empties instead of trusting a client-side guess.
      void qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}

/**
 * Write one changed row into every cached list page that holds it.
 * This is a pattern the app uses everywhere; copy it rather than invalidating.
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

**ActiveSessionBar.tsx** — final:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar. AppLayout mounts it on every
 * authenticated screen. It only renders when the server reports an active
 * session — `GET /sessions/active` is the source of truth, so a full page
 * refresh (or a fresh login) restores it without any client-side memory.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  const now = useNow(active !== undefined && active !== null && active.closedAt === null);

  if (!active) return null;

  const end = active.closedAt !== null ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <strong>{active.name}</strong>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="active-session-elapsed">{elapsed}</span>
      <div className="actions">
        <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
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
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeSession.mutate(active.id);
        }}
      />
    </div>
  );
}

/** Re-renders once per second while the given session is still running. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

Hmm, `active !== undefined && active !== null && active.closedAt === null` — verbose; since the type is `Session | null | undefined`, `active && active.closedAt === null` works (the `&&` narrowing). Let me write:
```ts
const now = useNow(active !== undefined && active !== null ? active.closedAt === null : false);
```
Ugh. Simpler:
```ts
const running = active !== null && active !== undefined && active.closedAt === null;
const now = useNow(running);
```
Two lines, clear. ✓.

Wait — TS: `active` from the query: `data`'s type is `Session | null` but it could be undefined before load → the type is `Session | null | undefined`. `active !== null && active !== undefined` narrows to Session. ✓.

**SessionDetailScreen.tsx** — final:

```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // The server marks the session active as soon as it is opened (unless it is
  // already closed). We never write that fact client-side — we refetch the
  // source of truth so the active-session bar converges with the server.
  useEffect(() => {
    if (session) void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
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

Wait — one issue: the early return `if (isLoading) return ...` comes after the hooks — all hooks are before the return. ✓ (both effects, useState, useBlocker are before). `useBlocker` must be called unconditionally — it is (before the early return). ✓.

Hmm, but there's an ordering nuance: the invalidation effect's `[session]` — during initial load, `session` is undefined (isLoading). After load, it's set → the effect fires → invalidates. ✓.

Another nuance: when the detail screen is on a closed session deep-linked: the session loads (closed) → the effect invalidates → the refetch of active is unchanged. ✓.

**AppLayout.tsx** — final (as above).

**ActiveSessionBar.test.tsx** — let me finalize each test, watching the queries.

Imports:
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';
```

Wait — does importing `formatElapsed` from the component file also import the component (which imports react-router etc.)? Fine in tests.

Hmm — `afterEach` — the existing tests don't import afterEach. I'll add it for hygiene.

Let me define a helper to reduce repetition:
```ts
const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function signIn() {
  state.user = OPERATOR;
}
```
Eh, just inline `state.user = OPERATOR;`.

afterEach:
```ts
afterEach(() => {
  state.user = null;
  state.activeSessionId = null;
});
```
Wait — `state.user`'s type is `{...} | null` ✓.

Test 1 (formatter) — pure.

Test 2: no bar.
```tsx
it('shows no bar while the server has no active session', async () => {
  state.user = OPERATOR;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
});
```
Hmm, is this a weak test? It asserts absence after the list loads. The active fetch could still be pending — but even when it resolves with null, no bar. To be thorough, I could also assert after a short settle... the heading appearing means the list fetch resolved; the active fetch (same timing) probably has too, but not guaranteed. Since data null → no bar either way, the assertion holds regardless of timing. Actually, that makes the test slightly vacuous (the bar would be absent even mid-fetch). But combined with test 3 (bar present when active), it's meaningful: the presence/absence tracks the server state. I'll keep it.

Test 3: refresh restore on /orders.
```tsx
it('restores the active session from the API after a page refresh', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-002';
  renderApp('/orders');
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
  expect(within(bar).getByText('paused')).toBeInTheDocument();
});
```
Wait — could "paused" appear elsewhere on /orders? Order statuses: pending/approved/rejected/cancelled. No 'paused.' ✓. And "Inspection 2" is unique to the bar on /orders. ✓.

But — `findByTestId` waits for the bar; at that point, the active data is loaded. ✓.

Test 4: open from list → active; the bar persists on the list.
```tsx
it('makes an opened session the active one, visible on every screen', async () => {
  state.user = OPERATOR;
  renderApp('/sessions');
  await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  expect(within(bar).getByText('open')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
});
```
s-001 status: i=0 → 'open.' ✓.

Note: `getByRole('link', { name: 'Sessions' })` — the nav link. At the moment of the click (on the detail screen), the links present: nav "Sessions," "Orders." ✓ unique.

Test 5: replacement.
```tsx
it('replaces the active session when another one is opened', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await waitFor(() =>
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
  );
  expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
});
```
✓.

Test 6: resume.
```tsx
it('resumes the active session from the bar', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-004';
  renderApp('/orders');
  const bar = await screen.findByTestId('active-session-bar');
  await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument(),
  );
});
```
✓.

Test 7: close from the bar.
```tsx
it('closes the active session from the bar and empties it', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-005';
  const target = sessions.find((s) => s.id === 's-005');
  if (!target) throw new Error('missing mock session');
  const snapshot = { ...target };

  try {
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const row = await screen.findByRole('row', { name: /Inspection 5/ });
    expect(within(row).getByText('closed')).toBeInTheDocument();
  } finally {
    Object.assign(target, snapshot);
  }
});
```
Note: `findByRole('row', { name: /Inspection 5/ })` — the row loads with the list (fresh fetch). ✓. `within(row).getByText('closed')` — the badge. ✓.

Hmm, wait — after the bar empties, clicking the nav "Sessions" — the bar is gone; the nav is still there. ✓.

But — subtle: the dialog's confirm button is named "Close session" and the bar's trigger is also named "Close session." After clicking the trigger, both exist. I scope with `within(dialog)`. ✓. Before the dialog opens, `within(bar).getByRole('button', {name: 'Close session'})` — only the bar's. ✓.

Also: is the ConfirmDialog within the bar's container? Yes — I render the ConfirmDialog inside the bar's div. `findByRole('dialog')` is global anyway. ✓.

Test 8: dirty guard (the big one). Let me re-check each step's selectors.

```tsx
it('asks before opening another session while the current one has unsaved notes', async () => {
  state.user = OPERATOR;
  renderApp('/sessions/s-001');

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  const bar = await screen.findByTestId('active-session-bar');
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.');

  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
  expect(within(dialog).getByText('Your changes to the notes have not been saved.')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
  const again = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
  await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await waitFor(() =>
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
  );
  expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
});
```

Concerns:
- `getByLabelText('Notes')`: the label wraps "Notes" + a textarea. ✓.
- After cancel: the dialog closes. Then I re-click the nav link. But — wait: after the blocker's reset, is the blocker still `dirty`? Yes, the notes are still unsaved. The second click → blocked → the dialog again. ✓.
- `findByRole('dialog', { name: 'Leave with unsaved notes?' })` for `again` — the same dialog element reopens (the ConfirmDialog renders conditionally on open). After cancel, `open` is false → unmounts; after the second block, it remounts. `findByRole` waits. ✓.
- After "Leave": proceed → navigate to /sessions → the list. ✓.
- Then click "Inspection 2" → detail; the bar updates. ✓.

One more: while the blocker dialog is open, is the nav link still clickable? Clicking it re-triggers the navigation attempt → the blocker is already blocked... actually, the blocker's state machine: after reset, state is 'unblocked'; a new navigation attempt → 'blocked.' ✓.

Another subtlety — `userEvent.click` on the nav link while the dialog is open: the dialog is a plain div (not a portal, no overlay that blocks pointer events — the ConfirmDialog has no backdrop in the DOM; it's just a positioned div). The nav link is clickable. In the existing app, the blocker dialog has no backdrop either. ✓.

Test 9: ticking (fake timers).

```tsx
it('ticks the elapsed time once per second', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  try {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    for (let i = 0; i < 50 && !screen.queryByTestId('active-session-bar'); i++) {
      await vi.advanceTimersByTimeAsync(100);
    }
    const bar = screen.getByTestId('active-session-bar');
    const elapsed = within(bar).getByTestId('active-session-elapsed');
    const first = elapsed.textContent;
    expect(first).toMatch(/^\d+h \d+m \d+s$/);

    await vi.advanceTimersByTimeAsync(2500);
    expect(elapsed.textContent).not.toBe(first);
  } finally {
    vi.useRealTimers();
  }
});
```

Concern: during the setup loop, the interval (1s) fires ~5 times — each `setNow` triggers a re-render — fine.

Concern: `elapsed.textContent` after the advance — React must process the state update. `advanceTimersByTimeAsync` is async; React updates via MessageChannel (real, not faked) — the port message handler runs as a task on the real event loop; the await in `advanceTimersByTimeAsync` yields, allowing those tasks to run. Should be flushed by the time it returns. I think so. If flaky, I could add a small `await vi.advanceTimersByTimeAsync(0)` extra... let me keep it; it's a standard pattern.

Hmm, actually — one more risk: does `renderApp` itself (the render call) use `flushSync`/concurrent? React 18's `createRoot().render` is concurrent; the initial render is scheduled... actually, the initial render from `createRoot.render` happens synchronously? In React 18, `root.render` is asynchronous (scheduled). With real MessageChannel, the scheduling works even under partial fake timers. The loop's awaits give it time. ✓.

Also, `vi.advanceTimersByTimeAsync` exists in vitest 2.1 — yes (added in vitest 0.34).

But wait — is `advanceTimersByTimeAsync` a real vitest API? Jest has `jest.advanceTimersByTimeAsync` (27.6+). Vitest: I recall `vi.advanceTimersByTimeAsync` — yes, vitest has it (documented). ✓.

Test 10: logout.
```tsx
it('logout clears the bar and a re-login starts without one', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-001';
  renderApp('/sessions');
  await screen.findByTestId('active-session-bar');

  await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
  await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Name'), 'Ada');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
});
```
Flow: logout → `api.logout` (the mock clears active) → user null → /login. The login screen shows. The bar is absent (AppLayout unmounted). Then type name, submit → `login` → user set → RequireAuth → /sessions (from state) → list loads → the bar fetches active → null (cleared) → no bar.

Wait — the post-login navigation: LoginScreen navigates to `location.state?.from?.pathname ?? '/sessions'` — the from is /sessions. ✓.

Hmm, one: after re-login, the `useActiveSession` query — the AuthProvider's `queryClient.clear()` on logout cleared the cache; the new observer fetches fresh. ✓.

Also `getByLabelText('Name')` — LoginScreen's `<label>Name<input/></label>`. ✓.

Now — potential problem: `findByRole('button', { name: 'Sign in' })` — after logout. LoginScreen's submit Button has variant primary, text "Sign in." ✓.

Now, let me also consider: do I need a test for "deep-linking directly to the detail URL"? That's a listed non-regression. My test 8 renders `/sessions/s-001` directly (a deep link) and works. Plus the refresh test. I think it's covered implicitly. I could add an explicit one: a fresh render at a detail path shows the bar for that session (the server set it active via GET). Actually, test 8's start does that (renders a detail path directly, and the bar appears). ✓ enough.

Now — one more thing to double-check: the mock's `GET /sessions/:id` sets active even for closed sessions? No: `s.status === 'closed' ? state.activeSessionId : s.id`. ✓.

Now, let me reconsider the requirements: "opening a session from the list makes it the active session; the bar shows the main fields (name, status, elapsed time ticking) on all screens." — "on all screens" — the bar is in AppLayout → all authenticated screens including orders and detail. ✓ tested on orders, sessions list, and detail.

Now, a potential issue with the bar on the detail screen: the bar shows the session name + status; the detail also shows the same — duplicate text; my tests scope with `within`. ✓.

Also — the bar's "Resume" when already on that detail: a no-op navigation; harmless.

Let me now re-check the TypeScript strictness of the files:

- `ActiveSessionBar.tsx`:
  - `const running = active !== null && active !== undefined && active.closedAt === null;` — hmm, `data`'s type: `Session | null | undefined`? react-query's `data` is `TData | undefined`, and TData = `Session | null` (the inferred return of the queryFn). So `active: Session | null | undefined`. ✓.
  - `useNow(running)` ✓.
  - `const end = active.closedAt !== null ? new Date(active.closedAt).getTime() : now;` — after the `if (!active) return null;` guard, `active: Session`. ✓.
  - Button props: `onClick={() => navigate(...)}` ✓.
  - `closeSession.mutate(active.id)` ✓.
  - `formatElapsed` is exported, pure. ✓.
  - No unused imports: useEffect, useState, useNavigate, Badge, Button, ConfirmDialog, useActiveSession, useCloseSession — all used. ✓.

- `queries.ts`: all imports used. `sessionKeys.active()` used in useActiveSession and in the close mutation. ✓.

- `SessionDetailScreen.tsx`: imports `useQueryClient` — used; `sessionKeys` — used. ✓.

- `AppLayout.tsx`: import ActiveSessionBar — used. ✓.

- Test file: imports — `screen, waitFor, within`, `userEvent`, `afterEach, describe, expect, it, vi`, `sessions, state`, `renderApp`, `formatElapsed`. All used? `vi` used in the tick test. `sessions` used in the close test. `waitFor` used. `within` used. ✓.

Now — one thing: the existing test file's style doesn't import `afterEach`; I add it. Fine.

Also, the test file name: `ActiveSessionBar.test.tsx` matches the `SessionsListScreen.test.tsx` pattern (colocated). ✓.

Now — let me reconsider the tick test's `toFake` list once more. Does vitest's `useFakeTimers` config accept `toFake` as an array of strings? Yes: `vi.useFakeTimers({ toFake: [...] })`. Values must be valid timer names: 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date.' ✓.

One risk: faking `Date` — does MSW or react-query internally use Date for staleTime calculations? staleTime is a numeric ms; the GC uses `Date.now()` for cache timestamps — faking is fine (consistent clock).

Another risk: `renderApp` → AuthProvider's `api.me()` — fetch intercepted by MSW node. Under partial fake timers (microtasks real), the promise resolves normally. The loop advances fake time and awaits (real microtasks flush). ✓.

Now, hmm, let me actually reconsider: does `advanceTimersByTimeAsync` flush the real microtasks/promises? Its implementation: it ticks the clock in small increments, awaiting between them (each await yields to the event loop, letting pending microtasks and also pending macrotasks like the MessageChannel callback run). Yes.

Now, the `50 × 100ms` loop — worst case 5s of fake time. Fine.

But — one more: during that loop, the interval callback's `setNow` triggers React re-renders — each via a real MessageChannel task — processed during the awaits. ✓.

And the final `advanceTimersByTimeAsync(2500)` → 2-3 interval fires → state updates → re-render → the text changes. Then `expect(elapsed.textContent).not.toBe(first)`. If React hasn't processed by the time the call returns... the last tick is at 2000ms or 2500ms? The interval fires at 1000, 2000, (2500? the interval is every 1000 from mount: mount+1000, +2000, +3000 — with a 2500 advance → fires at 1000 and 2000). The state update from the 2000ms tick is scheduled; `advanceTimersByTimeAsync` returns after running the 2000ms timer callback (which calls setNow → schedules a React update via MessageChannel). The MessageChannel task runs when the event loop turns — during the final await of `advanceTimersByTimeAsync`? There's an await after the last timer fire (the implementation awaits between ticks). I believe by the time the function resolves, the microtask queue is flushed and the macrotask (the channel message) — hmm, a macrotask needs an event loop turn; `await Promise.resolve()` only flushes microtasks. But vitest's implementation does `await this._fakeTimers.tickAsync(...)` which internally awaits real timers (`setTimeout 0`?) between steps — jest's `advanceTimersByTimeAsync` "waits for async callbacks." I trust it's adequate. If it's flaky, I can add a small real delay `await new Promise(r => setTimeout(r, 0))` — but the `setTimeout` is faked! Use `await Promise.resolve()` a few times? That's microtasks only.

To be safe, after the 2500 advance, I'll do a small settle loop:
```ts
for (let i = 0; i < 10; i++) {
  await vi.advanceTimersByTimeAsync(0);
  if (elapsed.textContent !== first) break;
}
expect(elapsed.textContent).not.toBe(first);
```
`advanceTimersByTimeAsync(0)` — advances nothing but awaits (flushing). The extra 0-advances give the event loop turns. This is robust. Actually, `advanceTimersByTimeAsync(0)` might still do its internal await. Let me include this settle loop — cheap and safe.

Hmm, wait, actually — will React's MessageChannel callback run between `advanceTimersByTimeAsync(0)` calls? Each call is `async` — `await` inside → microtask checkpoint; the macrotask (the channel message) needs an event loop turn. When does the event loop turn? When the current macrotask ends and the promise chain has a real (non-faked) async gap. Since `setTimeout` is faked, I can't use `setTimeout(0)`. But `advanceTimersByTimeAsync`'s internal implementation — jest's uses `this._fakeTimers.tickAsync` which does `await` on a real promise per step? I recall vitest's `advanceTimersByTimeAsync` is implemented as `await clock.tickAsync(ms)` — sinon's `tickAsync` "awaits a real timer (setTimeout 0) between steps"? In @sinonjs/fake-timers, `tickAsync` internally uses `delay(timeout)` where `timeout` is... let me recall:
```js
function tickAsync(tickValue) {
  ...
  return tick(tickValue, true);
}
function tick(tickValue, isAsync) {
  ...
  while (loop) {
    ...
    if (isAsync) {
      // yield to the event loop
      ...await new Promise(resolve => originalSetTimeout(resolve, 0))? 
    }
  }
}
```
I believe sinon's `tickAsync` awaits a real `setTimeout(0)` between timer firings (using the original, unfaked setTimeout saved before faking). If vitest fakes setTimeout via sinon, sinon saves the original. So yes — event loop turns happen. ✓. My settle loop is a belt-and-suspenders anyway.

OK. Now — one more design double-check: **should the invalidation in the detail screen happen, or should the bar's query be `refetchOnMount` + a `refetchInterval`?** No — event-driven invalidation is cleaner and matches the app's style.

**What if the active session's row changes while the bar is showing (e.g., someone saves notes)?** The bar only shows name/status/elapsed — notes aren't shown. Status could change only via close (handled). Fine.

**The "resume" label**: the task says the bar provides "Resume" — I'll label the button "Resume." ✓.

Now, let me also reconsider the requirement: "close session (call the existing close endpoint, with confirmation; on success the bar empties)." — my close uses `useCloseSession` (which calls `api.closeSession`) ✓, ConfirmDialog ✓, on success → invalidate → refetch → null → bar unmounts ("empties") ✓.

Now — a potential wrinkle: after closing from the bar while on /orders, the `useCloseSession.onSuccess` does `qc.setQueryData(sessionKeys.detail('s-005'), updated)` — creates a detail cache entry for s-005 with the closed session. If the user later opens s-005's detail, the cache is fresh (closed). ✓ correct.

Now — let me think about whether `invalidateQueries({ queryKey: sessionKeys.active() })` refetches if the bar is the only observer. `invalidateQueries` triggers a refetch of active (observed) queries whose key matches. The bar's query key `['sessions','active']` — the filter `{ queryKey: ['sessions', 'active'] }` is an exact-match array → matches. ✓.

Now — edge: two components using `useActiveSession`? Only the bar. Fine.

Now, let me think about the existing tests once more — `SessionsListScreen.test.tsx` test 2: filter by 'closed' → the list shows only closed sessions. My change doesn't touch that. ✓.

Now — one more possible regression: the `AppLayout` now renders `ActiveSessionBar`, which calls `useActiveSession` — a network request `GET /api/sessions/active` on every authenticated screen. The MSW setup uses `onUnhandledRequest: 'error'` in tests — the handler exists. ✓. In dev, the handler exists. ✓.

Also — the request happens even when `state.activeSessionId` is null → returns `null` → `HttpResponse.json(null)` — body `null` — `res.json()` → null → returns null. The client's `request<T>` does `return (await res.json()) as T;` → null. ✓. 200 OK. ✓.

Wait — `HttpResponse.json(null)` — is that valid in MSW 2? `HttpResponse.json(body)` with null — yes, it serializes to `null` with content-type application/json. `res.ok` is true (200). ✓.

Now — the type of `api.getActiveSession()`: `request<Session | null>('/sessions/active')` → `Promise<Session | null>`. ✓.

Now — one more: the `useActiveSession` query's `staleTime` default 30s — after the close invalidation, the refetch happens. ✓.

Let me now write out the tick test's regex: `expect(first).toMatch(/^\d+h \d+m \d+s$/)` — s-001's startedAt: `Date.UTC(2024, 3, 1, 8, 0)` = 2024-04-01T08:00Z. The fake `Date.now()` starts at the real current time (say 2025) → elapsed ≈ 300+ days ≈ 7000+ hours → format `7000h 12m 34s.` Matches. ✓.

Now — the `formatElapsed` negative guard: `Math.max(0, ...)` → `0s.` ✓.

Now, also consider: the `useNow` initial `Date.now()` — under fake timers, the fake now = real now at `useFakeTimers` call time. The interval advances the fake now by 1s each tick. The elapsed text updates deterministically. ✓.

Now, let me reconsider the file count: 5 files. Is anything else needed? `vite.config`? No. `index.html`? No. `package.json`? No new dependencies (all used packages exist: react-query, react-router-dom, testing-library, vitest, msw). ✓.

Wait — `vi.advanceTimersByTimeAsync` — it's part of vitest's `vi` API, no import needed beyond `vi` from 'vitest.' ✓.

Now, hmm, one more consideration about the `useNow` hook and StrictMode: in dev StrictMode, the effect runs twice → two intervals? No — the cleanup runs in between (mount → effect → cleanup → effect). Only one live interval. ✓. In tests, StrictMode isn't used (renderApp doesn't wrap in StrictMode — correct, render.tsx has no StrictMode). ✓.

Now, let me reconsider: **the bar's `ConfirmDialog`** — the title "Close this session?" is the same as the detail's. In the close test, only the bar's dialog exists (I'm on /orders). ✓. In the dirty test, the dialogs are "Leave with unsaved notes?" (blocker) — no close dialog. ✓.

But wait — in the dirty test, after I proceed and open s-002, I don't close. ✓.

Now — one more scenario to sanity check: **the bar's close while on the detail screen of that session.** Not explicitly tested, but the mutation's onSuccess handles it + the detail's effect. Should I add a test? The suite is already substantial. The requirement says the bar provides close; I test it from /orders. The close-from-detail already existed (untested in the scaffold — actually, no detail tests at all in the scaffold!). Hmm — the scaffold has no SessionDetailScreen test. The task says "deliver the edits as a consistent diff + tests in the app's style" — I'll focus tests on the new feature + the enumerated non-regressions. My dirty-guard test exercises the detail's dirty flag + the blocker (non-regression) ✓, and the detail editing (typing) ✓.

Now — let me re-check the `getByLabelText('Notes')` once more. The label:
```jsx
<label>
  Notes
  <textarea value={notes} onChange={...} />
</label>
```
The accessible name computation: the label's text content = "Notes" (whitespace normalized). `getByLabelText('Notes')` → the textarea. ✓.

And `getByLabelText('Name')` in the login screen: `<label>Name<input .../></label>` → the input's name "Name." ✓.

Now — `userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.')` — types into the textarea. ✓. s-001's initial notes = 'Awaiting parts.' (i=0 → i%4===0). After typing → 'Awaiting parts.Waiting on parts.' → dirty. ✓.

Now — a potential flake: after `userEvent.click(nav 'Sessions')` while dirty, the blocker dialog appears — `findByRole('dialog')`. The blocker state update is synchronous with the navigation attempt. ✓.

Now, let me also confirm: the nav "Sessions" link — `getByRole('link', { name: 'Sessions' })`. On the detail screen, the nav has "Sessions" and "Orders" links. On the list screen, the nav has the same + row links "Inspection N." So "Sessions" is unique. ✓.

Now — the `waitFor` for heading "Sessions" after the proceed: the list fetch (MSW) → the h1 appears. ✓.

Now — I'm thinking about test 4's step: after clicking the nav "Sessions" from the detail (not dirty), the list appears; the bar still shows Inspection 1 — the active cache is fresh (refetched a moment ago, staleTime 30s) → no refetch → immediate. `expect(within(screen.getByTestId(...)).getByText('Inspection 1'))` — immediate, no waitFor needed. But to be safe against a potential GC... no, fine.

Now — let me also reconsider whether the `renderApp` in the tick test with fake timers + the `for` loop: the first iteration advances 100ms — but the fetch is in flight (microtasks). `advanceTimersByTimeAsync(100)` — internally, sinon's tickAsync: no fake timers to fire within 100ms (the interval is 1000ms; AuthProvider's `me` fetch is promise-based). It awaits (event loop turns) → the fetch promise progresses. A few iterations should be enough. 50×100ms is plenty. ✓.

Now — another edge: `screen.queryByTestId('active-session-bar')` — the bar renders only when active data is non-null. The active fetch returns s-001. ✓.

Now — the potential issue: **react-query's default `refetchOnWindowFocus: false`** (set in makeQueryClient) ✓ no stray refetches.

**The default `refetchOnMount`** — on remount (new renderApp), the cache is fresh (new QueryClient) → fetches. ✓.

Within a single renderApp, navigating between routes doesn't remount the bar (same observer) → no refetch on navigation (staleTime). The invalidations drive updates. ✓.

Now, let me also double-check that the `AppLayout` import path is correct: `src/app/AppLayout.tsx` → `../features/sessions/ActiveSessionBar` ✓.

The `ActiveSessionBar` imports: `../../components/ui/Badge` etc. ✓ (the file is in `src/features/sessions/`).

The test imports: `../../mocks/db`, `../../test/render` ✓ (matches the existing test file's relative paths).

Now — the `describe` block name: `describe('ActiveSessionBar', () => {...})`.

Let me also add a comment header to the test file? The existing test file has no comments. Keep it clean.

Now — the "ASSUMPTION" comment: is there anything truly unresolved? The main ambiguity: "elapsed time" for paused sessions (no pause timestamp in the data model). My choice: measure from `startedAt` regardless of paused (freeze when closed). Should I mark it? The instructions: "if a symbol you need is truly absent... mark it with a single // ASSUMPTION comment at the point it matters." The `pausedAt` field is absent from the data model, and I'm making a defensible reading (elapsed = now - startedAt). I'll add a short comment at the point in the bar where I compute elapsed:
```ts
// ASSUMPTION: the data model has no pause timestamps, so elapsed time is
// measured from startedAt for open and paused sessions alike.
```
That's honest and at the point it matters.

Also, "the bar becomes empty" → I interpret it as the bar unmounting when there's no active session. That's a design choice, not an absent symbol; no assumption comment needed, but I'll note it in the component doc.

Now, let me also reconsider: **should the bar's active query be `enabled` on login only?** The bar is only rendered when authenticated. ✓.

One more: **the requirement "opening a session from the list makes it the active session"** — what if the operator opens the same session again (re-click)? The GET sets active to the same. ✓.

What if the operator opens a closed session from the list? The server keeps the previous active. The bar unchanged. My tests don't cover this; is it worth it? It's a subtle server behavior; a test would lock in "opening a closed session does not steal active." Hmm — the spec doesn't mention it. The mock encodes it. I'll skip the extra test (the discipline: do exactly what the task asks). Actually — it's a defensible behavioral edge of "only one active session at a time; opening another replaces it" — one could argue opening a closed session should replace... but the mock (the "real server") says no. The spec is silent. I'll skip it; the source-of-truth design handles whatever the server says.

Now — let me also reconsider the **`invalidateQueries` on every `session` change** in the detail: when I save notes, the session updates → the invalidation → a refetch of the active (unnecessary but harmless, ~1 extra request per save). Acceptable.

Alternative: invalidate only on `id` change (opening a new session), not on data change:
```ts
useEffect(() => {
  if (session) void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
}, [session, queryClient]);
```
vs depending on `[id]`:
```ts
useEffect(() => {
  void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
}, [id, queryClient]);
```
The `[id]` version fires once per session opened (including on mount) — cleaner (no extra refetch on save/close). But — on close from the detail, the active is cleared server-side; the mutation's onSuccess already invalidates. So the `[id]` version suffices and is tighter. But — is there a case where the detail is open and the active changes without an id change or a close? No. I'll use `[id]`... wait, but on mount, the effect fires before/after the session fetch — the invalidation triggers an active refetch at that moment; the detail's GET (which sets active server-side) may still be in flight → the refetch could return the stale active; then... nothing re-triggers! Race:
- t0: detail mount → effect invalidates active (id) → active refetch #1 starts.
- t1: active fetch #1 resolves (server active is still old, since the detail GET hasn't completed).
- t2: detail GET completes → server active = s-001 → session data set.
- With `[id]` deps: no more invalidation → the bar shows the old active. Bad.

With `[session]` deps: the session data set at t2 → the effect re-fires → invalidation → refetch #2 → correct. So the `[session]` version handles the race. The extra refetch on save is a small cost for correctness. I'll keep `[session]`.

Hmm, alternatively, depend on `[session?.id, session]`... no, `[session]` is correct.

Actually — even better: depend on the session object but that's what I have. Keep.

Now — the `useSession` refetch (e.g., a stale refetch on remount) → the session object is new → the invalidation → the active refetch. Fine.

Now — one more subtle point: the detail's effect fires when `session` is set — including when the data comes from the cache (immediate, no network). The mock's GET-side effect (setting active) only happens on actual network GETs. If the detail is served from the cache (e.g., back navigation), the server's active is already that session (from the earlier GET) — the refetch is consistent. ✓.

Now — let me write out the final test file in full, carefully:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

afterEach(() => {
  state.user = null;
  state.activeSessionId = null;
});

describe('ActiveSessionBar', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(5_000)).toBe('5s');
    expect(formatElapsed(65_000)).toBe('1m 5s');
    expect(formatElapsed(3_665_000)).toBe('1h 1m 5s');
    expect(formatElapsed(-1)).toBe('0s');
  });

  it('shows no bar while the server has no active session', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('restores the active session from the API after a page refresh', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    // A fresh app instance, as a full page reload produces; only the server
    // still remembers which session is active.
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    expect(within(bar).getByText('paused')).toBeInTheDocument();
  });

  it('makes an opened session the active one, and keeps showing it elsewhere', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
  });

  it('closes the active session from the bar and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-005';
    const target = sessions.find((s) => s.id === 's-005');
    if (!target) throw new Error('mock data must contain s-005');
    const snapshot = { ...target };

    try {
      renderApp('/orders');
      const bar = await screen.findByTestId('active-session-bar');
      await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

      const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

      await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
      const row = await screen.findByRole('row', { name: /Inspection 5/ });
      expect(within(row).getByText('closed')).toBeInTheDocument();
    } finally {
      Object.assign(target, snapshot);
    }
  });

  it('asks before opening another session while the current one has unsaved notes', async () => {
    state.user = OPERATOR;
    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    expect(within(dialog).getByText('Your changes to the notes have not been saved.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const again = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('ticking the elapsed time once per second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      state.user = OPERATOR;
      state.activeSessionId = 's-001';
      renderApp('/orders');

      for (let i = 0; i < 50 && !screen.queryByTestId('active-session-bar'); i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      const bar = screen.getByTestId('active-session-bar');
      const elapsed = within(bar).getByTestId('active-session-elapsed');
      const first = elapsed.textContent;
      expect(first).toMatch(/^\d+h \d+m \d+s$/);

      await vi.advanceTimersByTimeAsync(2500);
      for (let i = 0; i < 10 && elapsed.textContent === first; i++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(elapsed.textContent).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logout clears the bar and a re-login starts without one', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    await screen.findByTestId('active-session-bar');

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });
});
```

Wait — the "replaces" test has an issue: I click the "Inspection 2" row link — but wait, at that point I'm on /sessions (the list). The row link "Inspection 2" ✓. After the click, the detail s-002. The bar shows Inspection 2. But the h1 "Inspection 2" is also present — I scope with within(bar). ✓.

Another check — "ticking" test: `const first = elapsed.textContent;` — the type is `string | null`. `expect(first).toMatch(...)` — if null, toMatch fails (fine, it'd be a genuine failure). `elapsed.textContent === first` comparison is fine.

Hmm — the settle loop `for (let i = 0; i < 10 && elapsed.textContent === first; i++)` — if the text never changes, it exits after 10 and the final expect fails. Good (a real failure, not a hang).

But actually — wait. Is there a risk that `first` and the new text are equal because the seconds digit... no, the 2.5s advance changes the seconds. Unless the interval never fired (a bug) → the test fails. Correct behavior.

One more consideration for the tick test: `renderApp('/orders')` — the orders list also loads (fetch). Fine.

Now — the logout test: `userEvent.click` on "Log out" → the logout is async: `api.logout()` → then `setUser(null)` → re-render → /login. `findByRole('button', {name: 'Sign in'})` waits. ✓. Then type name → click Sign in → `login` → user → /sessions. `waitFor` heading. ✓. Then the bar's absence: the active query has refetched (or is fetching) — data null → no bar either way. To make it meaningful, I want the fetch to have resolved... the heading appearing is independent of the active fetch. The bar's absence assertion: even if the active fetch is pending, no bar (renders nothing while loading). So the assertion could pass trivially. Hmm. To strengthen: wait for a signal that the active fetch settled. I could assert the bar's absence after opening... no. Alternative: assert the absence of the bar, then click "Inspection 1" → the bar appears with s-001 → proves the bar works post-login AND that the server's active was null before the open (if a stale cache had s-001, the bar would have shown s-001 before the click... but that's the same session — a bad test!). Use s-003: set the initial active to s-003? Let me restructure:

```ts
it('logout clears the bar and a re-login starts without one', async () => {
  state.user = OPERATOR;
  state.activeSessionId = 's-003';
  renderApp('/sessions');
  await screen.findByTestId('active-session-bar');
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 3')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Log out' });
  await screen.findByRole('button', { name: 'Sign in' });
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Name'), 'Ada');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

  // the server cleared the active session on logout: until something is
  // opened, the bar stays empty
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
  await screen.findByTestId('active-session-bar');
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
});
```
The final part proves the bar is functional post-login. The "stays empty" assertion is still slightly timing-dependent, but combined with the follow-up open, the test is coherent. Good.

Hmm, that makes the test long, but it's a meaningful end-to-end of the logout requirement as it relates to the bar. Keep.

Now — `s-003`: i=2 → status closed! Wait: `(['open','paused','closed'] as const)[i % 3]` → i=2 → 'closed.' A closed session as the initial active? The mock's `GET /sessions/active` returns the session regardless of status (find by id) — it'd return a closed session. The bar would show it (closedAt set → elapsed frozen). That's a weird initial state (the server should never have a closed active session). For realism, I'll pick an open session: s-001 (open, i=0) or s-004 (open, i=4? i%3=1 → paused). i%3==0 → open: s-001 (i=0), s-004 (i=3), s-007 (i=6). I'll use s-001 for the logout test, and the follow-up open is... s-001 is the same as the initial active — the "stays empty" before the open would be the differentiator: initial active s-001 → logout → re-login → bar should be empty (not s-001 from a stale cache) → then open s-002 → bar shows s-002. Let me use s-001 initial, and open s-002 at the end. ✓:

```ts
  state.activeSessionId = 's-001';
  ...
  expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  ... logout/login ...
  expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
  await screen.findByTestId('active-session-bar');
  expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument();
```
✓.

Now — one more potential pitfall in the "asks before opening another" test: after `userEvent.type` into the textarea, the `dirty` becomes true. Then click the nav "Sessions." The `useBlocker` — the navigation is attempted; the blocker becomes 'blocked'; the dialog renders. But — important: `useBlocker` requires a data router (createMemoryRouter ✓, createBrowserRouter ✓).

Another pitfall: `userEvent.click` on the link — the link's default navigation via React Router (not a real href — react-router's Link uses a pushState interception). Under jsdom, fine.

Now — after the "Leave" proceed: the blocker proceeds → the navigation completes → the list renders. The detail unmounts. ✓.

Now — let me reconsider the "replaces" test and the "asks" test: both end by asserting the bar shows Inspection 2 and not 1. Good.

Now — let me re-check the `findByRole('row', { name: /Inspection 5/ })` in the close test: the row's accessible name — the `<tr>` with `<td>`s: the name is computed from the contents: "Inspection 5 Grace closed." The regex /Inspection 5/ matches. But — does `getByRole('row', { name })` work on `<tr>`? testing-library computes the accessible name for rows from the cell contents (table rows have nameFrom content). Yes, this is a known working pattern. ✓.

And `within(row).getByText('closed')` — the badge's span text "closed." ✓.

Now — one more: in the close test, after the bar empties and I navigate to /sessions — the list fetch returns page 1 (s-001..s-010). s-005's row exists. ✓.

Now — the `snapshot`/`Object.assign` restore: `Object.assign(target, snapshot)` — restores notes/status/closedAt/startedAt. ✓. But `sessions` is an exported const array; the object identity is preserved. ✓.

Now — let me think about the **test execution order** within the file: vitest runs in declaration order. Each test sets state explicitly + the afterEach resets. The `sessions` mutation is only in the close test (restored). ✓.

Now — a potential issue: `renderApp` in multiple tests without unmount — @testing-library's auto-cleanup (vitest globals + the setup? auto-cleanup requires globals true, and `@testing-library/react`'s auto-cleanup runs via afterEach registration when globals are available). The existing tests rely on it (they render per test). With `globals: true` in the vite config, RTL's auto-cleanup works. ✓.

Now — the `AuthProvider` in each render: `api.me()` — with `state.user` set. In the logout test, after logout `state.user = null` (the mock's logout handler sets it). The AuthProvider's `logout` sets the local user to null. ✓.

Now — the **`onUnhandledRequest: 'error'`** in the test setup — every fetch must match a handler. My flows: me, active, sessions list, session detail, close, logout, login, orders list. All have handlers. ✓. No stray requests. (react-query's retries are off ✓.)

Now — let me also verify the **`GET /api/sessions/active` handler's** location: `http.get('/api/sessions/active', ...)` — declared before `http.get('/api/sessions')` and `'/api/sessions/:id'` in the array — MSW matches in order; `/api/sessions/active` is more specific and listed first. ✓ (and it's in the existing file anyway).

Now — the **`client.ts`** `getActiveSession` — exists. ✓.

Everything seems consistent. Let me now also re-check the **AppLayout** placement: I put `<ActiveSessionBar />` between the header and main. The doc comment says "belongs here, above <Outlet />." ✓.

Now — one more thought: **should the bar be shown while the active query is loading (on refresh)?** It renders nothing until data (even if null). On a refresh with an active session, there's a brief absence then it appears. Acceptable (a loading skeleton isn't in the app's style — the screens show "Loading…"). Fine.

Now — let me reconsider the **naming `ActiveSessionBar`** vs the app's style: components are named `XxxScreen`, `AppLayout`, `RequireAuth`, `Badge`, etc. `ActiveSessionBar` fits (PascalCase, descriptive). File `ActiveSessionBar.tsx` fits `SessionsListScreen.tsx`-style PascalCase. ✓.

Now — **the discipline**: "don't create files the task doesn't ask for" — the task asks for the feature + tests. My 5 files: 2 new (the component + its tests) + 3 edits. All necessary. ✓.

Let me reconsider whether to include `src/features/sessions/SessionDetailScreen.tsx` — yes, the invalidation effect is there. And `AppLayout.tsx` — the bar mount. And `queries.ts` — the hook + the close mutation. ✓.

Now, let me finalize the code text for each file, ensuring no syntax errors.

**File 1: src/features/sessions/queries.ts**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionQuery } from '../../api/client';
import type { Page, Session } from '../../api/types';

/** Query keys live next to their queries, one factory per feature. */
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
 * The server's active session. `GET /sessions/active` is the single source of
 * truth: the client never decides or remembers which session is active, it
 * only refetches after the server has changed its mind (open, close, refresh).
 */
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useUpdateSessionNotes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.updateSession(id, { notes }),
    onSuccess: (updated: Session) => {
      // targeted update, not invalidation: the server already returned the row,
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
      // Closing clears the server's active session. Refetch the source of
      // truth so the bar empties instead of trusting a client-side guess.
      void qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}

/**
 * Write one changed row into every cached list page that holds it.
 * This is a pattern the app uses everywhere; copy it rather than invalidating.
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

**File 2: src/features/sessions/ActiveSessionBar.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar. AppLayout mounts it on every
 * authenticated screen. It renders only while the server reports an active
 * session — `GET /sessions/active` is the source of truth, so a page refresh
 * (or a fresh login) restores it without any client-side memory, and closing
 * the session empties the bar.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  // ASSUMPTION: the data model has no pause timestamps, so elapsed time is
  // measured from startedAt for open and paused sessions alike, and frozen at
  // closedAt once the session is closed.
  const running = active !== null && active !== undefined && active.closedAt === null;
  const now = useNow(running);

  if (!active) return null;

  const end = active.closedAt !== null ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <strong>{active.name}</strong>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="active-session-elapsed">{elapsed}</span>
      <div className="actions">
        <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
        <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
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
          closeSession.mutate(active.id);
        }}
      />
    </div>
  );
}

/** Re-renders the caller once per second while `running` is true. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

**File 3: src/features/sessions/SessionDetailScreen.tsx** — as drafted above.

**File 4: src/app/AppLayout.tsx** — as drafted.

**File 5: src/features/sessions/ActiveSessionBar.test.tsx** — as drafted, with the logout test adjusted.

Let me re-scan the tests for selector collisions once more:

- "makes an opened session..." test: after clicking the Inspection 1 row, on the detail. `screen.getByRole('heading', { name: 'Inspection 1' })` — the h1. But the bar's `<strong>Inspection 1</strong>` — not a heading. ✓. `within(bar).getByText('open')` — the badge. The detail also has a "open" badge! But I scope within(bar). ✓.

- The "resumes" test: after the click, the detail s-004. `getByRole('heading', { name: 'Inspection 4' })` ✓ (the bar's strong isn't a heading).

- The dirty test: `getByRole('heading', { name: 'Sessions' })` after the proceed — the list's h1. ✓.

Now — one thing I want to double-check: **`userEvent.click` on the nav "Sessions" link while the blocker is active (after cancel, second click)**: the first click triggered the block; after `blocker.reset()` (cancel), the state is 'unblocked.' The second click → a new navigation attempt → 'blocked' → the dialog. ✓.

And — after the proceed: `blocker.proceed()` → the navigation completes. ✓.

Now — **the `ConfirmDialog` for the blocker**: `onCancel={() => blocker.reset?.()}` — reset returns to unblocked without navigating. ✓.

Now — a potential timing issue in the dirty test: `userEvent.type` — types characters; after each keystroke, a re-render. Fine.

Now — **does the `useBlocker` dialog appear with a `role="dialog"` and `aria-label="Leave with unsaved notes?"`?** The ConfirmDialog: `<div role="dialog" aria-modal="true" aria-label={title}>` ✓.

Now — the **`getByText('Your changes to the notes have not been saved.')`** — the body text. ✓ exact match (the body is that string).

Now — let me reconsider **the `waitFor` import in the tick test** — I don't use waitFor there; I use the loop. The `waitFor` import is used in other tests. ✓.

Now — **the `vi` import** — used only in the tick test. ✓.

Now — the **`describe` wrapper** — I have one describe 'ActiveSessionBar' containing all tests, including the pure `formatElapsed` test. Fine.

Now — one more potential concern: **the `afterEach` that resets `state.user = null`** — the existing test file doesn't, but within my file it's fine. But wait — does my file's `afterEach` run after the tick test's `vi.useRealTimers()`? The `try/finally` restores real timers. ✓.

Now — **the fake-timers test + MSW**: the MSW server is set up in beforeAll (real timers at that point). During the test, the timers are partially faked — the MSW interceptor uses `setImmediate`/nextTick (real) — fine.

Now — **the `advanceTimersByTimeAsync` with faked `Date`** — the `Date` faking means `Date.now()` advances with the clock. The elapsed uses the `now` state (updated by the interval) — consistent.

Hmm, one subtle thing: `useNow`'s initial value `Date.now()` is captured at the component's first render (during the setup loop). Then the interval updates it. The `first` read is after the loop. Fine.

Now — the **regex** `^\d+h \d+m \d+s$` — the elapsed from 2024-04-01 to "now" (the fake now = the real now at useFakeTimers call time, i.e., 2025/2026) → thousands of hours. ✓ matches.

Now — let me also confirm **`formatElapsed(3_665_000)`**: 3665s = 1h 1m 5s → `1h 1m 5s` ✓. `formatElapsed(65_000)` = 65s = 1m 5s ✓. `formatElapsed(5_000)` = 5s ✓.

Now — **TS strict on the test file**: `const target = sessions.find(...)` → `Session | undefined`; I guard with throw. ✓. `const snapshot = { ...target }` — a copy of Session. `Object.assign(target, snapshot)` ✓.

`const first = elapsed.textContent;` → `string | null`. `expect(first).toMatch` — fine (expect accepts anything). The comparison `elapsed.textContent === first` is fine.

Now — **`vi.useFakeTimers({ toFake: [...] })`** — the config type: `toFake?: Iterable<FakeableAPI>` where FakeableAPI is a union of timer names including 'Date.' ✓.

Now — let me also reconsider: **does `renderApp` work with the fake `Date`?** The QueryClient uses `Date.now()` for cache timestamps — faked consistently. ✓.

Now — the **final AppLayout**:

```tsx
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';

/**
 * The authenticated shell. Anything that should appear on every authenticated
 * screen belongs here, above <Outlet />.
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

Now — the **final SessionDetailScreen** (full):

```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // The server marks a session active as soon as it is opened (unless it is
  // already closed). We never write that fact client-side; we refetch the
  // source of truth so the active-session bar converges with the server.
  useEffect(() => {
    if (session) void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
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

Hmm — wait, one issue: the invalidation effect fires on every `session` change. Including the initial set. But also — consider: I'm on s-001's detail; I save notes → the session updates → the invalidation → the active refetch. Fine.

But there's a subtler issue: the `setNotes` effect and the invalidation effect both depend on `[session]` — both fire. Order: declared order. Fine.

Now — **`noUnusedLocals`** — all good.

Now — let me reconsider the **`void` operator** on the promise — the codebase uses `void logout()`, `void start()` — consistent.

Now — let me re-scan the **close test** for the dialog title once more: the ConfirmDialog `aria-label={title}` = "Close this session?" ✓. `findByRole('dialog', { name: 'Close this session?' })` ✓.

And in the close test, is there any other dialog? No (I'm on /orders). ✓.

Now — the **`within(dialog).getByRole('button', { name: 'Close session' })`** — the dialog's actions: "Cancel" + "Close session" (the confirm). ✓.

Now — after the confirm click: the dialog closes (confirmClose false), the mutation runs. `waitFor` the bar's absence. ✓.

Now — one more: the **`patchLists`** in the close mutation — I'm on /orders, so no sessions list cache. Later, the list is fetched fresh. ✓.

Now — the **`findByRole('row', ...)`** — waits for the list load + the row. ✓.

Now — let me reconsider whether `getByRole('link', { name: 'Sessions' })` could match multiple in the close test: on /orders, the nav links "Sessions," "Orders"; the order rows aren't links (they're `tr` onClicks). ✓ unique.

Now — the **logout test** details: after re-login and the list load, click the "Inspection 2" row link. Wait — I wrote the final open as "Inspection 2." The list page 1 rows: 1-10. ✓.

Also — the `await screen.findByTestId('active-session-bar')` after the open: the invalidation flow. ✓.

Now — the **potential issue**: in the logout test, after logout, the `AuthProvider`'s `queryClient.clear()` — the `renderApp`'s query client. Then re-login: the AuthProvider's `login` sets user → the RequireAuth passes → the AppLayout mounts fresh → the bar's query fetches active. The mock's `state.activeSessionId` is null (the logout handler cleared it). ✓.

But wait — the mock's logout handler: `state.user = null; state.activeSessionId = null;` ✓.

Now — one more: **the AuthProvider's `logout` calls `api.logout()`** — the handler exists. ✓.

Now — let me think about **whether `renderApp`'s AuthProvider's initial `me()` fetch could interfere in the logout test**: on mount, `state.user` is set → me() returns the user. ✓.

Now — I think the solution is complete and consistent. Let me also double-check **no file references something that doesn't exist**: `sessionKeys.active` exists (I keep it). `api.getActiveSession` exists. `useCloseSession` exists (I keep its behavior + add invalidation).

One more: in `queries.ts`, I should make sure I don't break the existing export signatures (the detail screen imports `useCloseSession, useSession, useUpdateSessionNotes`; the list imports `useSessions`). ✓ all kept.

Now — the **format of the output**: level-3 heading with the path, then a fenced block. Nothing else. Five headings:

1. `### src/features/sessions/queries.ts`
2. `### src/features/sessions/ActiveSessionBar.tsx`
3. `### src/features/sessions/SessionDetailScreen.tsx`
4. `### src/app/AppLayout.tsx`
5. `### src/features/sessions/ActiveSessionBar.test.tsx`

Order: logical — queries, bar, detail, layout, tests.

Let me do one final review of the test file, assembling it in full:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

afterEach(() => {
  state.user = null;
  state.activeSessionId = null;
});

describe('ActiveSessionBar', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(5_000)).toBe('5s');
    expect(formatElapsed(65_000)).toBe('1m 5s');
    expect(formatElapsed(3_665_000)).toBe('1h 1m 5s');
    expect(formatElapsed(-1)).toBe('0s');
  });

  it('shows no bar while the server has no active session', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('restores the active session from the API after a page refresh', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    // A fresh app instance, as a full page reload produces: only the server
    // still remembers which session is active.
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    expect(within(bar).getByText('paused')).toBeInTheDocument();
  });

  it('makes an opened session the active one, and keeps showing it elsewhere', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
  });

  it('closes the active session from the bar and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-005';
    const target = sessions.find((s) => s.id === 's-005');
    if (!target) throw new Error('mock data must contain s-005');
    const snapshot = { ...target };

    try {
      renderApp('/orders');
      const bar = await screen.findByTestId('active-session-bar');
      await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

      const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

      await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
      const row = await screen.findByRole('row', { name: /Inspection 5/ });
      expect(within(row).getByText('closed')).toBeInTheDocument();
    } finally {
      Object.assign(target, snapshot);
    }
  });

  it('asks before opening another session while the current one has unsaved notes', async () => {
    state.user = OPERATOR;
    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    expect(within(dialog).getByText('Your changes to the notes have not been saved.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const again = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('ticking the elapsed time once per second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      state.user = OPERATOR;
      state.activeSessionId = 's-001';
      renderApp('/orders');

      for (let i = 0; i < 50 && !screen.queryByTestId('active-session-bar'); i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      const bar = screen.getByTestId('active-session-bar');
      const elapsed = within(bar).getByTestId('active-session-elapsed');
      const first = elapsed.textContent;
      expect(first).toMatch(/^\d+h \d+m \d+s$/);

      await vi.advanceTimersByTimeAsync(2500);
      for (let i = 0; i < 10 && elapsed.textContent === first; i++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(elapsed.textContent).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logout clears the bar and a re-login starts without one', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await screen.findByTestId('active-session-bar');
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument();
  });
});
```

Wait — one issue in the "asks before opening another" test: after the first `userEvent.click(screen.getByRole('link', { name: 'Sessions' }))` is blocked, I assert the dialog. Then cancel. Then re-click. But — subtle: when the navigation is blocked, does the link's click handler complete? React Router's `useBlocker` — the blocker intercepts in the data router's transition; the click still "happens" but the navigation is pending/blocked. The dialog renders from `blocker.state === 'blocked'`. ✓.

Another subtle — **the `getByRole('link', { name: 'Sessions' })` after cancel**: still on the detail; the nav is there. ✓.

Now — one more: **`userEvent.click` on the nav link triggers a re-render mid-way** — fine.

Now — the **potential issue**: in the "asks" test, after the proceed and the list load, the bar still shows Inspection 1 (the active is still s-001 — the mock: navigating away doesn't clear active; the list's GET doesn't touch active). Then I click Inspection 2 → the GET sets active to s-002 → the bar updates. ✓. The intermediate assertion isn't needed.

Now — let me reconsider **the "makes an opened session" test's `findByTestId('active-session-bar')`** — after clicking the row, the detail loads and the invalidation refetches. But — is there a race where the bar's active query refetches before the mock's GET /sessions/:id has set `state.activeSessionId`? Sequence: the row click → the router navigates → the detail mounts → `useSession`'s fetch starts (the mock's GET handler runs synchronously when the response is generated? MSW handler: the fetch is intercepted; the handler runs; it sets `state.activeSessionId` and returns the response). The detail's effect (invalidation) runs after the session data is set — which is after the fetch resolves — which is after the handler has run (the handler set active before the response). So the invalidation's refetch sees the updated active. ✓ no race.

But — the bar's active query might also refetch due to... no, only the invalidation. ✓.

Now — **the first active fetch** (on AppLayout mount, when I'm on the list): returns null (activeSessionId is null). The bar is hidden. After the open: the invalidation → the refetch → s-001 → the bar appears. `findByTestId` waits. ✓.

Now — the **test "replaces"**: initial active s-001; render /sessions; the bar's fetch → s-001. ✓. Click Inspection 2 → the detail's GET sets active to s-002 → the invalidation → the bar updates. ✓.

Now — I'm fairly confident. Let me also double-check the **`waitFor` timeout** (default 1s) is enough for these chains (each is a few MSW round trips, all in-memory). ✓.

Now — one more compile check for the test: `import { sessions, state } from '../../mocks/db';` — both exist. ✓.

And — **the `OPERATOR` const is used in every test** ✓.

Now — the **discipline check**: I'm not restating unchanged files. I'm only outputting 5. ✓.

One last thought — the **`ActiveSessionBar` file placement**: `src/features/sessions/` — the bar is a sessions feature used by the app shell. The layout imports it cross-feature (`../features/sessions/...`) — AppLayout already imports from `../auth` and `../components`, so a cross-feature import is in the style. ✓.

Also — hmm, should the bar go in `src/app/` instead (since it's part of the shell)? It's sessions-domain (uses sessions queries). The app shell composing the feature component is fine. Keep it in features/sessions.

Now — the **`ASSUMPTION` comment** — I placed one about pause timestamps. Anything else? The "bar becomes empty" = the bar unmounts — that's my doc comment, fine. I think one assumption comment is enough.

Let me write out the final answer now. No prose outside the pattern — the instructions say nothing outside the pattern is read; keep it to nothing. Start with the first heading.

Actually — wait, let me reconsider the `useNow` placement: it's defined after its use in the file — function hoisting: `function useNow` is hoisted ✓ (function declaration). `formatElapsed` is a declaration, hoisted ✓.

And in the tick test, I reference `screen.getByTestId('active-session-bar')` — if the bar never appears (a bug), it throws after the loop → the test fails. ✓.

Also — the **`for` loop condition `!screen.queryByTestId(...)`** — after the bar appears, the loop exits; the subsequent `getByTestId` is immediate. ✓.

One more: **the fake-timers test — `renderApp` renders AuthProvider which does `api.me()`** — the fetch is in flight; the loop advances; resolves. ✓.

And — **StrictMode is not in renderApp** ✓ (single effect run).

Final check on the `formatElapsed` export — used in the test. The component file exports both the component and the formatter — fine.

Now, let me write it all out.
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
 * The server's active session. `GET /sessions/active` is the single source of
 * truth: the client never decides or remembers which session is active, it
 * only refetches after the server has changed its mind (open, close, refresh).
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
      // Closing clears the server's active session. Refetch the source of
      // truth so the bar empties instead of trusting a client-side guess.
      void qc.invalidateQueries({ queryKey: sessionKeys.active() });
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

/**
 * The persistent active-session bar. AppLayout mounts it on every
 * authenticated screen. It renders only while the server reports an active
 * session — `GET /sessions/active` is the source of truth, so a page refresh
 * (or a fresh login) restores it without any client-side memory, and closing
 * the session empties the bar.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  // ASSUMPTION: the data model has no pause timestamps, so elapsed time is
  // measured from startedAt for open and paused sessions alike, and frozen at
  // closedAt once the session is closed.
  const running = active !== null && active !== undefined && active.closedAt === null;
  const now = useNow(running);

  if (!active) return null;

  const end = active.closedAt !== null ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <strong>{active.name}</strong>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="active-session-elapsed">{elapsed}</span>
      <div className="actions">
        <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
        <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
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
          closeSession.mutate(active.id);
        }}
      />
    </div>
  );
}

/** Re-renders the caller once per second while `running` is true. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

### src/features/sessions/SessionDetailScreen.tsx
```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // The server marks a session active as soon as it is opened (unless it is
  // already closed). We never write that fact client-side; we refetch the
  // source of truth so the active-session bar converges with the server.
  useEffect(() => {
    if (session) void queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
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

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

afterEach(() => {
  state.user = null;
  state.activeSessionId = null;
});

describe('ActiveSessionBar', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(5_000)).toBe('5s');
    expect(formatElapsed(65_000)).toBe('1m 5s');
    expect(formatElapsed(3_665_000)).toBe('1h 1m 5s');
    expect(formatElapsed(-1)).toBe('0s');
  });

  it('shows no bar while the server has no active session', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('restores the active session from the API after a page refresh', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    // A fresh app instance, as a full page reload produces: only the server
    // still remembers which session is active.
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    expect(within(bar).getByText('paused')).toBeInTheDocument();
  });

  it('makes an opened session the active one, and keeps showing it elsewhere', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
  });

  it('closes the active session from the bar and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-005';
    const target = sessions.find((s) => s.id === 's-005');
    if (!target) throw new Error('mock data must contain s-005');
    const snapshot = { ...target };

    try {
      renderApp('/orders');
      const bar = await screen.findByTestId('active-session-bar');
      await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

      const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

      await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
      const row = await screen.findByRole('row', { name: /Inspection 5/ });
      expect(within(row).getByText('closed')).toBeInTheDocument();
    } finally {
      Object.assign(target, snapshot);
    }
  });

  it('asks before opening another session while the current one has unsaved notes', async () => {
    state.user = OPERATOR;
    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    expect(within(dialog).getByText('Your changes to the notes have not been saved.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const again = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('ticking the elapsed time once per second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      state.user = OPERATOR;
      state.activeSessionId = 's-001';
      renderApp('/orders');

      for (let i = 0; i < 50 && !screen.queryByTestId('active-session-bar'); i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      const bar = screen.getByTestId('active-session-bar');
      const elapsed = within(bar).getByTestId('active-session-elapsed');
      const first = elapsed.textContent;
      expect(first).toMatch(/^\d+h \d+m \d+s$/);

      await vi.advanceTimersByTimeAsync(2500);
      for (let i = 0; i < 10 && elapsed.textContent === first; i++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(elapsed.textContent).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logout clears the bar and a re-login starts without one', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await screen.findByTestId('active-session-bar');
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument();
  });
});
```


---
