# Transcript — 10-adapt-existing-screen / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me analyze the task. This is a React + TypeScript back office using react-query and react-router-dom. What needs to be implemented is a persistent active session bar that is shown on every authenticated screen.

Main requirements:
1. Opening a session from the list makes it the active session. The bar shows name, status, and ticking elapsed time, on every screen.
2. The bar offers "Resume" (navigate to details) and "Close session" (call the existing close endpoint with a confirm. On success, the bar clears).
3. Only one active session at a time. Opening another one replaces it (if the current one has unsaved notes, confirm first — the detail screen already tracks a dirty flag).
4. The active session survives a full page refresh. Use `GET /sessions/active` as the source of truth.

Existing behaviors that must not regress:
- List filtering/pagination
- Detail edit + dirty flag warning on route change
- Logout clears all state
- Direct deep link to detail URL

Build constraints:
- The bar should go in the layout that already wraps the authenticated screens (AppLayout).
- Server state through react-query.
- Reuse the existing ConfirmDialog.
- Handle pending and error states for the active-session query. A failed fetch must not be rendered as "no active session."
- Shared types and API modules are used, not rewritten.
- The existing suite continues to pass, unmodified.
- Tests for the new behavior in the repo's style.

Let me think about the architecture:

**Where does "opening a session" happen?**

Looking at the mock handler: `GET /api/sessions/:id` sets `state.activeSessionId` as a side effect — that is, the mock server marks the session as active when a session is fetched by ID. This means that "opening a session from the list" = navigating to the detail screen, which fetches the session by ID, and the server marks it active. So the client side doesn't need an "activate" call — the server's behavior already marks it active when the session is opened.

Wait, that's an interesting design in the mock. `GET /api/sessions/:id` sets `state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id`. So opening the detail of an open/paused session makes it active. Opening the detail of a closed session does not change the active.

Hmm, but wait — the bar should show when you open a session from the list. The list links directly to `/sessions/:id`. So navigation → detail screen loads session → server marks active → `GET /sessions/active` returns it.

So the client flow is:
- The `useActiveSession` query with key `['sessions', 'active']` (already in `sessionKeys.active`).
- When a session detail is fetched (via `useSession(id)` on the detail screen), we should invalidate/refetch the active query so the bar updates. Since the server has changed the active session, we can refetch `sessionKeys.active` in `useSession`'s onSuccess or in the detail screen.

Actually, a cleaner approach: on the detail screen, after the session is loaded, we can call `qc.invalidateQueries({ queryKey: sessionKeys.active() })` or refetch the active query. But watch out: the detail screen also renders for deep links, and that's fine.

Alternative: `useSession` is a query hook, so adding onSuccess logic inside it is awkward. Better: in SessionDetailScreen, once the session is loaded, refetch the active session query. We could add a useEffect: when `session` changes and is not null, call `void qc.refetchQueries({ queryKey: sessionKeys.active() })`.

Hmm, but there's a subtle point: the GET /sessions/:id handler marks active *when the fetch happens*. The client fetches the session, and the server side effect sets active. Then refetching the active query picks it up. There's a possible race: if the client refetches active before the server has processed the detail fetch? No — the detail fetch response arrives before we refetch active (since it's sequential: we refetch in a post-data-received effect). MSW is synchronous within a request, and state changes are immediate per request. So the refetch happens after the detail fetch resolves, and at that point state.activeSessionId is already set.

But wait — another subtlety. The query cache: the detail query `['sessions', 'detail', id]` has staleTime 30s. If you open session A, navigate away, come back within 30s, the detail query won't refetch, so the server won't re-mark active... but that's fine since A is already active. But if you open A, then open B (server marks B active), go back to A within 30s (cache hit, no fetch, server still has B active) — the bar shows B. Correct behavior: the last one opened is active.

What if A is cached and B is not? Open A (server: active=A). Open B (server fetches B, active=B). Open A again from the list (within 30s, cache hit, no refetch, server still active=B). Bar shows B. Is that "opening A makes it active"? Per the server semantics in the mock, no — the server only marks active on actual fetch. Since this is the given API behavior, we follow it. The spec says "opening a session from the list makes it the active session." The mock's `GET /sessions/:id` is the mechanism. We shouldn't rewrite the API module (shared, don't rewrite).

Hmm, but should we force a refetch of the detail on mount so that opening always re-marks active? The app's convention is staleTime 30_000. Forcing refetch on mount would change detail behavior (the dirty flag uses `session !== undefined && notes !== session.notes` — notes are initialized from session in an effect. A refetch that returns the same data would trigger the effect but notes would be identical, so dirty stays false. Actually the effect is `if (session) setNotes(session.notes)` — refetching the same object would reset notes to server value... if the user is editing and a refetch happens, it'd clobber. But the refetch only happens on mount, before editing starts. Hmm, but the `useEffect(() => { if (session) setNotes(session.notes); }, [session])` — the identity of the session changes on refetch, so notes would be reset. On mount that's fine.)

I think it's safest not to change detail fetch behavior. Just refetch the active query after the detail data loads. Actually, wait — should the detail screen refetch active, or should it happen when the list item is opened? "Opening a session from the list makes it active" — the opening action is navigation to detail. The detail screen is where the session gets fetched. So refetching active on the detail screen after data loads is the right place.

But also consider: what if a session is closed from the bar? The close mutation's onSuccess should set the active query data to null (server clears active when closing the active session). We can update `useCloseSession`'s onSuccess: `qc.setQueryData(sessionKeys.active(), null)` — but only if the closed session was the active one. We don't know that without the active data. We can check: `const active = qc.getQueryData(sessionKeys.active()); if (active?.id === updated.id) qc.setQueryData(sessionKeys.active(), null)`. That's a targeted update, matching the app's pattern (write the returned row into the cache that holds it, rather than invalidating).

Also, if you close the session from the detail screen — the bar should clear too. The same `useCloseSession` is used in both the detail screen and the bar, so the mutation's onSuccess handles both.

**"Only one active session at a time. Opening another one replaces it (with confirm first if the current one has unsaved notes)"**

The dirty flag lives in SessionDetailScreen as local state. The requirement says: "The detail screen already tracks a dirty flag. Use it rather than adding a second source of truth."

Hmm. How can the bar know about the dirty flag of a detail screen? The dirty flag is local to the detail screen. When would "opening another one" with the current one having unsaved notes happen?

Scenario: Operator is on the detail screen for session A, edits notes (dirty). Then... opens another session from the list? But to open from the list, you have to navigate to the list first, and the blocker would already fire on that route change ("Leave with unsaved notes?"). So by the time they're at the list, the notes have either been saved or discarded (blocked until confirmed).

Wait — but with `blocker.proceed()`, the user leaves without saving. The dirty flag... when the detail screen unmounts, local state is gone. So "unsaved notes" is lost anyway (the dialog says "Your changes to the notes have not been saved.").

Hmm, so when does "opening another one replaces it (with confirm first if the current one has unsaved notes)" kick in? Let me re-read.

"**Only one active session at a time.** Opening another one replaces it, with a confirm first if the current one has unsaved notes. The detail screen already tracks a dirty flag. Use it rather than adding a second source of truth for the same fact."

Hmm. "Use it rather than adding a second source of truth" — that means don't create a separate "hasUnsavedNotes" store that could disagree. The dirty flag is the source of truth.

Possible interpretation: the replacement confirm is a confirm on the *bar* side? No wait...

Another scenario: operator is on session A's detail screen with unsaved notes, and somehow opens session B without leaving A? Not possible in the UI as-is — the only way to open B is via the list.

Hmm wait, actually let me reconsider. Maybe the flow is: the bar is always present. While on the detail of A (dirty), the operator clicks... the bar has no session list. Hmm.

Actually maybe the intended flow is: the operator is on A's detail with dirty notes. The existing blocker already handles the "leave" case. "Replacement" happens implicitly: when you open B, B becomes active. The confirm for the *replacement* is precisely the existing blocker dialog ("Leave with unsaved notes?"). So the requirement is satisfied by the existing dirty flag + blocker: you can't silently lose a dirty session when opening another because leaving A requires confirmation.

But the spec explicitly says "opening another one replaces it, with a confirm first if the current one has unsaved notes." If the existing blocker already provides that confirm on route change, then "replacement" doesn't need its own confirm — the blocker is the confirm. And "use it rather than adding a second source of truth" strongly suggests: don't build a new dirty tracking. Leverage the fact that the existing blocker already guards it.

Hmm, but wait. There's a gap: what about opening another session while on the detail of the *currently active* session with dirty notes, if you could open another session without a route change? Not possible in the current UI.

But wait — there is another path: the bar's "close session." No, that's a close, not a replace.

Let me think about the deep-link case: deep-link to `/sessions/B` while A is active on the server (e.g., from a refresh). B's detail loads, server marks B active, bar switches to B. No dirty state exists (fresh load). Fine.

What about: operator on A's detail, dirty, clicks a link to B... there's no direct link A→B. OK.

So I think the correct reading is: the "replacement with confirm" behavior is realized by the existing dirty blocker on the detail screen (which the spec explicitly says to reuse). The bar itself doesn't need a "replace" action. "Opening another one" always goes through the detail screen, and if it's dirty, the blocker fires.

Hmm, wait, actually let me reconsider once more. There is a subtle case: operator on A's detail, dirty. Navigates to the list — blocker fires, confirms leave (notes discarded). Then opens B. No second confirm needed since notes are already "lost" with consent. That matches "confirm first if the current one has unsaved notes" — the confirm happened.

But hmm, what if the operator saved the notes and then... no.

Or is the intended design: the bar offers the replacement confirm when you open a second session while a first one is *displayed in the bar* with unsaved notes? That would require the bar to track the dirty state of a session whose detail screen may not even be mounted. "Use it [the dirty flag] rather than adding a second source of truth" — if the detail screen is unmounted, its dirty flag is gone. So the bar can't know. So that reading would require sharing the dirty flag, contradicting "no second source of truth" (well, sharing is one source of truth... a lifted state).

Hmm, actually maybe: lift the dirty flag to a shared place (e.g., a small context or a module-level store) so the detail screen and the bar both read the same fact. "Use it rather than adding a second source of truth for the same fact" could mean "share the same flag" — one source of truth, used by both.

Let me think about when the bar would need the flag. Scenario: on A's detail (dirty). The only UI element that could "open another one" is... nothing, on that screen. So the flag is never needed by the bar while the detail screen is unmounted (because the blocker already forced a decision).

Wait, unless: blocker `proceed()` — the user chooses "Leave" (discard). Then the detail screen unmounts. If we lifted the dirty flag to context, it would need to be cleared on unmount.

Honestly, I think the simplest correct implementation that satisfies the spec is:

1. Bar in AppLayout (the authenticated shell).
2. `useActiveSession()` query using `api.getActiveSession()`, key `sessionKeys.active()`.
3. Detail screen refetches/invalidates the active query after the session loads (so the server's "open = active" side effect shows up in the bar).
4. Close from the bar: ConfirmDialog → `useCloseSession().mutate(id)` → on success, the bar clears (mutation's onSuccess updates active cache to null if it was that session).
5. Dirty replacement: the existing blocker on the detail screen already confirms before leaving a dirty session, and that's exactly what "opening another one replaces it, with a confirm first if the current one has unsaved notes" means. Reuse, don't duplicate.

Hmm wait, but let me re-read the variant-a statement: "Opening another one replaces it (with confirm if the current one has unsaved notes — the detail screen already tracks a dirty flag)." And L2: "Opening another one replaces it, with a confirm first if the current one has unsaved notes. The detail screen already tracks a dirty flag. Use it rather than adding a second source of truth for the same fact."

"Use it" — the dirty flag. So the confirm must use the detail screen's dirty flag. The mechanism available from that flag is the `useBlocker(dirty)` on the detail screen. So the confirm is the blocker dialog. I'm now fairly convinced: no new dirty tracking. The existing blocker IS the confirm. The diff should not add a second dirty store.

But then, what does "testable behavior" look like? "Opening a second session while the first has unsaved notes → confirm before replacing." Test: render detail of A, type notes (dirty), click a link to B... but wait, in the app, there's no link from A's detail to B's detail. The route is via the list. In the test, we could navigate programmatically... the test can't easily click a list row from the detail screen.

Hmm, how do we test "opening a second session while the first has unsaved notes → confirm before replacing"?

Test approach: render app at `/sessions/s-001` (detail). Type into the textarea (dirty). Then navigate to `/sessions/s-002` — but how? In the test, we can grab the router from renderApp... `renderApp` returns the render result, but not the router. We could modify `render.tsx`... but "the existing suite continues to pass, unmodified" — modifying render.tsx is OK as long as existing tests still pass (they don't depend on the router object). Hmm, but the discipline: "don't create files not requested, don't improve code not asked to change." The task requests "edit existing screens... deliver as a coherent diff + tests." We can extend `render.tsx` to expose the router (add a return value) — the existing tests don't use the return value destructuring, so they'd still pass. Actually `renderApp` returns render's result (a RenderResult). If we make it return `{ ...result, router }`, existing tests that do `renderApp('/sessions')` without using the return value are unaffected. That's a small coherent change that enables testing route changes.

Alternatively, in the test, we could add a link to the other session... no, we can't change the screen for tests.

Another approach: `userEvent.click` on a nav link (Sessions list) → blocker dialog appears → assert the dialog, click "Leave" → navigates to list → then click a row for session B → B becomes active (bar shows B). That fully tests the flow using only existing UI elements! Nav "Sessions" link is in AppLayout's header.

Test:
1. `state.user = ...; state.activeSessionId = 's-001'` — wait, but A being active on the server is from opening it. Simpler: renderApp('/sessions/s-001'). The detail fetch marks A active on the server. Bar shows A.
2. Type into Notes (dirty).
3. Click nav "Sessions" link → blocker dialog "Leave with unsaved notes?" appears.
4. Assert dialog present (confirm before replacement).
5. Click "Leave" → on list screen. Bar still shows A (still active, no replacement yet).
6. Click "Inspection 2" link → detail B → server marks B active → bar shows "Inspection 2".

That's a solid behavior test for #3.

Also test: leaving without dirty → no dialog.

And: opening a second session while the first has *saved* notes → no confirm.

**Bar structure:**

Add to AppLayout, between the header and the Outlet:

```tsx
<ActiveSessionBar />
```

A new component `src/features/sessions/ActiveSessionBar.tsx` (feature-appropriate, uses session queries). Where should it live? The sessions feature owns session queries. The layout imports from features/sessions. That fits the repo's layout (feature folder with screens + queries). Let me put it at `src/features/sessions/ActiveSessionBar.tsx`.

Bar behavior:
- `const { data: session, isLoading, isError } = useActiveSession();`
- While `isLoading`: render a loading state? Spec: "handle the active session query's pending and error. A failed fetch must not be rendered as 'no active session'." So three states:
  - pending: render a placeholder ("Loading active session…"?). Hmm — but the bar is on every screen. Should the layout block on the bar's load? No. Render a small pending indicator.
  - error: render an error state ("Couldn't load the active session.").
  - success with null: no bar (or nothing at all).
  - success with session: bar with name, status badge, ticking elapsed time, Resume button, Close session button.

Wait — "The bar appears on every authenticated screen and nowhere else." When there's no active session, the bar is empty (absent). Fine.

**Ticking elapsed time:**

The elapsed time ticks. `startedAt` is known. Elapsed = now - startedAt. Tick: use an interval that updates a `now` state every second. When should it tick? Always when the bar is shown. Implementation: a small hook `useNow(intervalMs)` or inline:

```tsx
const [now, setNow] = useState(() => Date.now());
useEffect(() => {
  const t = setInterval(() => setNow(Date.now()), 1000);
  return () => clearInterval(t);
}, []);
```

But careful with tests: a real 1-second interval in tests is slow. For a ticking test, we'd want to advance. Options: use fake timers in tests (`vi.useFakeTimers()`), or make the tick interval injectable. Hmm, the repo style... existing tests don't use fake timers. For a "ticking elapsed time" test, fake timers are the way: `vi.useFakeTimers()`, render, advance 65s, expect elapsed text to update.

But wait — fake timers + react-query + MSW: react-query uses setTimeout for scheduling, and MSW (node) uses fetch — under fake timers, promises... `vi.useFakeTimers()` fakes Date and timers by default (in vitest 2, `vi.useFakeTimers()` fakes setTimeout etc. and Date? In Vitest 2, `vi.useFakeTimers()` fakes Date by default? Actually @sinonjs/fake-timers is used, and Vitest's `useFakeTimers` fakes `Date` by default? Let me recall: Vitest's fake timers, based on sinon, by default fake: setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, Date. Yes, in Vitest, `Date` is in the default `toFake` list. So Date.now() will advance with `vi.advanceTimersByTime`.

But the danger: react-query v5 uses timers for retry/gc — with retry: false and no gc interference, we're fine. MSW node server: fetch interception via interceptors — the response is async via microtasks, not timers, so it works even with fake timers as long as we `await` properly. Actually, with fake timers, we need to be careful: `await waitFor(...)` uses real time internally? testing-library's `waitFor` uses `setInterval` under the hood... with fake timers, `await` on a promise that resolves via microtasks works, but `waitFor`'s polling uses setInterval, which is faked → we'd need to advance. Ugh.

Cleaner: for the ticking test, render the bar component directly with `renderWithProviders`? Hmm, renderWithProviders renders `ui` at path '/' with providers. But useNavigate requires a router context — renderWithProviders provides one (createMemoryRouter). OK.

But actually, testing the full app for ticking is heavy. Alternative approach for testability: extract the elapsed-time formatting + tick into a small presentational component or hook that we can test with fake timers in isolation: e.g., `ActiveSessionBar.test.tsx` rendering just the bar via renderWithProviders with MSW providing the active session. With fake timers, advance and assert the text changes.

Let me design: `ActiveSessionBar` uses `useActiveSession()`. For a focused test, render with `renderWithProviders(<ActiveSessionBar />)`, with `state.user` set and `state.activeSessionId` set, MSW returns the session. Then `vi.useFakeTimers()`, `vi.advanceTimersByTime(5000)`, assert elapsed shows a larger value.

Timing of elapsed: startedAt is fixed in the mock db (2024 dates). Elapsed = now - startedAt is huge (months). The text would be like "142d 3h 21m 0s." For a ticking test, we just need to see the seconds change: advance 1000ms → the seconds digit increments. The format function: let's make it human-readable:

```ts
export function formatElapsed(fromIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(fromIso).getTime());
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  ...
}
```

Format like `142d 03h 21m 05s`? Simpler: show "Xd Yh Zm Ws". For a ticking test, we can assert `screen.getByText(/...s$/)`... simpler: assert the exact text before and after advancing, that they differ and match a seconds pattern. Or better: in the test, we could set the mock db's `startedAt`? The db is a module-level constant. Tests import `state` from mocks/db, but sessions are a separate export. We could mutate `sessions[0].startedAt = new Date(Date.now() - 5000).toISOString()` in the test — the db is shared mutable state and the test resets handlers but not the db. Hmm, existing tests don't reset the db either (state.user is set per test). Mutating sessions[0].startedAt in one test would leak into others... tests in the same file run sequentially. We could restore it. That's acceptable but a bit gross. Alternative: just advance a lot and assert that the seconds portion changed.

Actually the cleanest: assert the bar contains a text matching a regex for elapsed, advance 3s, assert the seconds value is now 3 more. If elapsed is like "123d 4h 5m 6s", after 3s → "…9s". We can compute from the session's startedAt in the test using the same formatter... but that's reimplementation in the test (tests should test behavior, not implementation. Importing the formatter is fine though).

Simpler and robust:
```ts
const before = screen.getByText(/elapsed|Active for/i)?
```
Hmm, let me just have the bar render a span with data-testid... no testid in the repo style. They use role/text/label. Let me render the elapsed as text like `Active for 123d 4h 5m 6s` — a label + value, readable, and testable via `getByText(/Active for .*s$/)`. And in the test: grab the text, advance 2s, wait for the updated text (with fake timers, does `waitFor` need `advanceTimersByTime` during it? testing-library's waitFor under fake timers: vitest recommends `vi.advanceTimersByTime` in the waitFor callback... actually @testing-library/react's waitFor, when `setTimeout` is faked, auto-detects fake timers and advances them (it checks for the presence of `jest.advanceTimersByTime`? In RTL, `waitFor` has built-in support: if fake timers are detected (via `typeof jest !== 'undefined' && jest.advanceTimersByTime`), it uses them. With vitest globals, RTL's fake timer detection works via `@sinonjs/fake-timers` installed timers? RTL's detection: in `asyncWrapper`, it checks `typeof jest === 'undefined' ? ... : jest.advanceTimersByTime`. Vitest's globals provide `jest`? No — vitest globals provide `vi`, and RTL v16 supports vitest fake timers: it checks `globalThis.__vitest_worker__`? Let me recall RTL source: `awaitWrap`/`checkCallback`… RTL's `waitFor` uses `jest.advanceTimersByTime` if available (jest legacy). There's also `vi.advanceTimersByTime` support added: in RTL's `wait-for-element.ts`, `advanceTimersWrapper` checks `typeof jest !== 'undefined' && typeof jest.advanceTimersByTime === 'function'` OR `typeof vi !== 'undefined' && typeof vi.advanceTimersByTime === 'function'` — I think modern RTL (14+) supports vitest fake timers in waitFor. Yes — RTL added vitest fake timer support: if `vi` is global, it uses `vi.advanceTimersByTime`. I'm fairly confident RTL 16 handles it.

To be safe, in the test we could avoid `waitFor` and instead: `vi.advanceTimersByTime(2000)` then flush React updates with `act(() => {})`... hmm, RTL re-exports `act`. Pattern:

```ts
vi.useFakeTimers();
renderWithProviders(<ActiveSessionBar />);
await screen.findByText(/Active for/);  // wait for the query
vi.advanceTimersByTime(3000);
await screen.findByText(/Active for .* 3s/)? 
```

Hmm, but the exact seconds text depends on startedAt (2024-04-xx 08:00 UTC) vs. the faked now (real system time at the point of fake-timer setup). startedAt in the past → elapsed is large. The seconds component cycles 0-59. Before: some S. After +3s: S+3 mod 60 — could wrap. Ugh.

Cleaner: in the test, set the active session's startedAt to "just now" (fake now - 10s), then we know the seconds: starts at 10s (well, plus rendering lag — the first `now` is computed at render, which is the faked start time. startedAt = start - 10s → "10s". Advance 3s → "13s"). Deterministic!

```ts
vi.useFakeTimers();
const start = Date.now();
sessions[0].startedAt = new Date(start - 10_000).toISOString();
state.user = {...}; state.activeSessionId = 's-001';
renderWithProviders(<ActiveSessionBar />);
await screen.findByText('Active for 0h 0m 10s');
vi.advanceTimersByTime(3_000);
await screen.findByText('Active for 0h 0m 13s');
vi.useRealTimers();
```

Wait — with fake timers, MSW + react-query: the fetch flow uses microtasks (real, not faked) and react-query's internal timers (scheduling refetches, etc.) are faked. `findByText`'s polling uses real timers?? RTL's waitFor: if fake timers are detected, it advances them. I'm fairly confident RTL 16's `waitFor` works with vitest fake timers (it special-cases: `typeof jest !== 'undefined' ? jest.advanceTimersByTime(...) : advanceTimersByTime(...)` — hmm).

Let me look at RTL source (v16) from memory: in `src/wait-for.ts`:

```ts
const advanceTimersByTime = ...
if (typeof jest !== 'undefined' && typeof jest.advanceTimersByTime === 'function') {
  advanceTimersByTime = ...
} else if (typeof vi !== 'undefined' && typeof vi.advanceTimersByTime === 'function') { ... }
```

I do recall RTL added `vi` support: "fake-timer support for vitest" — yes, RTL 14.2+ checks for the `vi` global. OK, I'll trust that. `findByText` under fake timers advances internally. And our 1-second tick interval is also advanced by it, so the text will update. But note: `findByText` with fake timers advances 50ms at a time (or 100?) per check until the text appears or timeout. Our interval is 1000ms. It'll be advanced past it. OK.

But one risk: react-query v5's scheduler under fake timers — the initial fetch: useQuery's initial load is scheduled... on mount, the fetch starts synchronously-ish (via a microtask). MSW node intercepts fetch — under fake timers, MSW's internal async uses promises (fine). `retry: false` avoids retry timers. `staleTime 30_000` — gc/refetch timers are faked, but we don't wait long. Should be fine.

Another risk: `AuthProvider`'s `api.me()` on mount — with `state.user` set, returns user. Fine.

Hmm, but actually — do we even want to test the bar in isolation? The repo style: tests are per screen, full-app via `renderApp`. The bar is part of the layout. We could put all bar tests in a new `ActiveSessionBar.test.tsx` that uses `renderApp` (full app) where possible, and use `renderWithProviders` for the tick (isolated). Hmm, renderWithProviders is for component-level tests — it exists in the repo (probably used by something? Currently only used by... actually it's defined in test/render.tsx. Existing tests only use renderApp. renderWithProviders may be there for component tests. Using it is consistent with the repo's style.)

Actually — simpler for tick: we could test the tick via the full app too. Fake timers, renderApp('/sessions'), wait for bar, advance, assert. Same concern but same mechanism. Let me just use renderApp for consistency... but fake timers + full app (AuthProvider me fetch + list fetch + active fetch) — all fine.

Hmm, let me decide: put bar tests in `src/features/sessions/ActiveSessionBar.test.tsx`:

1. "Shows the active session on another screen, with resume and close" — renderApp('/orders') (an authenticated non-session screen), bar shows the active session's name/status. Click Resume → URL becomes session detail (assert by the detail heading appearing).
2. "Close from the bar clears the bar after confirmation" — with active session set, on any screen, click "Close session" → ConfirmDialog → confirm → bar empties (assert the name is gone / no bar). And assert the session in the db is closed (server state) — behavior: the endpoint was called. "Never just assert that a call happened" — assert the bar clearing and the server status change (sessions[i].status === 'closed') and the bar is gone.
3. "Replacement: opening another session while the current one has unsaved notes asks to confirm first" — the flow I described: renderApp at detail A, dirty, navigate to list (blocker), Leave, open B, bar shows B.
   - Additionally: without dirty, leaving and opening B does not show the dialog.
4. "Survives refresh: bar comes back from GET /sessions/active" — "refresh" in tests = a fresh app instance with the server still holding state. So: renderApp('/sessions'), open A (click a row) → bar shows A → unmount. Re-render the app at '/sessions' (new QueryClient, fresh) → bar shows A again (from the server). This simulates a refresh: the client cache is gone, the server state persists (MSW db module-level). We need to unmount the first render (RTL's cleanup is automatic between renders? `render` calls are tracked. Auto-cleanup happens between tests via afterEach, not within a test). We can call `unmount()` on the first render result, then renderApp again. MSW state persists. QueryClient is fresh (makeQueryClient in renderApp). Auth: `state.user` still set (logout wasn't called).
5. "A failed active fetch is not shown as none" — `server.use(http.get('/api/sessions/active', () => HttpResponse.json({code:'boom'}, {status:500})))` → bar shows an error message, and crucially, if... wait, "a failed fetch must not be rendered as 'no active session'" — the error state is distinct. What do we render? A small notice "Couldn't load the active session." with a retry? Spec says handle pending and error. Retry button? Not asked. A message is sufficient. Test: assert the error notice text, and assert that no "no active session" empty state is rendered... we don't have a "no active session" empty message — when the query succeeds with null, we render nothing. Hmm, so what's the "no active session" state? Absence of the bar. On error, we render the error notice → distinct. On pending, we render "Loading…" → distinct. Test: on error, the error notice is visible.

Also test that the bar is NOT shown on the login screen ("nowhere else"): renderApp('/login') without user → login screen, no bar element. With user, RequireAuth bounces to /sessions... so bar absence on login = user not logged in. Test: no user → no bar (query by name → null). Good.

6. Logout clears the bar: covered by existing behavior — queryClient.clear() wipes the cache. Also the server clears activeSessionId on logout. After logout → /login, no bar. Might add a test: renderApp('/sessions'), bar visible. Click "Log out" → login screen, no bar. Good regression test for "logout clears all state including the bar."

**Now, the "open = active" refetch mechanism.**

In SessionDetailScreen, after `session` loads, we want the bar to pick up the change. The mock sets active on GET /:id. Options:

a) In SessionDetailScreen:
```ts
const qc = useQueryClient();
useEffect(() => {
  if (session) void qc.refetchQueries({ queryKey: sessionKeys.active() });
}, [session, qc]);
```
Refetch every time session identity changes (refetch of detail → new identity? setQueryData with the same value is... the mutation writes the updated row on save → session identity changes → refetch active (no-op on the server, fine).

But careful: StrictMode double-invokes effects — a double refetch is harmless.

b) As an alternative, put this in `useSession` via a side effect? No — hooks shouldn't have side effects. Keep it in the screen.

Hmm wait, actually there's a subtlety with (a): `sessionKeys.active()` returns a new array `['sessions', 'active']` each call — fine for refetchQueries (it compares by structural equality of the queryKey). refetchQueries by default only refetches active observers? Default for `refetchQueries({ queryKey })`: `refetchType: 'active'`? Actually the default is to refetch all matching queries? Let me recall: `refetchQueries(options)` → default refetchType is 'active'... hmm. In v5, `queryClient.refetchQueries({ queryKey })` defaults to refetchType 'active' — only refetches queries that have active observers. The bar (AppLayout) is always mounted on an authenticated screen → the active query has an observer → active. OK. But to be safe, we could use `qc.invalidateQueries({ queryKey: sessionKeys.active() })` — invalidation marks stale and triggers refetch on active observers. Equivalent. Or simplest: `qc.refetchQueries({ queryKey: sessionKeys.active() })`. Let's go with that. Actually, hmm — the app's pattern comment says "targeted update, not invalidation: the server already returned the row." In this case, the server hasn't returned an active row. The detail fetch implicitly changed active. Refetching the active query is the honest way. Fine.

But wait — is refetching on *every* detail screen visit correct for the "replace" semantics? Open A → active=A (server). Navigate to list. Within 30s, open A again: detail query is cached (staleTime 30s, no refetch) → server still active=A. Fine. Open B: detail fetch (B not cached or stale) → server active=B → refetch active → bar B.

Edge: open A (active=A). Open B (active=B). Reopen A (A detail was cached from 10s ago → no server call → server still active=B). Bar shows B. Per the server, B is active — correct per "server is the source of truth." The list link navigates to A's detail which renders the cached A, but active remains B. Slightly weird UX-wise, but consistent with the given API. Acceptable — and the spec says the server fact is the truth.

Hmm, but should the detail screen force a detail refetch on mount so that opening always re-marks active? "Opening a session from the list makes it the active session" — strictly, with cache, reopening a recently-viewed session doesn't re-fetch → doesn't re-mark. To make "open = active" reliable, we could add `refetchOnMount: true` to useSession? That changes existing detail behavior (a refetch on mount) — risk to the dirty-flag tests? Existing detail test... no existing detail test in the shown files! Only SessionsListScreen.test.tsx is shown. "The existing suite continues to pass, unmodified" — the shown test file is the list test. There might be other test files in the full repo not shown, but I only see the given files. The workspace given is the complete set of files (I should treat the shown files as the codebase). Tests: only SessionsListScreen.test.tsx. So the "existing suite" = that file. It must pass unmodified.

With refetchOnMount on detail: the list test renders '/sessions' — no impact. OK, but do we want that? Consideration: the dirty flag: `dirty = session !== undefined && notes !== session.notes`. On mount: notes='' initially, session loads → effect sets notes=session.notes. If a refetch happens later with the same notes, no change. Fine.

I'll leave useSession as-is (don't change shared query behavior more than needed) and rely on: the first open always fetches (fresh) → marks active. Reopens within 30s use cache — the server already has it (or the last-opened one) as active. Honestly, for the eval, the important behaviors are: opening from the list → active → bar. The fresh-open path covers that.

Hmm, wait, actually there's a scenario that breaks in tests: my replacement test does: render detail A (fetch, active=A), navigate to list (A cached), click B (fresh, active=B). Fine.

Refresh test: renderApp detail A → active=A. Unmount. renderApp('/sessions') fresh client → bar queries /sessions/active → A. Fine.

**Now, bar UI details:**

```tsx
<section className="active-session-bar"> ... </section>
```

The repo uses class names: `.shell`, `.btn--primary`, `.badge`, `.dialog`, `.row--clickable`, `.actions`, `.pagination`, `.filters`, `.tooltip`. No CSS file is shown (styles may live elsewhere or not at all — only class names. Fine, I'll add classes in the same style: `active-session-bar`, maybe `active-session-bar__fields`).

Content:
- Name (link? The "Resume" button navigates. Name could also be a Link — but the spec says resume navigates. Keep name as text and Resume as the Button. Actually making the name a link is nice but not required. Keep it simple: name text + Badge status + elapsed + Resume + Close session.)
- Status via Badge (reused).
- Elapsed: `<span>Active for {formatElapsed(...)}</span>` — ticks.
- Resume: `<Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>`
- Close session: `<Button variant="danger" onClick={() => setConfirmClose(true)}>Close session</Button>` + ConfirmDialog reused. On confirm: `closeSession.mutate(session.id)`. On success → bar clears (mutation's onSuccess sets active cache to null). Also close dialog. Also while the mutation is pending, disable the button.

What if the active session is already closed (server could return a closed session as active? The mock sets closedAt and clears active on close. GET active could return a closed one if state was set manually). The bar's close button: the detail screen disables close when status==='closed'. Same for the bar: disable close when closed. Reasonable and consistent. Hmm — "deliver what's asked. Don't over-build." But consistency with existing close semantics (closed sessions can't be closed again; the endpoint would succeed anyway, idempotently setting closedAt) — the detail screen explicitly disables it. I'll disable it too. Small and consistent.

Wait, actually the endpoint `POST /sessions/:id/close` has no guard for already-closed in the mock (just sets closed). The detail disables it. For consistency: disable in the bar when `session.status === 'closed'`.

**Pending state for the bar:**

```ts
if (isLoading) return <p class="active-session-bar active-session-bar--pending">Loading active session…</p>
if (isError) return <p ...>Couldn't load the active session.</p>
if (!session) return null;
```

Hmm — but AppLayout is also used on... every authenticated screen. The bar's load shouldn't block the page. A small pending line is fine. But note: on initial load, every screen will show "Loading active session…" briefly. Acceptable.

Hmm wait, one more consideration: `isLoading` vs `isPending`: react-query v5 uses `isPending` (isLoading is an alias, still exported in v5 for back-compat? In v5, `isLoading` is deprecated in favor of `isPending`, but still available? The repo uses `isLoading` (e.g., `const { data, isLoading } = useOrders(...)`). In v5.59, `isLoading` is still exported (as `isPending && isFetching`? no...). Actually in v5: `isLoading` = `status === 'loading'` (renamed to `isPending` but `isLoading` kept as an alias). Yes, v5 keeps `isLoading` working. The repo uses it everywhere. I'll use `isLoading` to match the style.

**Elapsed tick hook:**

Let me write a small hook in the bar file:

```ts
function useTickingNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
```

And a formatter:

```ts
export function formatElapsedSince(iso: string, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${String(hours).padStart(2, '0')}h`);
  parts.push(`${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`);
  return parts.join(' ');
}
```

Hmm, the expected value in the test is "0m 10s" → let me simplify to a deterministic format. Let me pick: `Xd HH:MM:SS`? Or just always `Hh Mm Ss` with days folded in? For the test, I want a stable predictable string. The simplest deterministic: always show `d h m s` components with padding: `${days}d ${hours}h ${minutes}m ${seconds}s`. Test: startedAt = now-10s → "0d 0h 0m 10s". Advance 3s → "0d 0h 0m 13s". Clean, no conditional formatting.

But hmm, for the full-app ticking test, startedAt is a 2024 date → "97d 5h 42m 33s" — fine, the test uses findByText(/Active for \d+d \d+h \d+m \d+s/)? For the full-app tick test, I'd have to mutate sessions[x].startedAt anyway to get a known value...

Decision: the tick test uses `renderWithProviders(<ActiveSessionBar />)`, mutates the active session's `startedAt` to `Date.now() - 10_000` (fake timers on), and asserts the exact strings. Restore the date in finally/afterEach? The db mutation leaks across tests in the same file and across files (vitest default: separate module registry per test file → no cross-file leak. Within a file, subsequent tests should reset or not depend on it). Let me restore in an afterEach, or set it explicitly in each test that cares. Actually simpler: in the tick test, pick a session and set its startedAt. Other tests set their own expectations (name-based) that don't depend on startedAt, so... but they assert the bar text? "0d 0h 0m Xs" is not asserted elsewhere. OK, minor leak within the file is harmless, but to be clean, restore in that test's finally, or in afterEach... the repo style is minimal. Let me just restore within the test after assertions.

Wait, but note: `renderWithProviders(<ActiveSessionBar />)` — the bar uses `useNavigate` (Resume) → needs a router context: renderWithProviders provides a memory router. Good. It uses `useActiveSession` → query → MSW → needs `state.user` set. Good.

But — under fake timers, does MSW's node server respond? MSW intercepts `fetch` (node 20 global). Interception is async but resolves via microtasks/promises, not timers. React-query's `fetchStatus` is... the initial fetch is triggered in a post-mount effect → microtask → MSW resolves → microtask → setQueryData. All microtasks. `await screen.findByText(...)` — RTL's waitFor under fake timers: advances timers AND awaits. It should work. RTL's `findBy*` with fake timers: there's a known pattern that works in vitest with RTL when vi is detected. I'll trust it. Fallback risk: if `findByText` hangs under fake timers... To reduce risk, instead of findByText, we can use `await waitFor(() => expect(...))`? Same mechanism. Hmm.

Alternative to fully avoid fake timers: make the tick interval a parameter of the bar for tests? No — don't contort production code for tests... actually, a common defensible approach: the bar takes an optional `tickMs` prop? That's test-seam-ish. Iffy.

Let me think about whether RTL's waitFor reliably works with vitest fake timers. RTL 16's `waitFor` implementation (packages/testing-library/src/async.ts / wait-for.ts):

```ts
async function waitFor(callback, options) {
  ...
  if (
    typeof jest === 'undefined' &&
    typeof vi === 'undefined'  // hmm?
  )
```

Actually I recall the code:

```ts
const {jest = {}} = globalThis as {jest?: {advanceTimersByTime?: ...}}
...
if (typeof jest.advanceTimersByTime === 'function' || (typeof vi !== 'undefined' && typeof vi.advanceTimersByTime === 'function')) {
  ...fake timer mode: advance in 50ms chunks
}
```

Yes, RTL explicitly supports vitest fake timers (added around RTL 13/14: "Support fake timers with vitest"). `waitFor` will poll with 50ms fake advances. Our 1s interval will fire as it's advanced. And the initial data load: microtasks resolve. RTL's fake-timer waitFor also does `await new Promise(resolve => setTimeout(resolve, 0))`? Under fake timers that setTimeout is faked, but since it advances timers each loop, it's fine — each loop iteration advances 50ms, allowing both microtask flushes and timer firings.

One more thing: react-query v5 uses `setTimeout` for... in v5, the query fetch on mount is kicked off in a microtask (via `ensurePreventAccessKey`/schedule without a timer? there's an `updateTimers`... I recall v5 uses `setTimeout(..., 0)` in some scheduling (e.g., `onSettled`?). Hmm. If v5 schedules the initial fetch via a 0ms setTimeout, fake-timer mode advances 50ms per poll → the timer fires. OK, fine either way.

And the interval tick: faked → advances with waitFor's advances and explicit `vi.advanceTimersByTime(3000)`. After `vi.advanceTimersByTime(3000)`, the interval's callback runs → setState → React 18 batches → re-render is async? setState from a timer in React 18 is batched but the update is scheduled — with automatic batching via the scheduler, which uses `MessageChannel`... React 18's scheduler uses MessageChannel — is MessageChannel faked by vitest's fake timers? Vitest fakes: setTimeout, setInterval, clearTimeout, clearInterval, setImmediate, clearImmediate, Date, queueMicrotask?? — `queueMicrotask` is NOT faked by default. MessageChannel is NOT in the default fake list (can be via `fakeTimers.toFake: ['messagechannel']`? vitest supports faking 'performance', 'queueMicrotask', 'requestAnimationFrame', etc. MessageChannel isn't standardly faked). So React's scheduled update via MessageChannel (real) will fire asynchronously in real time → after `vi.advanceTimersByTime(3000)`, we need to `await` for React to flush → use `await waitFor(...)` / `findByText` which awaits real microtasks AND advances fake timers → the MessageChannel callback runs in real time (fast) → the render happens. Good — this works: `await screen.findByText('...13s')` with fake timers: each loop, advance 50 fake ms (firing our interval) AND await a real macrotask gap (letting MessageChannel flush). Should converge.

OK, I'm fairly confident. Let me write the tick test with fake timers, and if we want extra safety, use `findByText` (not a bare `expect` after the advance).

**Logout test:** renderApp('/sessions'), set user + activeSessionId, wait for bar, click "Log out" → logout clears queryClient and the server's state → redirect to /login → assert no bar. Note: AppLayout unmounts on redirect to login. Bar is gone. Assert the login screen appears and there's no bar text.

**Now, `sessionKeys.active` already exists** in queries.ts — `active: () => ['sessions', 'active'] as const`. Good, we'll use it (shared keys are used, not rewritten — we'll add `useActiveSession` to the same file, which is "used" and extending. The spec says shared types/API modules are used not rewritten. Adding a hook to features/sessions/queries.ts is a natural extension, not a rewrite. The API module already has getActiveSession — don't touch it. types.ts don't touch.)

**Changes to queries.ts:**

```ts
export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}
```

And `useCloseSession`'s onSuccess: also update the active cache:

```ts
onSuccess: (updated: Session) => {
  qc.setQueryData(sessionKeys.detail(updated.id), updated);
  patchLists(qc, updated);
  clearActiveIfMatch(qc, updated.id);
}
```

Where:

```ts
/** Closing a session ends its activeness: drop it from the active cache if it was the one. */
function clearActiveIfMatch(qc, id: string) {
  const active = qc.getQueryData<Session | null>(sessionKeys.active());
  if (active && active.id === id) qc.setQueryData(sessionKeys.active(), null);
}
```

Hmm, but should I also update active when notes are updated? No — notes don't change active.

What about `useUpdateSessionNotes`? No impact on active.

**Changes to AppLayout:**

```tsx
import { ActiveSessionBar } from '../features/sessions/ActiveSessionBar';
...
<main>
  <ActiveSessionBar />
  <Outlet />
</main>
```

Or between header and main? "The bar shows on every screen" — top area, above the content. I'll put it right after the header, above <main> — or inside main, above Outlet. The comment says "anything that needs to appear on every authenticated screen goes here, above the <Outlet />." So above the Outlet — put it as the first child of <main> (or between header and main). Either satisfies. Let me put it as the first child of <main> so the layout structure is preserved... actually the comment says above the Outlet. First child of main is above the Outlet.

**SessionDetailScreen changes:**

Add the active refetch:

```ts
const qc = useQueryClient();
useEffect(() => {
  // Opening a session makes it active on the server (GET /sessions/:id marks it).
  // Pull that fact back so the bar doesn't wait for the next refetch.
  if (session) void qc.refetchQueries({ queryKey: sessionKeys.active() });
}, [session, qc]);
```

Hmm wait — but there's a subtle ordering concern: `refetchQueries` with the default `refetchType: 'active'`. On the detail screen, the bar is mounted (AppLayout) → active query has an observer → active → refetches.

But also — on initial load of a deep-link to a detail: the session fetch marks active, and the refetch brings it into the bar.

Also when `session`'s identity changes on save (set detail data) → refetch active again (harmless).

Alternative: refetch only when the session ID changes... simpler to keep as [session]. The extra refetch on save is harmless (returns the same active).

Hmm, actually one more consideration: does this effect refetch on every mount even when the detail query was a cache hit (no server call → active didn't change)? Yes — a harmless refetch.

Wait, one more: the effect runs on initial `undefined`? Guarded by `if (session)`.

**Now — the "confirm on replacement" piece.** Let me re-verify with the existing blocker: `useBlocker(dirty)`. When the user navigates away from a dirty detail (to the list or anywhere), the blocker's dialog appears: "Leave with unsaved notes?" Leave/Cancel. That IS the confirm before the current session can be replaced by another. And "opening another" necessarily goes through leaving the current detail. So requirement 3 is met by existing machinery — and the spec says explicitly to use the existing dirty flag rather than adding a second source.

But hmm, wait. Let me re-read once more: "Opening another one replaces it, with a confirm first if the current one has unsaved notes."

Another scenario I dismissed: the operator is on the detail of A (which is active, dirty). Then... can they open B without leaving A? If the bar had a "switch" feature — it doesn't. So no.

But — one more: operator on A's detail, dirty. The bar shows A. Clicks the bar's "Close session" — that's a close, not a replace. Confirms there.

OK, I'm confident: reuse the blocker. In the diff, nothing new for requirement 3 — just tests proving the behavior (blocker → Leave → open B → bar is B. No blocker when clean).

Hmm, but "the existing suite continues to pass, unmodified" + "tests for the new behavior" — the new test file will cover the replacement confirm via the blocker. Good.

Wait, actually, hold on. Let me reconsider whether the "open" that makes active should also happen from the list row click, not just the detail load... The list row is a `<Link to>`. Navigation → detail mounts → fetch → server marks. Covered.

And deep link: same.

**"The bar appears on every authenticated screen and nowhere else"** — AppLayout only wraps authenticated routes (inside RequireAuth). Login screen is outside. ✓.

**Refresh survival** — the bar's data is from a query. On refresh, the QueryClient is fresh, the bar queries `/sessions/active` → server returns the persisted active. ✓ (The mock persists state module-level. In reality, the server persists.)

**Now let me write ActiveSessionBar:**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar... rendered by AppLayout on every
 * authenticated screen. The server (`GET /sessions/active`) is the source of
 * truth: a refresh brings the bar back, a logout (which clears the query cache
 * and the server's active session) empties it.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow();

  if (isLoading) return <p className="active-session-bar">Loading active session…</p>;
  if (isError) return <p className="active-session-bar">Couldn't load the active session.</p>;
  if (!session) return null;

  return (
    <section className="active-session-bar">
      <span className="active-session-bar__name">{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span data-elapsed>Active for {formatElapsedSince(session.startedAt, now)}</span>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button
        variant="danger"
        disabled={session.status === 'closed' || closeSession.isPending}
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

Hmm, the detail screen's dialog body: "Closing is final. Unsaved notes will be lost." For the bar: the session may have notes, but from the bar we don't know about unsaved ones (the detail is unmounted). Just "Closing is final." is fine.

`useTickingNow` — should it only tick when there's a session? Hook order: we must call the hook before the conditional returns! `useTickingNow` is a hook → must be called unconditionally before early returns. As written, it's called before the returns ✓ (navigate, confirmClose, now all before the if). Fine.

But ticking while pending/error is wasteful but harmless. Or gate the interval: `useTickingNow(Boolean(session))`? The hook signature: `useTickingNow(enabled = true)` with an effect that's a no-op when !enabled. Then the pending state also shows a `now` (unused). Let me gate it — cleaner: only tick when there's a session to show.

```ts
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}
```

Call: `const now = useTickingNow(session !== undefined && session !== null)` → just `Boolean(session)`. Hmm, but `session` might be undefined during load → enabled=false. OK.

Wait, `data`'s type is `Session | null | undefined`. `Boolean(session)` is fine.

**formatElapsedSince** — where to put it? Same file, exported for tests? The test asserts the rendered text. Exporting the helper for direct testing is also nice but the behavior test (rendered text changes) is better. Let me export it anyway? "Test behavior, not implementation" — I'll keep it internal (not exported) and test via rendered output. Hmm, but computing the expected string in the test: for the tick test with a controlled startedAt (now-10s), the expected values are "0d 0h 0m 10s" and "0d 0h 0m 13s" — no formatter import needed.

But note: rendering happens a little after `Date.now()` at test start (fake: the same frozen now? with fake timers, Date.now() is fixed at the fake "now" until advanced. renderApp's render happens synchronously in the test after the advance. `useTickingNow`'s initial `Date.now()` = the fake start. startedAt = fakeStart - 10s. First render: elapsed = 10s exactly (floor). Then each 1s advance → +1s. But the data load is async (MSW) → the bar first renders pending, then renders the session with `now` = the fake time at that render (advanced by waitFor's 50ms chunks). Uh-oh: if waitFor advanced, say, 150 fake ms before the data arrived, the first elapsed shown = 10.15s → floor 10s → "10s". Then advance 3000 → "13s". But if the advance between load and first paint was ≥1000ms, the first would be 11s!

Timing: fake-time advances only happen during waitFor's polling. The data load completes in microtasks (no fake timer needed) → the first waitFor loop: advance 50ms, flush microtasks → data arrives → render → findByText checks → if the text "0d 0h 0m 10s" is present (elapsed = floor((start+50 - (start-10000))/1000) = floor(10.05) = 10 ✓). As long as the total advance before the first successful match is <1000ms, the first text is 10s. waitFor will match on the first check after data renders → total advance ~50-100ms. Safe.

Then `vi.advanceTimersByTime(3000)` → interval fires 3 times (at 1s, 2s, 3s) → now = +3s → but wait, the last successful check of the first findBy may have advanced a little extra (up to 100ms). Elapsed = 13.0x → floor 13 ✓. Then `await screen.findByText('0d 0h 0m 13s')` — will advance a few more 50ms chunks during the search — could cross 14s if the previous check landed at 13.95s? Sequence: after advanceTimersByTime(3000), now = exactly start+3000 (assuming the first findBy ended at +~100ms... let me redo:

Let T0 = fake start. startedAt = T0 - 10000.
- First findByText('…10s'): loops: advance 50ms, check. Data arrives after the first microtask flush → at fake T0+50, the bar renders with elapsed floor((T0+50 - (T0-10000))/1000)=10 → match. Total advance: 50ms (or 100).
- advanceTimersByTime(3000): now = T0 + 50/100 + 3000.
- findByText('…13s'): elapsed = floor(3100.05+… hmm (T0+3050 - (T0-10000))/1000 = 13.05 → 13 ✓. Each loop advances 50ms: 13.10, 13.15… until React flushes the update from the interval that fired during advanceTimersByTime. The interval callback ran 3 times synchronously during advanceTimersByTime (fired at T0+550, 1550, 2550 — depending on phase) → each setNow → React update is scheduled via MessageChannel (real) → flushes on the real macrotask during findBy's awaits → then 13 shown. But the loops continue advancing fake time: 13.05, 13.10… we must match before 14.0s. React flush is fast (a real macrotask), while fake advance is 50ms per loop but real-time is also progressing (each loop awaits a real timeout? in fake-timer mode, does RTL advance and then `await null`? I think it does a real `await` (Promise microtask) — the real macrotask (MessageChannel) would eventually interleave. The risk of crossing 14s: the loop advances 50 fake ms per iteration. From 13.05 to 14.0 is 19 iterations. React's flush will happen well before then (the first real macrotask turn). Safe enough.

For extra safety, I could assert with a regex: `findByText(/0d 0h 0m 1[0-4]s/)`? Ugly. Or assert that the seconds changed: capture the initial full text, advance 3000, and waitFor a different text that matches the same d/h/m prefix with seconds +3... Let me just do two exact assertions. It's deterministic enough. Or, avoid the uncertainty: instead of `await findByText` before the advance, do:

```ts
await screen.findByText(/Active for/);          // bar has loaded, some elapsed shown
const first = (screen.getByText(/Active for/)).textContent;  // hmm
vi.advanceTimersByTime(5000);
await screen.findByText(/Active for/);           // still there
const second = screen.getByText(/Active for/).textContent;
expect(second).not.toBe(first);
```

But "not equal" is weak (could be a different reason). The convention says test behavior, not just that a call happened. A weak assertion is not good. Let me do the controlled-startedAt approach with exact strings. Actually — even more robust: set startedAt = T0 - 10s, wait for the bar to appear with any elapsed (`findByText(/Active for \d+d \d+h \d+m \d+s/)`), then... the "10s" base shifts with the advance before the load. Ugh.

Alternative: pause the uncertainty — the first check after data load: we can just grab the text and parse the seconds, advance 3s, expect seconds+3 (mod 60):

```ts
const el = await screen.findByText(/Active for .*s$/);
const before = Number(el.textContent!.match(/(\d+)s$/)![1]);
vi.advanceTimersByTime(3000);
await waitFor(() => {
  const s = Number(screen.getByText(/Active for .*s$/).textContent!.match(/(\d+)s$/)![1]);
  expect(s % 60).toBe((before + 3) % 60);
});
```

This handles any drift. But `waitFor` under fake timers advances more time — the seconds could exceed the target before the check... the check runs every 50 fake ms: the value monotonically increases: the check will see before+3 at the first check after 3s of fake time has elapsed (the value only reaches +3 exactly at the 3s mark, and the 50ms polling will catch it at some point where s == before+3 mod 60? The value at a check time is floor of elapsed seconds. It equals before+3 for a full 1s window → the poll (50ms) will land in it ✓ (unless it wraps 60→0: if before is 58, +3 → 61 → mod 60 = 1. The value 1 will appear 1s later — the check for (58+3)%60=1 will be true when the value is 1 ✓ since we compare with the same mod). Edge: while waiting for the match, we could pass through the target and come back after 60s — impossible (we catch it in the first 1s window). OK, this is robust. But a bit convoluted.

Let me just go with the controlled startedAt + exact strings — cleaner to read, and the timing analysis says it's safe. Actually, let me combine: controlled startedAt, `findByText('Active for 0d 0h 0m 10s')` first (safe per analysis: the load happens on the first 50ms poll... wait, is it guaranteed the load completes within the first 50 fake ms poll? Data load is microtask only → completes before the first poll's check (waitFor: advance 50ms, then `await` (microtask flush), then check? Order: check callback first, then advance? RTL's loop: `checkCallback()` then if not resolved, advance timers, sleep, repeat. The initial check happens before any advance — data isn't there (fetch is in-flight). Then advance 50ms + await → microtasks flush (MSW response → rq setState — rq's setState is scheduled via... react state updates from an async callback → React 18 batches → scheduled via MessageChannel (real) → needs a real macrotask → RTL's fake-timer waitFor sleep: does it do a real sleep or a fake one? If it only advances fake timers and awaits a microtask, the MessageChannel callback (real macrotask) won't run until a real macrotask turn — a `await Promise` gives a microtask, not a macrotask. Hmm! So the React update might not flush until a real macrotask runs. In the test, `await screen.findByText(...)` — the findBy's internal waitFor under fake timers: `await new Promise(resolve => setTimeout(resolve, 0))`? If that setTimeout is faked, the promise won't resolve until fake time advances — but each loop advances 50ms first, so it resolves within the loop. But between the loop iterations, real macrotasks (MessageChannel) can run only when the test awaits a real macrotask. `await <fake setTimeout promise>` → the promise resolves via a fake-timer fire → that's within our await chain, and after the promise resolves, control returns to the event loop which... the whole waitFor runs as a series of microtask-ish continuations with fake timer fires — real macrotasks (MessageChannel) are queued and will run when the event loop processes them — the event loop processes macrotasks between task boundaries. Our awaited chain yields control each `await` → the event loop can run MessageChannel. I think in practice this works (people test intervals with fake timers + RTL all the time). OK — trust the standard pattern: fake timers + `findByText` + `advanceTimersByTime` is a common working recipe in vitest+RTL.

Let me also double-check `useTickingNow`'s initial value: `useState(() => Date.now())` — under fake timers at T0. The bar renders pending first (session is undefined) — the hook is enabled=false, no interval. When data arrives (at T0+~50), re-render with session → but the interval effect: enabled just became true → the effect runs after that render → sets an interval starting from the current fake time (T0+50). The first tick is at T0+1050. The initial `now` state = T0 (from the useState initializer at the first render, which happened at T0) → elapsed at first session render: (T0+50 render time? no — the `now` state is still T0 until the first tick) → floor((T0 - (T0-10000))/1000) = 10 ✓ exactly. Then ticks add 1 each second.

Then advanceTimersByTime(3000) from that point: now = T0+3050 → elapsed 13.05 → 13 ✓.

But wait — the initial `useState(() => Date.now())` runs at the first render, which is... when does ActiveSessionBar first render? After the RequireAuth resolves me() (async!) → the whole app render is at T0+~50 too. All consistent: initial now ≈ T0±100ms. elapsed ≈ 10.05 → 10 ✓. Even ±500ms, floor is 10 (as long as drift < 1000ms) ✓.

Then after first findBy matches at ~T0+100: advance 3000 → now state: ticks fire at 1050, 2050, 3050 (relative to T0) → but the advance started at T0+100 → fires at T0+1050 (✓ within the 3000 window → T0+100..T0+3100): 1050 ✓, 2050 ✓, 3050 ✓ → 3 ticks → now = T0+3050 → elapsed floor((T0+3050)-(T0-10000))/1000 = floor(13.05) = 13 ✓.

The second findByText('13s'): the update from the tick at 3050 is flushed (via a real macrotask during the await) → found ✓. But during the second findBy's polling, fake time continues advancing 50ms per loop — the match happens on the first loop after flush. Even if it took, say, 10 loops (500ms), the elapsed = 13.55 → still 13 ✓ (need <14.0: 1050ms of extra polling — plenty).

Good. One more: the initial findBy('10s') — the polling: loops advance fake time: the data might arrive on loop 2 (T0+100), render, check: elapsed 10.1 → 10 ✓.

**The refresh test without fake timers** (real timers): fine.

**Now the AppLayout change** and the **detail screen change** and the **queries change** — the full files (I have to deliver every file the solution needs, complete, first line to last — for the files I'm modifying, I deliver the complete new contents. For files I'm not modifying, I don't deliver them ("do not restate files you are not changing").)

Files I'll deliver:
1. `src/app/AppLayout.tsx` (modified — bar slot)
2. `src/features/sessions/ActiveSessionBar.tsx` (new)
3. `src/features/sessions/queries.ts` (modified — useActiveSession, close clears active)
4. `src/features/sessions/SessionDetailScreen.tsx` (modified — refetch active on open)
5. `src/features/sessions/ActiveSessionBar.test.tsx` (new tests)

Also `src/test/render.tsx`? Only if I need the router... in my chosen test flows, I navigate via UI clicks (nav link, row link) — no router object needed. renderApp is unmodified ✓.

Wait — the "Replacement" test: from detail A, click nav "Sessions" → blocker. Nav link name: `getByRole('link', { name: 'Sessions' })` — there are 2 links named "Sessions" (nav "Sessions" and... the list screen has an h1 "Sessions" (not a link). The nav link is a link. Also the session name links ("Inspection 1") are links with different names. On the detail screen: nav links "Sessions" and "Orders". So `getByRole('link', { name: 'Sessions', exact: true })` → 1 match ✓ (the h1 is not a link).

Then after Leave → on list → click link "Inspection 2" → detail B. Bar shows "Inspection 2". Also assert that during the blocker the dialog text "Leave with unsaved notes?" is shown (confirm before replacement).

Also a negative control: leaving clean → no dialog, then open B → bar B. Consolidate: test A (dirty → dialog), test B (clean → no dialog, replacement).

Hmm — for the "clean" test: on detail A, don't type. Click nav Sessions. No dialog. List. Click Inspection 2. Detail B. Bar "Inspection 2". Assert `queryByText('Leave with unsaved notes?')` is null throughout — well, just assert after navigating to the list that the dialog is absent.

**Close from the bar test:**

renderApp('/orders')? The Orders screen needs orders to load — fine. Or '/sessions' (list). On list, bar shows the active. Click "Close session" → dialog "Close this session?" (the title appears in both the detail and bar dialogs — but the detail screen isn't mounted here, so unique) → click "Close session" confirm button — note: two buttons with the name "Close session" (the bar's + the dialog's confirm). Use `within(dialog)`? RTL's `screen.getByRole('dialog')` → `within(dialog).getByRole('button', { name: 'Close session' })`. The dialog has role="dialog" (aria-modal, aria-label=title). ✓

After confirm: mutation → server closes, clears active → mutation onSuccess: set detail cache (not cached, fine), patchLists (the list page is cached → patches the row's status to closed), clearActiveIfMatch → active cache = null → bar unmounts. Assert: the bar name is gone. `expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument()`? Wait, the list also shows "Inspection 1" (the row link)! The bar's name span and the list row's link both have the text "Inspection 1". So queryByText will find the list row. We need to assert the bar itself is gone: query by the "Active for" text → null ✓ (only the bar renders "Active for"). And/or assert the dialog is gone, and that the session's status is closed on the db (`sessions.find(id).status === 'closed'`) — a behavior-level assertion that the endpoint was called. And the list row's badge now shows 'closed'? The list patch updates the row's badge text → but 'closed' may appear in the filter option too ("closed" option). The Badge renders a `<span class="badge" data-tone>` — I could assert `screen.getByText('closed', { selector: '.badge' })`? Hmm, keep it simple: assert the "Active for" is gone + the dialog is gone + db status is closed.

Also assert the confirm cancel path? "with confirm" is tested by the presence of the dialog. Cancel → still there. Let me add a small assertion: cancel first, bar still present. Good behavior coverage (cancel = no change).

**Login/no-auth test:** no user, renderApp('/login') → the login form. Assert the "Active for" is not present, and no bar. Also "nowhere else" — the bar exists only inside AppLayout. Structural. This test verifies absence on the login screen.

Wait — with no user, RequireAuth: loading true → "Loading…" then no user → Navigate /login. The /login route is LoginScreen (no AppLayout) ✓.

**Logout test:** user set, activeSessionId set, renderApp('/sessions'). Wait for bar ("Active for"). Click "Log out" → logout API → state.user=null, state.activeSessionId=null. queryClient.clear() → auth setUser(null) → RequireAuth → /login. Assert login form visible (e.g., "Sign in" button) and no "Active for".

Note: after logout, the bar's query cache is cleared — even if the component were to remount... it unmounts anyway. ✓

**Refresh test:**

```ts
state.user = {...}; state.activeSessionId = null;
const first = renderApp('/sessions');
// Open s-001 from the list
await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
await waitFor(() => expect(screen.getByText(/Active for/)).toBeInTheDocument());
first.unmount();
// A fresh app instance = a refresh: new query cache, same server.
renderApp('/sessions');
await waitFor(() => expect(screen.getByText(/Active for/)).toBeInTheDocument());
expect(screen.getByText('Inspection 1', ...)).toBeInTheDocument(); // bar's name
```

Hmm — after unmount and re-render, `screen` queries: screen always references the latest render? RTL's screen is bound to document.body — after unmount, body is empty. After the new render, queries hit the new tree. But wait: the name "Inspection 1" appears in both the bar AND the list row → ambiguous. Assert the bar by "Active for" + a name within the bar? The bar's name span — we could query by text 'Inspection 1' and expect multiple → toBe...? Use `within`? Give the bar a semantic role? `<section>` with aria-label? I could give the bar an `aria-label="Active session"` — then `screen.getByRole('region'?` — a section with an aria-label gets role 'region'. Then `within(screen.getByRole('region', { name: 'Active session' }))`. That's clean and accessible. Let me add `aria-label="Active session"` on the section... but the pending/error `<p>`s too — same label? Give them a class only, fine (tests target the loaded state).

Hmm wait, note: in the refresh test, after re-render at '/sessions', the list row "Inspection 1" link exists AND the bar's name text. With the region approach: `const bar = screen.getByRole('region', { name: 'Active session' }); expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();` ✓ unambiguous.

And in other tests, we can use the region too for precision:
- Close test: bar region present, within it, click Close session... `within(bar).getByRole('button', { name: 'Close session' })`.

Actually simpler to just click via screen since the dialog is the only other "Close session" button. Fine.

But note: `role="region"` requires an accessible name — `<section aria-label>` → yes, ARIA: section with an accessible name = region. ✓

Let me add `aria-label="Active session"` to the bar section.

**Pending test:** "A failed fetch must not be rendered as 'no active session'." Error test:

```ts
state.user = ...; state.activeSessionId = 's-001';
server.use(http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
renderApp('/sessions');
await screen.findByText(/Couldn't load the active session/);
```

Assert no bar: `expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();` — a failed fetch doesn't render as "none"... the absence of the region + the presence of the error message = a distinct state ✓.

Pending test: hard to catch the transient pending state (resolves fast). We could use a never-resolving handler: `server.use(http.get('/api/sessions/active', () => new Promise(() => {})))` → bar shows "Loading active session…" persistently:

```ts
server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
renderApp('/sessions');
await screen.findByText(/Loading active session/);
```

Hmm — but the MSW handler returning a promise that never resolves: MSW awaits it forever → the request hangs → rq is pending ✓. `onUnhandledRequest: 'error'` — the handler matches so it's handled ✓. afterEach's resetHandlers clears it ✓. This tests the pending state. Is it worth it? The spec explicitly says: "handle the active session query's pending and error." A test for each = good behavior coverage. Let me include it.

Note: the pending `<p>` — the list screen also has a "Loading…" p (different text "Loading…" vs "Loading active session…"). Distinguishable ✓. Wait, the list loads fine (only /sessions/active hangs) → the list renders rows. The bar's pending p is present. findByText('Loading active session…') ✓.

**Now — the detail screen refetch and the StrictMode note:** the effect double-fires → refetches twice → fine.

**Does the refetch-on-open affect the existing list test?** renderApp('/sessions') — the detail screen isn't mounted → no. ✓ The list test is unmodified and passes (we didn't touch the list screen or its query).

**One more regression check — "logout clears all state":** queryClient.clear() — the active query is cleared ✓. Also the server clears activeSessionId (mock) ✓.

**"Direct deep link to detail URL":** renderApp('/sessions/s-002') → RequireAuth waits for me ✓ (no change). Detail loads → marks active (if not closed) → refetch active → bar ✓. We can fold this into a test: deep-link test: activeSessionId=null, renderApp('/sessions/s-005'), bar shows "Inspection 5". s-005: status = (['open','paused','closed'])[5%3=2] = 'closed'!! closedAt set. GET /:id on closed → does NOT mark active. So the bar should NOT show s-005. Pick s-004: 4%3=1 → 'paused' ✓ marks active. Or s-002 (2%3=2 → closed) no. s-003 (3%3=0 → open ✓). Let me use s-003 ("Inspection 3").

Note: the `notes: i % 4 === 0 ? 'Awaiting parts.' : ''` — s-003 (i=2) notes '' fine.

Wait, the id mapping: `s-${String(i+1).padStart(3,'0')}` with i from 0 → s-001 is i=0. Inspection N ↔ i=N-1 ↔ status index (N-1)%3.
- s-001: open, notes 'Awaiting parts.' (i%4==0)
- s-002: paused
- s-003: closed
- s-004: open
- s-005: paused
- s-006: closed

So for an openable (non-closed) session: s-001 (open), s-002 (paused), s-004 (open), s-005 (paused).

Deep-link test: s-004 → "Inspection 4" ✓.
Replacement test: A = s-001 (dirty), B = s-004? List page 1 shows s-001..s-010. Click "Inspection 4" link ✓. But note: A's detail is cached when we return to the list — fine.

Hmm wait, in the replacement test, after leaving A (discarding notes) and opening B: B's detail fetch marks active=B → refetch → bar B ✓.

Also the bar's "resume" test: on the list (or orders), bar shows A. Click "Resume" → navigate to detail A → assert h1 "Inspection 1" / the detail is rendered. Use the screen heading: the detail renders `<h1>{session.name}</h1>` → `await screen.findByRole('heading', { name: 'Inspection 1' })` ✓.

Now, the tick test via renderWithProviders(<ActiveSessionBar />): AuthProvider's me() → user set ✓. The bar queries active ✓. MSW: default handlers ✓.

Hmm — one concern: `renderWithProviders` renders `ui` at path '/' with a memory router — ActiveSessionBar uses useNavigate — inside RouterProvider ✓.

**Also — the `useCloseSession` change and existing detail close behavior:** the detail's close dialog uses the same mutation. Adding the active-clear in onSuccess — if you close from the detail, the bar also clears (server clears active if it was that session) ✓ consistent.

**patchLists on close** — no change.

**Let me re-check the `clearActiveIfMatch` typing:** `qc.getQueryData<Session | null>(sessionKeys.active())`. sessionKeys.active() returns a readonly tuple `['sessions','active']` — getQueryData accepts a QueryKey ✓.

**Now let me write the tests file** — `src/features/sessions/ActiveSessionBar.test.tsx`:

Repo test style: `import { screen, waitFor } from '@testing-library/react'; import userEvent from '@testing-library/user-event'; import { describe, expect, it } from 'vitest'; import { state } from '../../mocks/db'; import { renderApp } from '../../test/render';`

Additions needed: `within`, `renderWithProviders`, `http`/`HttpResponse` from msw, `server` from mocks, `sessions` from mocks/db, `vi`, `afterEach` maybe, `ActiveSessionBar` import.

Note: the existing setup has `server.resetHandlers()` in afterEach — my `server.use(...)` overrides reset ✓. But `state` (activeSessionId, user) is NOT reset between tests — each test sets what it needs. And `sessions` db rows: my tick test mutates startedAt. The close test mutates a session's status (s-004 → closed!) — cross-test contamination within the file: vitest runs test files in isolation (fresh module graph per file) but tests within a file share the module. So after the close test closes s-004, a later test that opens s-004... my tests: let me order carefully or reset. Best: at the top of the describe, restore the db? The repo style doesn't reset (their db is immutable). Since I mutate, I should restore. Options:
- In the close test: restore `s.status = 'open'` (original) and closedAt null after the assertions.
- In the tick test: restore startedAt.

Or avoid mutation in the close test: close s-004, and subsequent tests don't depend on s-004's status... but the replacement test opens B=s-004 as active — if it's already closed (from the earlier close test), GET /:id won't mark it active → the bar won't show B → test fails! So either order matters or we restore. Restore is cleaner. Let me restore in the test that mutates (close: status/closedAt. tick: startedAt).

Actually — the close test could use s-005 (paused) instead to spread out. But any mutation needs a restore for safety. Let me restore.

Also the state.activeSessionId: set per test. After the logout test, it's null. Others set their own ✓.

Let me also re-check the user flow for the "Replacement (dirty)" test with the blocker dialog: blocker's confirmLabel="Leave", cancel "Cancel". Click "Leave" → proceed → list. Then the bar should still show A (active unchanged — the notes were discarded, but the session is still open/active on the server) — actually interesting: after discarding unsaved notes and opening B, B replaces. Before opening B, the bar = A ✓. Assert the bar still shows "Inspection 1" on the list? A nice assertion that leaving didn't end it. Then click Inspection 4 → bar "Inspection 4".

And assert the dialog appeared before leaving: after clicking nav Sessions (dirty), `await screen.findByText('Leave with unsaved notes?')` — the dialog title h2. ✓ Then click button "Leave".

**Timing of the dirty flag**: type into the textarea with userEvent.type — the textarea is inside label "Notes" → `screen.getByLabelText('Notes')`. userEvent.type appends → notes !== session.notes ('') → dirty ✓.

**Now, the full test for resume**: after clicking Resume, assert the detail h1. The detail screen also mounts its own dialog (the blocker is inactive). Fine.

Also — potential flakiness: the "Resume" button name is unique ✓.

**Let me also reconsider: should `useActiveSession` refetch when the window regains focus / on interval?** Not asked. The bar's elapsed ticks client-side from startedAt. Fine.

**The bar on the orders screen?** The spec says "every authenticated screen" ✓ via AppLayout.

**Edge: active session is null (never opened / closed / logged out):** bar absent ✓.

**Now — let me write the final files.**

### 1. `src/features/sessions/queries.ts` (full, modified)

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
 * The single active session, straight from the server. `GET /sessions/active`
 * is the source of truth: the query cache is its only client home, so a page
 * refresh brings the active session back from the server, never from storage.
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
      clearActiveIf(qc, updated.id);
    },
  });
}

/**
 * Closing a session ends its activeness on the server. If it was the active
 * one, write that fact into the cache instead of waiting for a refetch.
 */
function clearActiveIf(qc: ReturnType<typeof useQueryClient>, id: string): void {
  const active = qc.getQueryData<Session | null>(sessionKeys.active());
  if (active !== null && active !== undefined && active.id === id) {
    qc.setQueryData(sessionKeys.active(), null);
  }
}
```

Keep patchLists the same.

### 2. `src/features/sessions/ActiveSessionBar.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar. AppLayout renders it above the <Outlet />,
 * so it is on every authenticated screen and nowhere else.
 *
 * The server is the source of truth (GET /sessions/active): a full refresh
 * brings the bar back from the API, and logout — which clears the query cache
 * and the server's active session — empties it. Nothing here is persisted to
 * client storage.
 *
 * Pending and error are shown as their own states: a failed fetch is not the
 * same as "no active session", and the operator should be able to tell them
 * apart.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(session !== null && session !== undefined);

  if (isLoading) {
    return <p className="active-session-bar">Loading active session…</p>;
  }
  if (isError) {
    return <p className="active-session-bar">Couldn't load the active session.</p>;
  }
  if (session === null || session === undefined) return null;

  return (
    <section className="active-session-bar" aria-label="Active session">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>Active for {formatElapsedSince(session.startedAt, now)}</span>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={session.status === 'closed' || closeSession.isPending}
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

/** Ticks once a second so the elapsed time in the bar advances on its own. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function formatElapsedSince(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}
```

Hmm — `useTickingNow(session !== null && session !== undefined)`: while loading, data is undefined → disabled ✓.

Wait, the `data` type: `Session | null | undefined`. `session !== null && session !== undefined` = `session != null`. Let me write `session != null` — hmm, strict mode allows != null. The repo style... they use `session !== undefined` in the dirty flag. Let me just use `session != null`. Fine.

### 3. `src/app/AppLayout.tsx`

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

### 4. `src/features/sessions/SessionDetailScreen.tsx`

Add: `useQueryClient` import. `sessionKeys` import. The effect.

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
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const queryClient = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  useEffect(() => {
    // Opening a session marks it active on the server (GET /sessions/:id).
    // Pull that fact back so the bar reflects the open without waiting for
    // the next scheduled refetch.
    if (session) void queryClient.refetchQueries({ queryKey: sessionKeys.active() });
  }, [session, queryClient]);

  // The dirty flag. ... (unchanged)
  ...
}
```

Wait — the refetch effect depends on `session` — it will also fire when notes save updates the detail cache (new session identity) → refetch active (harmless, returns the same). And when the session first loads ✓. OK.

Hmm, one consideration: `refetchQueries` default is `refetchType: 'active'` — is that right? In v5, `refetchQueries({ queryKey })` → refetches matching queries... the default refetchType is 'active'. The bar's observer is active (mounted) on any authenticated screen including the detail screen ✓.

### 5. Test file.

Let me write it carefully.

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp, renderWithProviders } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

describe('ActiveSessionBar', () => {
  it('shows the active session on another screen, and resume navigates to the detail', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });
  });
```

Wait — the orders screen: `renderApp('/orders')` → orders list loads (31 orders) ✓. The h1 on detail "Inspection 1" — heading role name 'Inspection 1' ✓. Note: the bar also contains the text "Inspection 1" (not a heading) ✓ no conflict.

Badge text 'open' — within(bar) scope ✓.

```tsx
  it('closes the active session behind a confirm and empties the bar on success', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('region', { name: 'Active session' })).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    await userEvent.click(within(screen.findByRole('dialog', { name: 'Close this session?' })).then(d => within(d).getByRole('button', { name: 'Close session' })));
```

Hmm — findByRole returns a promise. Can't inline. Let me do:

```tsx
    const openDialog = async () => {
      await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
      return screen.findByRole('dialog', { name: 'Close this session?' });
    };
```

Wait, but there are two "Close session" buttons in the document after the first confirm? No — the dialog is cancelled (closed) first. Sequence: open dialog → cancel → dialog gone → bar still there → open dialog again → confirm. After cancel, `ConfirmDialog open=false` → null ✓. So on the second open: the button named "Close session" — the bar's (enabled) and the dialog's confirm "Close session" → use within(dialog) ✓.

```tsx
    const s = sessions.find((x) => x.id === 's-004')!;
    const originalStatus = s.status;
    const originalClosedAt = s.closedAt;
    ...
    await userEvent.click(within(dialog2).getByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());
    expect(s.status).toBe('closed');
    expect(screen.queryByText('Inspection 4', ...)) // the list still shows the row; skip
    s.status = originalStatus; s.closedAt = originalClosedAt;
```

Wait — the s-004 original status is 'open' (i=3, 3%3=0 → open ✓). closedAt null.

Also assert that the list row's badge updated to 'closed'? patchLists did that. `within(screen.getByRole('table')).getByText('closed')`? The table has 10 rows. Row 4's badge 'closed'. `screen.getByText('closed', { selector: '.badge' })`? Only row 4's badge is 'closed' (others: i=0 open, 1 paused, 2 closed!! — i=2 → s-003 is closed!). So 'closed' badge appears twice (s-003 and s-004) → getByText fails (multiple). Skip that assertion. The db assertion + bar clearing is enough (behavior: the endpoint was called and the bar cleared).

Hmm, "never just assert that a call happened" — we're asserting observable results: the bar is gone, the server row is closed ✓.

Also note: the bar's region is asserted to still be present after cancel ✓ (cancel = no change).

```tsx
  it('asks to confirm before a dirty session is replaced, and replaces once the operator leaves', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    // On the detail of the active session. The bar already shows it.
    await screen.findByRole('region', { name: 'Active session' });

    // Make it dirty.
    await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');

    // Leaving for the list (the only way to open another session) must confirm first.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await screen.findByText('Leave with unsaved notes?');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    // Leaving did not end the session: it is still the active one.
    expect(screen.getByRole('region', { name: 'Active session' })).toBeInTheDocument();

    // Opening another session replaces it, without a second confirm (the
    // notes were already consciously discarded).
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 4')).toBeInTheDocument(),
    );
  });
```

Wait — the blocker: `useBlocker(dirty)` — on click of the nav link, the router attempts navigation. The blocker blocks → the dialog appears. Click "Leave" → proceed → list renders. ✓

Note: after proceeding to the list, is the dialog gone? blocker.state → unblocked → dialog null ✓.

But hmm — the `screen.getByRole('heading', { name: 'Sessions' })`: the list's h1 "Sessions" ✓. But the nav link "Sessions" is not a heading ✓.

Then click "Inspection 4" (a list row link) → detail s-004 → fetch marks active → refetch → bar updates to Inspection 4. `waitFor` + within the region ✓.

Note: the detail s-001 was dirty. After proceed, the unmount discards the local notes. The server's s-001 notes unchanged ('Awaiting parts.') — irrelevant.

Another note: after opening s-004's detail, the bar's region shows "Inspection 4". But the detail's h1 also says "Inspection 4" — scoped by within(region) ✓.

Also: `userEvent.type` into the textarea — the textarea is labeled "Notes" via a wrapping `<label>` ✓ getByLabelText('Notes') ✓.

The clean replacement variant:

```tsx
  it('replaces the active session without a confirm when there are no unsaved notes', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));

    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 4')).toBeInTheDocument(),
    );
  });
```

Hmm — after the clean leave, immediately `queryByText` — the navigation is synchronous (memory router). The dialog should not have rendered. But timing: the blocker is not engaged (dirty false) → no dialog ✓. But a race: the click triggers navigation. The list mounts. The dialog never renders. The check right after the click (userEvent.click is async and awaits) is fine.

Wait, subtle: the "clean" test's s-001: notes = 'Awaiting parts.' — the notes textarea is initialized to that. dirty=false ✓.

```tsx
  it('brings the bar back from GET /sessions/active after a full reload', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    const first = renderApp('/sessions');

    await screen.findByRole('link', { name: 'Inspection 1' });
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await screen.findByRole('region', { name: 'Active session' });
    first.unmount();

    // A fresh client: new query cache, same server. The bar must come back
    // from the API, not from anything the first client stored.
    await screen.findByRole('region', { name: 'Active session' });  // ← wrong: need to render the new app first
```

Fix:

```tsx
    first.unmount();
    renderApp('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
```

Note: after the first unmount, the `screen` queries reference the (now empty) body. The new render → the region appears via findBy ✓.

Note: the first client opened s-001 via the list click → server marked active (s-001 is open ✓). After unmount, the server state persists (module-level) ✓.

```tsx
  it('deep-links to a detail and makes that session active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });
```

s-004 open ✓.

Wait — is the deep-link test redundant with the refresh test? Slightly different: no "open from list" step. It directly tests that the detail fetch marks active. Keep — it's cheap.

Hmm — actually a potential issue: in the deep-link test, RequireAuth shows "Loading…" until me() resolves, then the outlet. The detail fetch and active fetch run. The bar's region appears once the active query resolves with s-004 ✓.

But — order: the active refetch is triggered by the detail's effect after the session loads. The initial active fetch (on bar mount) may resolve with null (before the detail fetch marks it). Then the refetch → s-004 ✓. findByRegion waits for the region (only rendered when session is non-null) → appears after the refetch ✓.

```tsx
  it('shows a pending state while the active session loads', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => new Promise<never>(() => {})),
    );
    renderApp('/sessions');
    await screen.findByText('Loading active session…');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

Hmm, `new Promise<never>(() => {})` — the MSW handler returning a never-resolving promise → the request never responds → rq stays pending ✓. TS: the handler's return type expects Response | Promise<Response> | null | undefined... `Promise<never>` is assignable to `Promise<Response>`? `Promise<never>` is assignable to `Promise<Response>` ✓ (covariance, never is a bottom type). ✓

But note: the list's queries still resolve (other handlers) → the list renders. The bar's pending p ✓.

Note — `onUnhandledRequest: 'error'`: the handler is matched (same path) ✓.

```tsx
  it('does not render a failed active-session fetch as "no active session"', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');
    await screen.findByText('Couldn't load the active session.');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

✓ (500 → ApiError thrown → isError. retry: false ✓.)

```tsx
  it('is not on the login screen', async () => {
    state.user = null;
    renderApp('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
  });
```

Note: no user → /login. Also — if a previous test left activeSessionId set, that's irrelevant (not authed) ✓. But `state.user = null` — the RequireAuth's me() → 401 → user null → login ✓.

```tsx
  it('is cleared by logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    await screen.findByRole('region', { name: 'Active session' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

✓ logout → clear() + server resets → /login.

And the tick test:

```tsx
  it('ticks the elapsed time', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const s = sessions.find((x) => x.id === 's-002')!;
    const originalStartedAt = s.startedAt;
    s.startedAt = new Date(start - 10_000).toISOString();

    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    try {
      renderWithProviders(<ActiveSessionBar />);
      await screen.findByText('Active for 0d 0h 0m 10s');
      vi.advanceTimersByTime(3_000);
      await screen.findByText('Active for 0d 0h 0m 13s');
    } finally {
      s.startedAt = originalStartedAt;
      vi.useRealTimers();
    }
  });
```

Concern: `renderWithProviders` with fake timers — AuthProvider's `api.me()` fetch: MSW responds via microtasks ✓. The first findByText('10s'): as analyzed ✓.

But wait — `Date.now()` under fake timers: the `start` captured after useFakeTimers = the faked current time (real-time-based). s.startedAt is computed from that ✓. `useTickingNow`'s initial `Date.now()` = the fake time at the first render (≈start) ✓. elapsed = floor((renderNow - (start-10000))/1000). renderNow - start = the fake advance before the first session render (~50-150ms) → 10.05-10.15 → 10 ✓.

Risk: if the data load took >900 fake ms of polling before the first render with session → elapsed 11 → findBy('10s') would never match → timeout (does the fake-timer timeout also advance? RTL's fake-timer waitFor advances until the real timeout? Under fake timers, the internal timer for `timeout` is faked — the waitFor's own timeout won't fire without an advance... does RTL handle this: in fake-timer mode, it throws after `timeout/interval` advances? I recall RTL's fake-timer waitFor advances and counts against the timeout in fake time → it will eventually time out (throwing) rather than hang forever). Either way, if our assumption breaks, the test fails clearly rather than hanging. Per the analysis, the load is microtask-only → resolves on the first loop. I'm comfortable.

Actually, hmm, one more: react-query v5's initial fetch — is it synchronous on mount, or scheduled via a timer? In v5, on mount, if there's no data, it triggers a fetch via `fetch` in the `onMount` — I think it's called directly (not via a setTimeout). Even if it were a setTimeout(0), the fake-timer waitFor's 50ms advance would fire it ✓.

And the interval: starts when `enabled` becomes true (the first render with session) → after that render, at the fake time of that moment (T1 = start + ~100ms). Ticks at T1+1000, T1+2000, T1+3000. We advance 3000 from the moment the first findBy resolved (≈T1, maybe +100ms) → T1+3000+100 → ticks fired: T1+1000 ✓, +2000 ✓, +3000 ✓ (T1+3100 > T1+3000) → now = T1+3000 → elapsed = floor((T1+3000 - (start-10000))/1000). T1-start ≈ 100 → (3100 + 0.1... wait (T1+3000) - (start-10000) = 3000 + 10000 + (T1-start) = 13000+100 = 13100ms → 13 ✓. If T1-start were, say, 950ms (slow load) → the first findBy would show 10.95 → 10 ✓ still. The second: 13.95 → 13 ✓. Up to T1-start < 1000, we're fine both. And the second findBy's polling adds 50ms chunks: 13.95+0.05... → could reach 14.0 after 10 chunks if the React flush took that long — flush is on the first real macrotask (MessageChannel) ≈ 1ms real time. The polling loop's iterations are real-time fast (each iter = microtask + fake advance). 10 iterations happen in <1ms real time — the MessageChannel callback would likely run after the first await (since the event loop processes the next macrotask after our microtask chain yields...). Hmm, the waitFor loop: `check → advanceTimersByTime(50) → await new Promise(setTimeout 0 [faked])`. The faked setTimeout(0) resolves when fake time advances — but the loop advances before the await? Order: advance, then sleep (fake setTimeout(50? or 0))... the sleep's promise resolves only when the loop advances again — so the loop structure: [check][advance][sleep-fake][check][advance]... — is there any real macrotask between checks?? If every await resolves from the same fake advance, the whole loop could run in one macrotask turn?? No — a `await` of a promise that resolves in a future fake-timer callback requires the loop to: schedule, then advance time (synchronously), which fires the callback, which resolves the promise, then a microtask continuation. That's all within one synchronous stretch + microtasks — no macrotask boundary → React's MessageChannel scheduled update would not flush during the loop?!?

Hmm wait, but that contradicts the widespread use of fake timers with RTL... let me think again. RTL's fake-timer waitFor (from source, wait-for.ts):

```ts
function checkRealTimersCallback... 
// inside the loop:
if (fakeTimers) {
  advanceTimersByTime(interval);
  await new Promise(resolve => setTimeout(resolve, 0));  // hmm
}
```

Actually I recall the real implementation:

```ts
while (true) {
  checkCallback();
  if (resolved) break;
  if (fakeTimersType === 'modern') {
    advanceTimersByTime(interval);
  }
  await sleep(interval);   // sleep uses real setTimeout
}
```

Where `sleep` = `new Promise(resolve => setTimeout(resolve, ms))` — if setTimeout is faked, this sleep resolves only when fake time advances... but the advance happens at the top of the next loop iteration — a deadlock? No wait — sinon's fake timers: setTimeout schedules at now+50. The loop awaits the promise. Nothing runs (microtasks only). Deadlock!

So RTL must be doing something else. Let me recall the actual RTL source (v16, packages/@testing-library/dom/src/wait-for.ts):

```ts
const {
  jest = {},
} = globalThis as {jest?: {advanceTimersByTime?: (ms: number) => void}}

...
async function waitFor(callback, options) {
  ...
  const {jest = {}} = globalThis
  const fakeTimersApi = jest.advanceTimersByTime ? jest : ...
```

Honestly I don't remember exactly. But empirically: vitest + fake timers + RTL's `waitFor`/`findBy*` is a documented, working combination (vitest docs themselves show an example with fake timers and testing-library). Vitest docs "Timers" example:

```ts
vi.useFakeTimers()
...
await waitFor(() => {...})  // hmm
```

Actually vitest docs' fake timer example uses `vi.advanceTimersByTime(1000)` then `await vi.runAllTicks()`? The documented recipe:

```ts
it('fires', () => {
  vi.useFakeTimers();
  ...
  vi.advanceTimersByTime(1000);
  expect(fn).toHaveBeenCalled();
});
```

For RTL, the common working recipe is: `vi.useFakeTimers(); render(...); act(() => { vi.advanceTimersByTime(1000); });` — wrapping in `act` to flush React. And findBy* under fake timers: I recall a GitHub issue "findBy with fake timers hangs" — resolved by RTL detecting fake timers and using them... let me recall RTL's source more concretely. From @testing-library/dom v10's wait-for.ts:

```ts
function waitFor(callback, options) {
  ...
  return new Promise((resolve, reject) => {
    ...
    function checkCallback() {...}
    function onTimeout() {...}
    // setInterval-based polling:
    const intervalId = setInterval(...)? 
```

No... the actual implementation (I've read it before): uses `setTimeout` recursion:

```ts
async function waitFor(callback, options) {
  ...
  if (typeof jest !== 'undefined' && typeof jest.advanceTimersByTime === 'function') {
    ... // fake timers path
  }
}
```

I recall: the fake-timers path replaces the timeout/interval mechanism: it loops `check(); jest.advanceTimersByTime(interval); await new Promise(r => process.nextTick(r))`? Something that yields to a real macrotask/tick. The key requirement: yield to real time so that faked scheduled callbacks (including React's? no, React uses MessageChannel) can...

OK, I'm going too deep into uncertain memory. Let me make the tick test robust to this uncertainty: avoid `findBy*` for the post-advance value. Instead use `act` + a direct assertion:

```ts
await screen.findByText('Active for 0d 0h 0m 10s');  // pre-advance load (works if findBy works pre-advance... same concern)
```

Hmm, the pre-advance findBy has the same concern (the data load is microtask-only — if the loop yields a real macrotask (even just a microtask flush), React's update flushes... React 18's setState from a microtask outside of React event → scheduled via the scheduler → MessageChannel → a real macrotask). So even the first findBy needs a real macrotask yield.

Let me sidestep entirely: don't use findBy in the tick test. Use `waitFor`? Same mechanism.

Alternative robust approach: no fake timers. Instead, make the tick interval short? No — production is 1s.

Alternative: test the tick logic without RTL timing: render the bar, wait for it to load (real timers, findBy — reliably works with real timers), capture the elapsed text. Then advance real time ~1.1s via `await new Promise(r => setTimeout(r, 1100))` (real) and assert the seconds increased (parse). A real 1.1s sleep in tests — slow but reliable and simple. The vitest suite is already real-time (userEvent). A +1.1s test is acceptable.

But "ticking" via real time: the interval fires at 1s, 2s... after 1.1s, now = +1 or +2 s → seconds = before+1 (or +2 if the phase aligned). Parsing: extract seconds s1. Wait 1.2s. s2. Expect s2 === (s1+1) % 60 || s2 === (s1+2) % 60? Ugly. Better: wait exactly between ticks... can't control the phase.

Cleaner: capture the full "Active for X" text at t0 and at t0+2.2s — the string must have changed (a full 2.2s span covers at least 2 ticks; the displayed value changes with each tick unless the seconds wrap in a way that the two samples coincide — impossible: samples 2.2s apart. The value changes every second. Two samples 2.2s apart → floor differs by ≥2 → different strings ✓ guaranteed). So:

```ts
it('ticks the elapsed time', async () => {
  const s = sessions.find((x) => x.id === 's-002')!;
  state.user = OPERATOR;
  state.activeSessionId = 's-002';
  renderWithProviders(<ActiveSessionBar />);

  const elapsedText = () => screen.getByText(/Active for \d+d \d+h \d+m \d+s/).textContent;
  const before = (await waitFor(() => elapsedText())) ?? ...
```

Hmm, waitFor(() => elapsedText()) — the callback returns the text (truthy once present) ✓ real timers, clean.

```ts
  const before = await waitFor(() => screen.getByText(/Active for \d+d \d+h \d+m \d+s/).textContent ?? '');
  await new Promise((r) => setTimeout(r, 2_200));
  const after = screen.getByText(/Active for \d+d \d+h \d+m \d+s/).textContent;
  expect(after).not.toBe(before);
```

`s-002` startedAt is 2024-04-02 08:00 UTC (i=1: `2024, 3, 1 + (1 % 20)` = April 2). The real now (2025+) → elapsed is large but fine. No db mutation needed (no restore!). The 2.2s real sleep — acceptable.

But wait — does "the string changed" prove ticking? Yes: the only input to the elapsed text is `now` (startedAt is fixed) → a change proves `now` advanced via the interval ✓ behavior-level.

And even better, let me assert the direction/magnitude: parse the seconds: after's seconds ≥ before's seconds (mod 60 wrap possible). `expect(after).not.toBe(before)` is sufficient and honest.

Hmm, but 2.2s — the interval is 1000ms. The first render's `now` = T. Ticks at T+1000, T+2000 (the interval starts when the session renders — the initial render with data is at T' after load. The effect sets the interval at T'. now updates at T'+1000...). Samples: before is at ~T_load+ε. after is at ~T_load+2.2s → ticks fired: ≥1 (at T'+1000, T'≈T_load) → the value changed ✓. Even if the load took 0.5s: before is at T0+0.5 (now=T0), the interval starts at T0, ticks at T0+1.0, 2.0 → after the sample at 2.7 → now=T0+2.0 → different ✓.

OK — real timers, no mutation, no restore.

But hmm — `renderWithProviders(<ActiveSessionBar />)`: does AuthProvider's me() resolve? state.user set ✓. The bar's active fetch → s-002 ✓.

One more: the `useTickingNow`'s `Date.now()` initializer and the interval — real ✓.

Also — the `screen.getByText(/Active for .../)` — only one element with that text (the bar) ✓ (the detail screen isn't rendered here).

Now — do we still need `vi`, `afterEach` imports? Not with real timers. Keep imports minimal: screen, waitFor, within. userEvent. describe/expect/it. sessions, state. renderApp, renderWithProviders. ActiveSessionBar. http/HttpResponse from msw + server (for the error/pending tests).

**Let me re-check the pending test under real timers:** a never-resolving handler → findByText('Loading active session…') ✓ resolves when the bar renders pending (which is immediate after auth). ✓

But note — the `server.use` override for /sessions/active: the list test handlers are unaffected ✓. resetHandlers in afterEach restores ✓.

**Login test order/state:** set state.user=null — but previous tests set OPERATOR. Each test sets what it needs ✓.

**Now — one more scenario to double check: the "resume" test renders '/orders'.** The orders list loads. The bar is present. But the orders list's `h1` "Orders". The Resume click → detail. `findByRole('heading', { name: 'Inspection 1' })` ✓.

**And the replacement test's blocker dialog button names:** "Cancel" and "Leave" ✓ unique on the page (the detail screen is unmounted... wait, the dialog is part of the detail screen's render — the blocker dialog is rendered by the detail screen which is still mounted during the block ✓. The buttons: "Save notes", "Close session" (disabled? s-001 open → enabled), plus the dialog's "Cancel"/"Leave"). `getByRole('button', { name: 'Leave' })` unique ✓.

**Wait, one important check — `useBlocker` and navigation via a nav Link (SPA navigation):** the blocker catches internal navigations ✓ (data router). The memory router in renderApp is a data router (createMemoryRouter) ✓ — that's how the existing dirty-flag mechanism works in tests... (no existing test for it, but the mechanism is standard).

**The refetch effect and the blocker:** while blocked (dialog open), navigation doesn't complete. The detail stays. No problem.

**Now — does anything regress in the existing list test with the new bar?** The list test renders '/sessions' with user set and activeSessionId null (initial state) → the bar query returns null → the bar renders null → the list is unaffected. But wait — the first list test: `state.user = ...; renderApp('/sessions')` — the bar's active fetch runs (401? no, authed → null) ✓. The test's assertions (Inspection 1, Page 1 of 3, Next, filter) — the bar adds a "Loading active session…" transient p... does that collide with `getByText`? The test waits for 'Inspection 1' — the bar's text 'Loading active session…' doesn't collide ✓. And after the active resolves (null) → bar absent ✓.

Hmm — the second list test (filter 'closed') — `queryByText('Inspection 1')` is not present — the bar (if it showed a session named Inspection 1) would break it — but activeSessionId is null (never set in the list tests) → no bar ✓. But note: my new test file and the existing one — separate files, separate module instances of mocks/db? Vitest: each test file gets a fresh module graph → separate `state` ✓ no cross-file contamination.

**Within my file:** the list test... I don't render a list test. But the close test asserts... fine.

Wait, one cross-test in my file: the "resume" test leaves state.activeSessionId='s-001'. The next test sets its own. But s-001 was never closed (only resume) ✓. The close test closes s-004 and restores. The replacement test uses s-001 and s-004 (s-004 restored to 'open' ✓). Test order in the file = declaration order (vitest runs in order). The replacement test comes after the close test → s-004 is restored ✓. The refresh test uses s-001 ✓. The tick test uses s-002 (status paused — the bar shows a paused badge. The tick test doesn't assert status ✓. Also the tick test sets s-002 active — but the bar's close button is enabled (paused ≠ closed) — irrelevant).

Hmm — the tick test: s-002 startedAt is originally 2024 → elapsed is huge. My test doesn't mutate (real-time approach) ✓ no restore needed.

**Edge: `renderWithProviders`'s AuthProvider** — on unmount (auto cleanup in afterEach), fine.

**Also — the `aria-label="Active session"` on the `<section>`** — role region. But the pending/error states are `<p>` (no region) — the test asserts the absence of the region in those states ✓ consistent.

Let me also re-check the `within(bar).getByText('open')` in the resume test: s-001 status 'open' ✓. The Badge renders `<span class="badge" data-tone="open">open</span>` ✓.

**Now — the `formatElapsedSince` output format "0d 0h 0m 10s"** — the real-time test's regex: `/Active for \d+d \d+h \d+m \d+s/` ✓ matches.

**Potential a11y/ARIA check on the region:** jsdom + RTL: `<section aria-label>` → getByRole('region') ✓ (jsdom supports it via dom-accessibility-api — a section with a label → region ✓).

**Let me reconsider the placement of the `useEffect` refetch in the detail screen:** `session`'s identity: the initial undefined → session object (fetch) → effect runs ✓. Also after save (new identity) → refetch (harmless). Also if the user navigates A → B, the detail screen remounts? Same route component, different param — React Router keeps the same element instance? The route `/sessions/:id` — same component. On param change, it re-renders (not remounted, I think — actually with the same route match, the component is preserved). `useSession(id)` re-queries with a new key. The `session` becomes the new data (or undefined during load? useQuery with a new key: data undefined until load... but the `session !== undefined` guard — during B's load, session=undefined → dirty=false (notes stale? the notes state is preserved across param changes! `notes`'s state persists (same component instance) — if A was dirty... but the blocker prevented a dirty leave. So on transition, notes = A's notes. session=B → the effect sets notes=B.notes ✓ existing behavior).

The refetch effect on session change ✓.

**What if the session being viewed isn't the active one (e.g., cached A reopened while B is active)?** The refetch returns B → the bar stays B ✓ (the server didn't re-mark because the fetch didn't happen).

**All checked. Let me also make sure there are no unused imports (noUnusedLocals!).**

AppLayout: all imports used ✓.

ActiveSessionBar: useEffect, useState ✓. useNavigate ✓. Badge, Button, ConfirmDialog ✓. useActiveSession, useCloseSession ✓. (No sessionKeys import — not needed there.)

queries.ts: useMutation, useQuery, useQueryClient ✓. api, SessionQuery ✓. Page, Session ✓.

SessionDetailScreen: added useQueryClient + sessionKeys ✓ both used.

Test file imports: screen, waitFor, within ✓ all used? within is used in several. waitFor is used in the replacement test + tick test. userEvent ✓. http, HttpResponse ✓ (error test). describe/expect/it ✓. sessions, state ✓ (sessions used in the tick? the tick test uses sessions.find for s-002 — but we no longer mutate... we don't even need s! The tick test: renderWithProviders + state.activeSessionId='s-002'. We don't touch the `sessions` array → drop the `sessions` import? The close test asserts db status → needs `sessions`. ✓ keep. server ✓. renderApp, renderWithProviders ✓. ActiveSessionBar ✓.

**Vitest globals**: tsconfig types includes vitest/globals and vite.config sets globals: true → but the repo's test files import explicitly from 'vitest' ✓ I'll do the same.

**JSX in the test file** → .tsx ✓.

**`renderWithProviders(<ActiveSessionBar />)`** — renderWithProviders's signature `ui: ReactElement` ✓.

**Let me re-check the close test flow with the dialog:** after `userEvent.click(within(bar).getByRole('button', { name: 'Close session' }))` — the dialog opens. `findByRole('dialog', { name: 'Close this session?' })` — the ConfirmDialog has aria-label={title} ✓ role dialog (div role="dialog") ✓.

Cancel → the dialog unmounts. Assert the bar's region is still there ✓. Re-open: `within(bar)` — `bar` is the captured element reference — still in the document ✓. Click → the dialog again → confirm: `within(dialog2).getByRole('button', { name: 'Close session' })` ✓ (the dialog's confirm label "Close session").

Mutation pending → on success: the server closes s-004 (was 'open'). state.activeSessionId 's-004' → cleared to null. The onSuccess: the detail cache for s-004 (not loaded → setQueryData on a nonexistent query is fine). patchLists: the list's page 1 contains s-004 → the row is patched to closed. clearActiveIf: active cache = s-004 → set to null → the bar re-renders null ✓. `waitFor` region absence ✓.

Assert `s.status === 'closed'` and `s.closedAt !== null` ✓. Then restore.

Also assert the dialog is gone after confirm? The onConfirm sets confirmClose false immediately → the dialog is gone before the mutation completes ✓ not necessary.

**Another possible pitfall: two "Close session" buttons during the dialog open** — the first open: the bar's button + the dialog's confirm. `within(dialog)` scopes the confirm click ✓. The first open uses `within(bar)` ✓.

**And in the dirty replacement test — after typing, click nav "Sessions".** `screen.getByRole('link', { name: 'Sessions' })` — the nav link. But the list... we're on the detail screen. Links on the page: nav "Sessions", nav "Orders". Only one "Sessions" link ✓.

**`userEvent.type(screen.getByLabelText('Notes'), ...)`** — the textarea ✓.

**Deep-link + refresh test:** after `first.unmount()`, the `screen` queries: RTL's screen is bound to document.body (persistent). After unmount, body is empty (the cleanup of unmount). The new renderApp → new body content. `findByRole` polls ✓.

**Now — the `renderApp` return value: `render(...)`'s result includes `unmount` ✓.**

**The orders screen in the resume test:** 31 orders → page 1 of 4. Irrelevant.

Also — the resume test asserts the heading 'Inspection 1' — the detail screen's h1. But the bar also has a span 'Inspection 1' (not a heading) ✓.

**Let me reconsider: the bar's `data` while the user is on the login screen?** AppLayout isn't rendered there at all ✓.

**Type check concerns:**

- `qc.getQueryData<Session | null>(sessionKeys.active())` — the key type is readonly ['sessions','active'] — getQueryData(queryKey: QueryKey) ✓.
- `useQuery` with queryFn returning `Promise<Session | null>` → data: `Session | null | undefined` ✓.
- `closeSession.isPending` ✓ v5.
- `refetchQueries({ queryKey: sessionKeys.active() })` ✓.
- In the test: `new Promise<never>(() => {})` as a handler return — MSW's HttpHandler return type: `Response | Promise<Response> | null | undefined`? Actually msw v2's handler resolver returns `Response | Promise<Response> | undefined`... `Promise<never>` is assignable to `Promise<Response>` ✓.

- `within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)` — the regex with `d`... fine.

**`screen.findByRole('region', { name: 'Active session' })`** — the name matches the aria-label ✓.

**StrictMode double-mount in tests?** renderApp doesn't wrap in StrictMode (test/render.tsx doesn't use StrictMode ✓) — good, no double-fetch weirdness (harmless anyway).

**The main.tsx DEV worker** — unaffected.

**Now, is there anything that "must not regress" about the dirty-flag warning on route change?** I didn't touch the blocker code ✓. My tests actually exercise it.

**One more design question: should the refetch be in the detail screen, or should the list's row click trigger activation?** The server marks on GET /:id. The detail screen is the only fetcher of /:id. So the detail screen is the right place ✓.

**Alternative considered:** the bar could refetch the active query periodically (refetchInterval) — not asked. The tick is client-side. Skip (don't over-build).

**Edge — the bar's close on a paused session:** the endpoint works ✓.

**Let me write the final files.** Also — do I need to update `src/test/render.tsx`? No.

Do I need to touch the mocks (handlers/db)? No — they already support the feature (GET /sessions/active exists, GET /:id marks active, close clears active, logout clears).

Let me count the files to deliver:
1. `src/app/AppLayout.tsx`
2. `src/features/sessions/ActiveSessionBar.tsx`
3. `src/features/sessions/queries.ts`
4. `src/features/sessions/SessionDetailScreen.tsx`
5. `src/features/sessions/ActiveSessionBar.test.tsx`

That's the coherent diff.

Let me finalize each file's contents.

**queries.ts** — full:

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
 * The one active session, straight from the server. `GET /sessions/active` is
 * the source of truth and the query cache its only client home: a full page
 * refresh brings it back from the API, and nothing is mirrored to client
 * storage that could outlive the cache and go stale.
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
      clearActiveIf(qc, updated.id);
    },
  });
}

/**
 * Closing a session ends its activeness on the server. If the closed session
 * was the active one, write that fact into the cache instead of waiting for
 * the next refetch of `/sessions/active`.
 */
function clearActiveIf(qc: ReturnType<typeof useQueryClient>, id: string): void {
  const active = qc.getQueryData<Session | null>(sessionKeys.active());
  if (active !== null && active !== undefined && active.id === id) {
    qc.setQueryData(sessionKeys.active(), null);
  }
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

**ActiveSessionBar.tsx** — full (as drafted above).

One style point: the repo's components don't have doc headers, but screens do (RequireAuth, AppLayout, ConfirmDialog, Tooltip have comments). A doc comment on the bar is appropriate.

**AppLayout.tsx** — as drafted.

**SessionDetailScreen.tsx** — full with the added effect:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

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

  // Opening a session marks it active on the server (GET /sessions/:id). Pull
  // that fact back right away so the active-session bar reflects the open
  // instead of waiting for the next scheduled refetch.
  useEffect(() => {
    if (session) void queryClient.refetchQueries({ queryKey: sessionKeys.active() });
  }, [session, queryClient]);

  // The dirty flag. Every screen that edits uses this shape: local draft vs the
  // cached server value, and a router blocker rather than a beforeunload hack.
  const dirty = session !== undefined && notes !== session.notes;
  ...rest identical
}
```

Import order: the original file starts with `import { useEffect, useState } from 'react';` and then react-router, then components. The react-query import — I'll put it first (the repo's orders/queries style puts react-query first). Fine.

**The test file** — let me assemble it fully:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp, renderWithProviders } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function activeBar() {
  return screen.getByRole('region', { name: 'Active session' });
}

describe('ActiveSessionBar', () => {
  it('shows the active session on another screen, and resume goes to its detail', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });
  });

  it('ticks the elapsed time on its own', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderWithProviders(<ActiveSessionBar />);

    const readElapsed = () =>
      screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
    const before = await waitFor(() => {
      const text = readElapsed();
      expect(text).not.toBe('');
      return text;
    });
    await new Promise((r) => setTimeout(r, 2_200));
    expect(readElapsed()).not.toBe(before);
  });
```

Hmm — `waitFor` returning a value: `waitFor(callback)` resolves with the callback's return ✓.

Wait — `expect(text).not.toBe('')` inside waitFor: on failure, it retries ✓ standard pattern.

2.2s real sleep — hmm, the interval ticks every 1s. between before (at load time T) and after (T+2.2): ticks at ~T+1, T+2 → now advanced ≥1s → the seconds component changed by 1-2 → the strings differ ✓ (the seconds differ mod 60 unless it wraps exactly — 1 or 2 second difference mod 60 is never 0 ✓).

```tsx
  it('closes the active session behind a confirm and empties the bar on success', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const row = sessions.find((s) => s.id === 's-004');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    // Cancel first: nothing changes.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(activeBar()).toBeInTheDocument();

    // Confirm: the endpoint is called and the bar empties.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument());
    expect(row?.status).toBe('closed');
    expect(row?.closedAt).not.toBeNull();

    row!.status = 'open';
    row!.closedAt = null;
  });
```

Wait — restore: s-004's original is status 'open', closedAt null ✓ (i=3: 3%3=0 → open. closedAt is i%3===2? no → null ✓).

Hmm, `row!` non-null assertion — tsconfig strict: `find` returns `Session | undefined`. Use `if (!row) throw ...`? Simpler: `const row = sessions.find(...)!;` — no explicit strict warning on `!` (allowed). The repo code uses `!` (main.tsx's `document.getElementById('root')!`) ✓. Use `!`.

Also `row.closedAt`'s type is `string | null` ✓.

The mutation: after confirm, the close request → MSW → the response → onSuccess updates the cache → the bar clears. The `waitFor` region absence ✓.

But — the `state.activeSessionId` after close is null (server handler) ✓ subsequent tests set their own.

```tsx
  it('confirms before a session with unsaved notes is replaced by another', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    expect(activeBar()).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');

    // Leaving the detail is the only way to open another session: the dirty
    // flag must gate it.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await screen.findByText('Leave with unsaved notes?');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    // Leaving did not end the session: it is still the active one.
    expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();

    // Opening another session replaces it (no second confirm: the notes were
    // consciously discarded above).
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() =>
      expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument(),
    );
  });

  it('replaces the active session without a confirm when nothing is unsaved', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() =>
      expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument(),
    );
  });
```

Wait — in the first replacement test: `screen.getByRole('heading', { name: 'Sessions' })` — after the list renders. But `findByRole('heading', { name: 'Sessions' })` — during the transition, the detail's h1 is "Inspection 1" ✓ no conflict.

Hmm — one issue: after `userEvent.click(nav 'Sessions')` while dirty, the blocker blocks. `findByText('Leave with unsaved notes?')` ✓. Then click "Leave" → proceed → the list. But — the bar: is the active s-001 still? Yes (the server is unchanged) → the bar shows "Inspection 1" ✓ asserted.

Then click "Inspection 4" → detail 4 → the fetch marks active=s-004 → the refetch → the bar shows Inspection 4 ✓.

Note: s-001's detail was dirty. The "Leave" proceeds discarding → the server's notes for s-001 are 'Awaiting parts.' (unchanged) ✓.

The second test (clean): s-001's notes = 'Awaiting parts.' — the notes textarea is initialized to that. dirty=false ✓ no dialog ✓.

Wait — the first replacement test ran before the second and left s-001... the first test didn't save notes (discarded) → the db's s-001 notes unchanged 'Awaiting parts.' ✓. The second test loads s-001 fresh → notes 'Awaiting parts.', dirty false ✓.

```tsx
  it('brings the bar back from GET /sessions/active after a full reload', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    const beforeReload = renderApp('/sessions');

    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
    await screen.findByRole('region', { name: 'Active session' });
    beforeReload.unmount();

    // A fresh client: a new query cache, the same server. The bar must come
    // back from the API, not from anything the first client kept.
    renderApp('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });
```

Hmm — `await userEvent.click(await screen.findByRole(...))` — the link appears after the list loads ✓.

Wait: after the first unmount, the query cache dies (the new QueryClient inside renderApp) ✓. The server still has activeSessionId='s-001' ✓ (the unmount doesn't call logout) ✓.

```tsx
  it('makes a deep-linked detail session active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });
```

s-004 — but the close test (earlier in the file) restored it to 'open' ✓. Test order: resume, tick, close, dirty-replace, clean-replace, reload, deep-link, pending, error, login, logout. The close test restores s-004 before the deep-link test ✓.

```tsx
  it('shows a pending state while the active session is still loading', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
    renderApp('/sessions');

    await screen.findByText('Loading active session…');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

```tsx
  it('shows a failed fetch as an error, not as "no active session"', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText('Couldn't load the active session.');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
```

```tsx
  it('is absent on the login screen', async () => {
    state.user = null;
    renderApp('/login');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
  });
```

```tsx
  it('is cleared by logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
```

Check: the `activeBar()` helper uses `screen.getByRole` (not find) — used after the existence is established ✓.

Wait, in the dirty-replace test I wrote `expect(activeBar()).toBeInTheDocument();` right after `findByRole('heading', {name:'Inspection 1'})` — is the bar guaranteed at that point? The heading appears when the session detail loads. The bar appears when the active refetch completes (after the detail effect) — which may lag the heading by a tick. Using `expect(activeBar())` immediately could be flaky (the bar's pending p is showing, no region yet). Replace with `await screen.findByRole('region', { name: 'Active session' })`. Let me use that:

```ts
await screen.findByRole('heading', { name: 'Inspection 1' });
await screen.findByRole('region', { name: 'Active session' });
```

✓ Safer. Similarly, the clean-replace test doesn't assert the bar before leaving (fine).

In the close test: `findByRole('region')` first ✓ then within assertions ✓.

In the resume test: findByRole region ✓.

**One more potential flake — the `userEvent.type` into the textarea before the nav click:** the textarea is present after the detail load. The region's findBy guarantees the detail is loaded... the region's appearance is after the session load → the textarea exists ✓. But the ordering: heading found, region found, then type ✓.

**The `waitFor` import is used** ✓ (replacement + close + tick tests).

**`within` is used** ✓.

**Check no `any`/strict issues in the tests:** `sessions.find((s) => s.id === 's-004')!` ✓.

**The msw import in the test file:** `import { HttpResponse, http } from 'msw';` ✓ (v2).

Now — let me double-check the pending test doesn't hang the whole suite: the never-resolving request leaves a pending query. The test ends. The unmount cleanup (auto in afterEach via RTL's cleanup) cancels it? rq on unmount: the query becomes inactive. The fetch stays pending (no abort in v5? it's aborted on unmount? the observer unmounts → the query is garbage-collected eventually. The pending fetch remains in limbo but doesn't fail the test) ✓. The `server.use` override is reset in afterEach ✓.

Hmm — actually one more thing to double check: MSW's `onUnhandledRequest: 'error'` (setup.ts) — with my override in place, the request IS handled ✓. In the error test, the handler returns 500 ✓ handled.

**`renderWithProviders` + fake... no, real timers** ✓.

**The elapsed regex:** the format is `0d 3h 12m 45s` — the regex `/Active for \d+d \d+h \d+m \d+s/` ✓.

**Now, the tick test's 2.2s:** is the elapsed guaranteed to differ? before is sampled right after the first render with the bar (now=T0 at that render... wait, `useTickingNow`'s initial now = Date.now() at the first render of the bar (pending phase, T_render0). The interval starts when enabled (when the session renders, T_render1). Ticks at T_render1+1s, +2s...

before = the value at the first poll where the text exists (T_check1 ≥ T_render1): elapsed uses `now` = the last tick value ≤ T_check1 → now ∈ {T_render1+1000, T_render1+2000, ...} or the initial T_render0 (before the first tick). after = at T_check1+2200: now has advanced by ≥ ... T_check1 could be right after a tick. T_check1+2200 is at least 1.2s after the next tick boundary → the value definitely changed ✓.

**One concern: the tick test renders only the bar (no AppLayout)** — the bar's region is present. `readElapsed`'s queryByText matches the bar's span ✓ single.

**The bar on `renderWithProviders`'s path '/'** — the route `{ path: '/', element: ui }` ✓.

I think the solution is solid. Let me also re-verify that the `AppLayout` comment is preserved and the bar is "above the <Outlet />" ✓.

**Final check on the `useTickingNow` gate:** `session != null` — while isLoading, data is undefined → gate false → no interval → the pending p shows a static text ✓. On error → gate false ✓. On success with null → gate false, returns null ✓. On success with session → gate true → ticks ✓.

Edge: if the active session becomes null mid-display (close) → the gate is false → the interval is cleared ✓.

**TS: `useTickingNow(session != null)`** — `session`'s type is `Session | null | undefined` → `!= null` narrows to Session in the later code? I use `session` after the guard `if (session === null || session === undefined) return null;` — hmm, I wrote `if (session === null || session === undefined) return null;` — or `if (!session) return null;` — but `session` could be... it's an object, so `!session` covers both null and undefined ✓ simpler: `if (!session) return null;`. But the repo style uses explicit checks in the dirty flag. `!session` is fine and common. Let me use it.

Actually, to keep the narrowing clean:

```ts
const { data: session, isLoading, isError } = useActiveSession();
...
const now = useTickingNow(Boolean(session));
if (isLoading) return <p ...>Loading active session…</p>;
if (isError) return <p ...>Couldn't load the active session.</p>;
if (!session) return null;
```

✓.

**The elapsed span** — should I add a class? `className="active-session-bar__elapsed"`? There's no CSS file in the repo to update (styles aren't shown — presumably injected elsewhere or nonexistent). The repo consistently uses class names. Adding a class is harmless. Let me add minimal classes: `active-session-bar` (on section/p), `active-session-bar__field`? Keep it light: only the section's class + the existing ones. Actually, to mirror the app's styling convention (BEM-ish: `btn--primary`, `dialog__actions`, `row--clickable`, `tooltip__bubble`), I'll add `active-session-bar__fields` around the name/badge/elapsed? Overkill. Let me keep: the section with the class. The children plain. Fine.

**Now let me write everything out.** Also, the format: level-3 heading with the path, then a fenced block. Nothing else.

Let me re-read the SessionDetailScreen's original once more to preserve everything:

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

  return ( ... same ... );
}
```

My modified version: add the import (useQueryClient from react-query. sessionKeys). Add the queryClient. Add the refetch effect. Keep everything else identical.

Import order: the original has react first. I'll add react-query... the repo's orders/queries.ts puts react-query first. The screen files (auth-context) put react-query first. Let me put `import { useQueryClient } from '@tanstack/react-query';` first, then react, then router, then components, then queries. Reasonable.

One thing — `noUnusedLocals`: all good.

**Test file — one more check for the `waitFor` + `userEvent` interaction under jsdom**: standard ✓.

**The `screen.findByRole('heading', { name: 'Sessions' })`** — the list's h1. But the nav link "Sessions" is a link, not a heading ✓.

**The logout test:** after logout, RequireAuth navigates to /login with state. The login screen renders "Sign in" ✓. The bar is unmounted (AppLayout gone) ✓.

Also — the logout button: `getByRole('button', { name: 'Log out' })` unique ✓.

**The login test:** `state.user = null` — but the AuthProvider's me() fetch → 401 → setUser(null) → login ✓. `findByRole('button', { name: 'Sign in' })` ✓.

Hmm — the LoginScreen also has an input for the name. Fine.

**Also verify that the `ActiveSessionBar` file has no imports it doesn't need** — `sessionKeys` isn't imported there ✓.

I believe everything is consistent. Let me also reconsider whether the "active" refetch should happen in `useSession`... no, the screen level is right (the hook stays pure).

Also — hmm, `refetchQueries({ queryKey: sessionKeys.active() })` — returns a promise. `void` it ✓. In StrictMode dev, the double effect → 2 refetches → fine.

**Potential issue: the refetch effect runs before the server has processed...?** No — the effect runs after the detail fetch resolved (session is set from that response). The server's state.activeSessionId was set during that request ✓.

**Edge: what if the opened session is closed (deep link to a closed s-003)?** The server doesn't mark it active. The refetch returns the current active (maybe null) → the bar unchanged ✓. Good — the close test's deep-link... not tested, fine.

Now, is there a risk that the existing `SessionsListScreen.test.tsx` breaks because of the bar? It renders '/sessions'. The bar's active fetch: state.activeSessionId — in that test file, initial null → returns null → the bar is null. But during load, the bar briefly renders "Loading active session…" — could that interfere with `getByText('Inspection 1')`? No. `waitFor` is specific. The `queryByText('Inspection 1')` negative assertion — the bar would only contain 'Inspection 1' if active=s-001 — it isn't ✓. And the filter test: after filtering 'closed', 'Inspection 1' is absent from the list. The bar: still null (active is null — the list view doesn't fetch a detail) ✓.

Wait — actually, hmm: in the existing list test file, is `state` imported and mutated? They set `state.user`. `state.activeSessionId` stays null ✓.

But — vitest's module registry: each test file gets a fresh `mocks/db` module → `sessions` array is fresh ✓. So my file's close-restore doesn't even affect the other file. Within my file, the restore keeps order-independent correctness anyway.

One more: **the `describe` name and the test names** — repo style: `describe('SessionsListScreen', ...)` with lowercase behavior sentences ✓ I'll match.

**Let me write the final answer.** Only 5 files, each complete.

Actually — wait, let me reconsider the tick test once more. The real 2.2s sleep makes the suite slower but reliable. Alternatively fake timers... I've already gone back and forth. Let me commit to real timers (reliable, simple, no db mutation). A single 2.2s test is acceptable.

Hmm, but one more consideration: `renderWithProviders` — after the test ends, the auto cleanup unmounts ✓ the interval is cleared ✓.

And in the tick test, the bar loads via the active query — under real timers, no issue.

Also, let me re-check `readElapsed` uses `queryByText` (returns null if absent) and the `waitFor` callback returns a non-empty string. Once found, the value is stable between polls (ticks 1/s. The poll default 50ms) — the first non-empty is returned ✓. Then sleep 2.2s → the value has changed ✓.

Edge: if the text changes during the `before` capture (a tick between the getByText call and the return) — irrelevant. We just need some baseline string. After 2.2s, the string is guaranteed different from the baseline (the baseline was within 50ms of some now value N_b. The final is within 50ms of N_a ≥ N_b + 2100ms... the displayed seconds: floor((now - start)/1000). N_a - N_b ≥ ~2.15s → the floor difference ≥ 2 (worst case: N_b is 0.999 past a boundary, N_a is... floor((x+2.15)) - floor(x) ≥ 2? x=0.999: floor(3.149)=3, floor(0.999)=0 → 3 ✓. Min difference: x=0.0: floor(2.15)=2 → 2 ✓). The seconds digit: 2 or 3 mod 60 difference → different ✓. Even if the minute rolls over, the string differs ✓.

Great.

Also, the `waitFor` default timeout of 1000ms for the tick's `before` — the bar's load (auth me + active fetch) is well under 1s ✓.

Let me also make sure the `renderWithProviders`'s bar: AuthProvider's me() → state.user = OPERATOR ✓ (set before the render).

OK, one more thought: **should the bar's pending message be distinct from the detail's "Loading…"** — yes, I made it "Loading active session…" ✓ (avoiding a getByText collision. E.g., if the detail is loading and the bar is pending → two different texts ✓).

**The error message**: "Couldn't load the active session." — unique ✓.

Let me finalize the file contents.

File 1: `src/app/AppLayout.tsx`

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

(Import order: the original was router, Button, auth. I'll insert ActiveSessionBar after Button... the original order: `import { Link, Outlet } from 'react-router-dom'; import { Button } from '../components/ui/Button'; import { useAuth } from '../auth/auth-context';` — keep that order and append the new import at the end.)

File 2: `src/features/sessions/ActiveSessionBar.tsx` — as drafted.

File 3: `src/features/sessions/queries.ts` — as drafted.

File 4: `src/features/sessions/SessionDetailScreen.tsx` — as drafted.

File 5: `src/features/sessions/ActiveSessionBar.test.tsx` — as drafted.

Let me write out the bar file fully and carefully:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar, rendered by AppLayout so it is on every
 * authenticated screen and nowhere else.
 *
 * The server is the source of truth (`GET /sessions/active`): a full page
 * refresh brings the bar back from the API, and logout — which clears the query
 * cache and the server's active session — empties it. Nothing is mirrored into
 * client storage, where it would go stale in exactly the situation this bar
 * exists to handle.
 *
 * Pending and error are rendered as their own states: a failed fetch is not
 * "no active session", and the operator should be able to tell them apart.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(session));

  if (isLoading) return <p className="active-session-bar">Loading active session…</p>;
  if (isError) return <p className="active-session-bar">Couldn't load the active session.</p>;
  if (!session) return null;

  return (
    <section className="active-session-bar" aria-label="Active session">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>Active for {formatElapsedSince(session.startedAt, now)}</span>

      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={session.status === 'closed' || closeSession.isPending}
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

/** Ticks once a second so the elapsed time advances without any interaction. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/** Human-readable elapsed time since `startedAt`, whole seconds. */
function formatElapsedSince(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}
```

Wait — a `<span>{session.name}</span>` with no class — the test uses within(region).getByText('Inspection 1') ✓.

Hmm, the section's children: name span, badge, elapsed span, buttons — fine.

Let me re-check the test's `within(bar).getByText('open')` — the badge's span text 'open' ✓ unique within the bar ✓.

Now the detail screen's full file:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

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

  // Opening a session marks it active on the server (GET /sessions/:id). Pull
  // the fact back right away so the active-session bar reflects the open
  // instead of waiting for the next scheduled refetch.
  useEffect(() => {
    if (session) void queryClient.refetchQueries({ queryKey: sessionKeys.active() });
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

✓.

Now let me finalize the test file (assembled from the fragments above, consistent).

Also, a small point: `function activeBar()` — defined at the module scope after the imports. Uses screen ✓.

Let me also make sure there are no unused variables: `row` is used ✓. All imports are used: screen ✓, waitFor ✓, within ✓, userEvent ✓, HttpResponse ✓ (error test), http ✓ (pending + error tests), describe/expect/it ✓, sessions ✓ (close test), state ✓, server ✓, renderApp ✓, renderWithProviders ✓ (tick), ActiveSessionBar ✓.

The tick test — hmm, `renderWithProviders(<ActiveSessionBar />)` needs JSX → .tsx ✓.

The `readElapsed` helper inside the tick test ✓.

I'm confident. Let me also double check that the `waitFor(() => { const text = readElapsed(); expect(text).not.toBe(''); return text; })` returns a string ✓ typed as string.

One more possible snag: in the close test, after cancel, `expect(activeBar()).toBeInTheDocument()` — the region is still there ✓ (the cancel doesn't touch the data).

And after confirm, the bar region disappears — but the ConfirmDialog also unmounts (confirmClose false) ✓.

Also — the mutation's `onSuccess` clears the active cache → but the `useActiveSession` query: setQueryData(null) → the observer re-renders → null → the bar is null ✓.

And — `patchLists` on close: the list's page-1 data is cached (we're on the list screen) → the row's badge → 'closed'. Not asserted. Fine.

**Deliverable order**: AppLayout, ActiveSessionBar, queries, SessionDetailScreen, test.

Let me write it out.
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
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar, rendered by AppLayout so it is on every
 * authenticated screen and nowhere else.
 *
 * The server is the source of truth (`GET /sessions/active`): a full page
 * refresh brings the bar back from the API, and logout — which clears the
 * query cache and the server's active session — empties it. Nothing is
 * mirrored into client storage, where it would go stale in exactly the
 * situation this bar exists to handle.
 *
 * Pending and error are rendered as their own states: a failed fetch is not
 * "no active session", and the operator should be able to tell them apart.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(session));

  if (isLoading) return <p className="active-session-bar">Loading active session…</p>;
  if (isError) return <p className="active-session-bar">Couldn't load the active session.</p>;
  if (!session) return null;

  return (
    <section className="active-session-bar" aria-label="Active session">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>Active for {formatElapsedSince(session.startedAt, now)}</span>

      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={session.status === 'closed' || closeSession.isPending}
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

/** Ticks once a second so the elapsed time advances without any interaction. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/** Human-readable elapsed time since `startedAt`, in whole seconds. */
function formatElapsedSince(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
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

/**
 * The one active session, straight from the server. `GET /sessions/active` is
 * the source of truth and the query cache its only client home: a full page
 * refresh brings it back from the API, and nothing is mirrored to client
 * storage that could outlive the cache and go stale.
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
      clearActiveIf(qc, updated.id);
    },
  });
}

/**
 * Closing a session ends its activeness on the server. If the closed session
 * was the active one, write that fact into the cache instead of waiting for
 * the next refetch of `/sessions/active`.
 */
function clearActiveIf(qc: ReturnType<typeof useQueryClient>, id: string): void {
  const active = qc.getQueryData<Session | null>(sessionKeys.active());
  if (active !== null && active !== undefined && active.id === id) {
    qc.setQueryData(sessionKeys.active(), null);
  }
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
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

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

  // Opening a session marks it active on the server (GET /sessions/:id). Pull
  // that fact back right away so the active-session bar reflects the open
  // instead of waiting for the next scheduled refetch.
  useEffect(() => {
    if (session) void queryClient.refetchQueries({ queryKey: sessionKeys.active() });
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
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp, renderWithProviders } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function activeBar() {
  return screen.getByRole('region', { name: 'Active session' });
}

describe('ActiveSessionBar', () => {
  it('shows the active session on another screen, and resume goes to its detail', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });
  });

  it('ticks the elapsed time on its own', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderWithProviders(<ActiveSessionBar />);

    const readElapsed = () => screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
    const before = await waitFor(() => {
      const text = readElapsed();
      expect(text).not.toBe('');
      return text;
    });

    await new Promise((r) => setTimeout(r, 2_200));
    expect(readElapsed()).not.toBe(before);
  });

  it('closes the active session behind a confirm and empties the bar on success', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    const row = sessions.find((s) => s.id === 's-004')!;
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    // Cancel first: nothing changes.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(activeBar()).toBeInTheDocument();

    // Confirm: the endpoint is called and the bar empties.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(row.status).toBe('closed');
    expect(row.closedAt).not.toBeNull();

    row.status = 'open';
    row.closedAt = null;
  });

  it('confirms before a session with unsaved notes is replaced by another', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await screen.findByRole('region', { name: 'Active session' });

    // Dirty it: the detail screen's own flag, no second source of truth.
    await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');

    // Leaving the detail is the only way to open another session: the dirty
    // flag must gate it.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await screen.findByText('Leave with unsaved notes?');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    // Leaving did not end the session: it is still the active one.
    expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();

    // Opening another session replaces it (no second confirm: the notes were
    // consciously discarded above).
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('replaces the active session without a confirm when nothing is unsaved', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('brings the bar back from GET /sessions/active after a full reload', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    const beforeReload = renderApp('/sessions');

    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
    await screen.findByRole('region', { name: 'Active session' });
    beforeReload.unmount();

    // A fresh client: a new query cache, the same server. The bar must come
    // back from the API, not from anything the first client kept.
    renderApp('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('makes a deep-linked detail session active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('shows a pending state while the active session is still loading', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
    renderApp('/sessions');

    await screen.findByText('Loading active session…');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a failed fetch as an error, not as "no active session"', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText('Couldn't load the active session.');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('is absent on the login screen', async () => {
    state.user = null;
    renderApp('/login');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
  });

  it('is cleared by logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
```


---

# repair1-set

## reasoning

```
Let me look at the errors carefully. They're all in `src/features/sessions/ActiveSessionBar.test.tsx` at line 162.

Let me look at the file content provided in the reference:

Line 162 would be in the test file. Let me count the lines...

Actually, let me look at the file more carefully. The file is provided in full. Let me count lines to find line 162.

Looking at the file:
```
1: import { screen, waitFor, within } from '@testing-library/react';
2: import userEvent from '@testing-library/user-event';
3: import { HttpResponse, http } from 'msw';
4: import { describe, expect, it } from 'vitest';
5: import { sessions, state } from '../../mocks/db';
6: import { server } from '../../mocks/server';
7: import { renderApp, renderWithProviders } from '../../test/render';
8: import { ActiveSessionBar } from './ActiveSessionBar';
9: 
10: const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };
11: 
12: function activeBar() {
13:   return screen.getByRole('region', { name: 'Active session' });
14: }
15: 
16: describe('ActiveSessionBar', () => {
17:   it('shows the active session on another screen, and resume goes to its detail', async () => {
18:     state.user = OPERATOR;
19:     state.activeSessionId = 's-001';
20:     renderApp('/orders');
21: 
22:     const bar = await screen.findByRole('region', { name: 'Active session' });
23:     expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
24:     expect(within(bar).getByText('open')).toBeInTheDocument();
25:     expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();
26: 
27:     await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
28:     await screen.findByRole('heading', { name: 'Inspection 1' });
29:   });
30: 
31:   it('ticks the elapsed time on its own', async () => {
32:     state.user = OPERATOR;
33:     state.activeSessionId = 's-002';
34:     renderWithProviders(<ActiveSessionBar />);
35: 
36:     const readElapsed = () => screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
37:     const before = await waitFor(() => {
38:       const text = readElapsed();
39:       expect(text).not.toBe('');
40:       return text;
41:     });
42: 
43:     await new Promise((r) => setTimeout(r, 2_200));
44:     expect(readElapsed()).not.toBe(before);
45:   });
46: 
47:   it('closes the active session behind a confirm and empties the bar on success', async () => {
48:     state.user = OPERATOR;
49:     state.activeSessionId = 's-004';
50:     const row = sessions.find((s) => s.id === 's-004')!;
51:     renderApp('/sessions');
52: 
53:     const bar = await screen.findByRole('region', { name: 'Active session' });
54:     expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
55: 
56:     // Cancel first: nothing changes.
57:     await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
58:     const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
59:     await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
60:     expect(activeBar()).toBeInTheDocument();
61: 
62:     // Confirm: the endpoint is called and the bar empties.
63:     await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
64:     const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
65:     await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));
66: 
67:     await waitFor(() =>
68:       expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
69:     );
70:     expect(row.status).toBe('closed');
71:     expect(row.closedAt).not.toBeNull();
72: 
73:     row.status = 'open';
74:     row.closedAt = null;
75:   });
76: 
77:   it('confirms before a session with unsaved notes is replaced by another', async () => {
78:     state.user = OPERATOR;
79:     state.activeSessionId = 's-001';
80:     renderApp('/sessions/s-001');
81: 
82:     await screen.findByRole('heading', { name: 'Inspection 1' });
83:     await screen.findByRole('region', { name: 'Active session' });
84: 
85:     // Dirty it: the detail screen's own flag, no second source of truth.
86:     await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');
87: 
88:     // Leaving the detail is the only way to open another session: the dirty
89:     // flag must gate it.
90:     await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
91:     await screen.findByText('Leave with unsaved notes?');
92: 
93:     await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
94:     await screen.findByRole('heading', { name: 'Sessions' });
95:     // Leaving did not end the session: it is still the active one.
96:     expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();
97: 
98:     // Opening another session replaces it (no second confirm: the notes were
99:     // consciously discarded above).
100:    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
101:    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
102:  });
103:
104:  it('replaces the active session without a confirm when nothing is unsaved', async () => {
105:    state.user = OPERATOR;
106:    state.activeSessionId = 's-001';
107:    renderApp('/sessions/s-001');
108:
109:    await screen.findByRole('heading', { name: 'Inspection 1' });
110:    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
111:    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
112:    await screen.findByRole('heading', { name: 'Sessions' });
113:
114:    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
115:    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
116:  });
117:
118:  it('brings the bar back from GET /sessions/active after a full reload', async () => {
119:    state.user = OPERATOR;
120:    state.activeSessionId = null;
121:    const beforeReload = renderApp('/sessions');
122:
123:    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
124:    await screen.findByRole('region', { name: 'Active session' });
125:    beforeReload.unmount();
126:
127:    // A fresh client: a new query cache, the same server. The bar must come
128:    // back from the API, not from anything the first client kept.
129:    renderApp('/sessions');
130:    const bar = await screen.findByRole('region', { name: 'Active session' });
131:    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
132:  });
133:
134:  it('makes a deep-linked detail session active', async () => {
135:    state.user = OPERATOR;
136:    state.activeSessionId = null;
137:    renderApp('/sessions/s-004');
138:
139:    await screen.findByRole('heading', { name: 'Inspection 4' });
140:    const bar = await screen.findByRole('region', { name: 'Active session' });
141:    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
142:  });
143:
144:  it('shows a pending state while the active session is still loading', async () => {
145:    state.user = OPERATOR;
146:    state.activeSessionId = 's-001';
147:    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
148:    renderApp('/sessions');
149:
150:    await screen.findByText('Loading active session…');
151:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
152:  });
153:
154:  it('shows a failed fetch as an error, not as "no active session"', async () => {
155:    state.user = OPERATOR;
156:    state.activeSessionId = 's-001';
157:    server.use(
158:      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
159:    );
160:    renderApp('/sessions');
161:
162:    await screen.findByText('Couldn't load the active session.');
163:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
164:  });
165:
166:  it('is absent on the login screen', async () => {
167:    state.user = null;
168:    renderApp('/login');
169:
170:    await screen.findByRole('button', { name: 'Sign in' });
171:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
172:    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
173:  });
174:
175:  it('is cleared by logout', async () => {
176:    state.user = OPERATOR;
177:    state.activeSessionId = 's-001';
178:    renderApp('/sessions');
179:
180:    await screen.findByRole('region', { name: 'Active session' });
181:    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
182:
183:    await screen.findByRole('button', { name: 'Sign in' });
184:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
185:  });
186:});
```

Line 162: `    await screen.findByText('Couldn't load the active session.');`

The problem is clear: the string `'Couldn't load the active session.'` contains an unescaped single quote (`'` in "Couldn't"). This breaks the string literal.

The fix is to escape the apostrophe: `'Couldn\'t load the active session.'`

Or use double quotes: `"Couldn't load the active session."`

Let me go with the escaped version since the rest of the file uses single quotes.

Wait, let me look at the errors more carefully:
- (162,37): ',' expected — this is at the `t` in `Couldn't`
- (162,39): ',' expected
- (162,44): ',' expected
- (162,48): ',' expected
- (162,55): ',' expected
- (162,63): Identifier expected
- (162,66): Unterminated string literal
- (163,5): ',' expected
- (163,93): ')' expected

Yes, the issue is the unescaped apostrophe in `Couldn't`. The string starts with `'`, then at `Couldn` the `'` is interpreted as closing the string, then `t` is an unexpected identifier, etc.

The fix: change `'Couldn't load the active session.'` to `'Couldn\'t load the active session.'`

This is a single distinct mistake in one file. Let me write the complete file with that fix.
```

## reply

Looking at the errors, they're all on line 162:

```
await screen.findByText('Couldn't load the active session.');
```

The apostrophe in `Couldn't` terminates the string literal prematurely. There is **one** distinct mistake: an unescaped single quote inside a single-quoted string.

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp, renderWithProviders } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function activeBar() {
  return screen.getByRole('region', { name: 'Active session' });
}

describe('ActiveSessionBar', () => {
  it('shows the active session on another screen, and resume goes to its detail', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });
  });

  it('ticks the elapsed time on its own', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderWithProviders(<ActiveSessionBar />);

    const readElapsed = () => screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
    const before = await waitFor(() => {
      const text = readElapsed();
      expect(text).not.toBe('');
      return text;
    });

    await new Promise((r) => setTimeout(r, 2_200));
    expect(readElapsed()).not.toBe(before);
  });

  it('closes the active session behind a confirm and empties the bar on success', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    const row = sessions.find((s) => s.id === 's-004')!;
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    // Cancel first: nothing changes.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(activeBar()).toBeInTheDocument();

    // Confirm: the endpoint is called and the bar empties.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(row.status).toBe('closed');
    expect(row.closedAt).not.toBeNull();

    row.status = 'open';
    row.closedAt = null;
  });

  it('confirms before a session with unsaved notes is replaced by another', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await screen.findByRole('region', { name: 'Active session' });

    // Dirty it: the detail screen's own flag, no second source of truth.
    await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');

    // Leaving the detail is the only way to open another session: the dirty
    // flag must gate it.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await screen.findByText('Leave with unsaved notes?');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    // Leaving did not end the session: it is still the active one.
    expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();

    // Opening another session replaces it (no second confirm: the notes were
    // consciously discarded above).
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('replaces the active session without a confirm when nothing is unsaved', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('brings the bar back from GET /sessions/active after a full reload', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    const beforeReload = renderApp('/sessions');

    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
    await screen.findByRole('region', { name: 'Active session' });
    beforeReload.unmount();

    // A fresh client: a new query cache, the same server. The bar must come
    // back from the API, not from anything the first client kept.
    renderApp('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('makes a deep-linked detail session active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('shows a pending state while the active session is still loading', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
    renderApp('/sessions');

    await screen.findByText('Loading active session…');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a failed fetch as an error, not as "no active session"', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText('Couldn\'t load the active session.');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('is absent on the login screen', async () => {
    state.user = null;
    renderApp('/login');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
  });

  it('is cleared by logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
```


---
