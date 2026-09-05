## 1. Assumptions

- **Set-active endpoint**: `PUT /sessions/active` with body `{ sessionId: string }`, returning the `ActiveSession` object. The task names `GET /sessions/active` as source of truth but implies a write path; this is the minimal one.
- **Close endpoint**: already exists as `POST /sessions/:id/close`; no new route.
- **Confirm UI**: `window.confirm()` — this is an internal back-office; a modal adds files without user-visible benefit.
- **Activation trigger**: the detail screen sets itself active on mount (covers both list-click and deep-link uniformly). The list screen needs no change.
- **Dirty flag sharing**: a small React context (`DirtyContext`) sits above the detail route; the detail screen writes, the bar reads. No third-party state library.
- **Elapsed time**: computed client-side from `startedAt` (ISO string) via a 1-second `setInterval` inside the bar. No server clock needed.
- **Layout file**: the authenticated layout lives at `src/app/authenticated-layout.tsx` (existing); the bar is inserted there.
- **No new API tables**: the server already persists the active-session pointer; this plan is frontend-only.

## 2. Data model

none

## 3. Types and signatures

```ts
// src/features/sessions/dirty-context.tsx

export interface DirtyContextValue {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
}

export declare function useDirty(): DirtyContextValue; // throws if no <DirtyProvider>
export declare function DirtyProvider(props: { children: React.ReactNode }): React.ReactElement;
```

```ts
// src/features/sessions/use-active-session.ts

export interface ActiveSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string; // ISO-8601
}

export interface UseActiveSessionResult {
  active: ActiveSession | null;
  isFetching: boolean;
  /**
   * Sets the given session as active (PUT /sessions/active).
   * Raises ApiError { code: 'session_not_found' } if the id is invalid.
   * Invalidates + refetches GET /sessions/active on success.
   */
  setActive: (sessionId: string) => Promise<void>;
  /**
   * Calls POST /sessions/:active.id/close, then refetches GET /sessions/active.
   * On success the server returns null (no active session) and the bar empties.
   * Raises ApiError { code: 'session_already_closed' } if already closed.
   */
  closeActive: () => Promise<void>;
  isMutating: boolean;
}

export declare function useActiveSession(): UseActiveSessionResult;
```

```ts
// src/features/sessions/active-session-bar.tsx

/**
 * Renders the persistent bar. Returns null (renders nothing) when no active session.
 * Shows: session name, status badge, elapsed time (ticking), "Resume" button,
 * "Close session" button.
 *
 * "Close session": window.confirm → closeActive().
 */
export declare function ActiveSessionBar(): React.ReactElement | null;
```

```ts
// src/app/authenticated-layout.tsx  (modified)
// Renders <ActiveSessionBar /> above the <Outlet />. No new props; reads hooks directly.
```

```ts
// src/features/sessions/session-detail.tsx  (modified)
// On mount: if session.id !== useActiveSession().active?.id →
//   if active && useDirty().isDirty → window.confirm; on cancel navigate(-1).
//   call setActive(session.id); setDirty(false).
// Existing dirty-flag logic now writes through useDirty().setDirty() instead of local state.
```

**Error contract (raised by the hook's mutations):**

| code | raised when |
|---|---|
| `session_not_found` | `setActive` called with an id that has no matching row |
| `session_already_closed` | `closeActive` called on an already-closed session |
| `unauthenticated` | token missing/expired (handled by react-query retry → redirect to login) |

**Ordering rule**: `setActive` must complete before the detail screen renders its editable form (gate on `isMutating`). This prevents a stale active-session bar from showing the old session while the detail already displays the new one.

## 4. Control flow

| State | Trigger | Action | Next state |
|---|---|---|---|
| No active session | Operator opens detail (list or deep-link) | `setActive(id)` | Active = that session; bar visible |
| Active = A, not dirty | Operator opens detail B | `setActive(B.id)` | Active = B; bar shows B |
| Active = A, dirty | Operator opens detail B | `window.confirm("Discard unsaved notes?")` | — |
| ↳ confirm yes | — | `setDirty(false)` → `setActive(B.id)` | Active = B |
| ↳ confirm no | — | `navigate(-1)` (or to `/` if deep-link) | Active stays A |
| Active = A | Operator clicks "Close session" in bar | `window.confirm` → `closeActive()` | Active = null; bar hidden |
| Any (authenticated) | Full page refresh | react-query refetches `GET /sessions/active` | Restored from server |
| Any | Logout / token invalid | All react-query cache cleared; `active` → null | Bar hidden |

**What must NOT be inside the bar component**: any API call, any navigation logic beyond `useNavigate().push('/sessions/:id')` for the Resume button, any dirty-flag write. The bar is purely presentational + two button handlers that call the hook.

**Transaction boundary (client-side)**: `setActive` is a single mutation; no multi-write. The detail screen's `setDirty(false)` + `setActive` are two sequential calls; if `setActive` fails the dirty flag stays true (safe: operator keeps their notes).

## 5. Tests

- `useActiveSession` returns `active: null` and bar renders nothing when `GET /sessions/active` resolves with `null`.
- `useActiveSession` populates `active` after successful `GET /sessions/active`; bar shows name, status, and a non-zero elapsed string.
- `setActive` calls `PUT /sessions/active` with the correct body and refetches; on 404 the returned promise rejects with `session_not_found`.
- `closeActive` calls `POST /sessions/:id/close`; on success `active` becomes null and bar unmounts.
- Elapsed time re-renders: after two ticks the displayed seconds increment (use fake timers).
- Bar "Resume" button navigates to `/sessions/:active.id`.
- Bar "Close session" calls `closeActive` only after `window.confirm` returns true; does not call it when confirm is false.
- Detail screen on mount: no active session → `setActive` called with route param id.
- Detail screen on mount: different active session, dirty → confirm shown; cancel → `navigate(-1)` and `setActive` not called.
- Detail screen on mount: different active session, dirty → confirm yes → `setDirty(false)` and `setActive` called.
- Detail screen on mount: same active session → no mutation, no confirm.
- Deep-link to `/sessions/:id` (no prior navigation): `setActive` called, bar visible.
- Logout (clear query client) → `active` is null, bar not rendered.

## 6. Manifest

<!-- manifest
src/features/sessions/dirty-context.tsx | reads: - | DirtyContext, useDirty hook, DirtyProvider
src/features/sessions/use-active-session.ts | reads: src/features/sessions/dirty-context.tsx | ActiveSession type, useActiveSession hook (query + mutations)
src/features/sessions/active-session-bar.tsx | reads: src/features/sessions/use-active-session.ts | ActiveSessionBar component (presentational bar)
src/app/authenticated-layout.tsx | reads: src/features/sessions/active-session-bar.tsx | Authenticated layout with bar above outlet
src/features/sessions/session-detail.tsx | reads: src/features/sessions/use-active-session.ts, src/features/sessions/dirty-context.tsx | Detail screen: activates session on mount, writes dirty flag via context
test/use-active-session.test.ts | reads: src/features/sessions/use-active-session.ts, src/features/sessions/dirty-context.tsx | Hook: fetch, setActive, closeActive, error paths
test/active-session-bar.test.tsx | reads: src/features/sessions/active-session-bar.tsx, src/features/sessions/use-active-session.ts, src/features/sessions/dirty-context.tsx | Bar: rendering, elapsed tick, resume nav, close confirm
-->
