# plan

## reasoning

```
Let me analyze the task carefully.

The task is to write a PLAN.md for a React + TypeScript frontend feature: a persistent active-session bar in an operations back-office. The scaffold already has login, sessions list, and session detail screens.

Let me think about what's needed:

1. **Assumptions** - What's left open?
   - The "active session" state: the API exposes `GET /sessions/active` as source of truth. So the server tracks which session is active. We need a `PUT /sessions/active` or similar to set it? Wait, the statement says "Opening a session from the list makes it the active session" - so there must be an API call to set the active session. Let me re-read: "the API exposes `GET /sessions/active`; use it as the source of truth". It doesn't explicitly say there's a `PUT /sessions/active` or `POST /sessions/:id/activate`. But logically there must be a way to set the active session. I'll assume there's a `PUT /sessions/active` that accepts `{ sessionId }`.
   - "close session" calls the existing close endpoint - so that already exists.
   - The elapsed time ticking: computed client-side from a `startedAt` timestamp on the session.
   - "unsaved notes" dirty flag: already exists on the detail screen. We need to access it from the bar (or from a shared context).
   - Router: react-router. The bar is visible on "every authenticated screen" - so it goes in a layout component that wraps all authenticated routes.
   - State management: react-query for server state. The active session is server state (fetched via GET /sessions/active). The dirty flag is client-side UI state.
   - Confirm dialogs: simple browser confirm() or a custom modal? I'll assume a lightweight inline confirm (or window.confirm) to keep it simple. Actually, for a back-office, a small modal is more appropriate. I'll choose: use a lightweight confirmation dialog component (no external lib).
   - The "replace with confirm if unsaved notes" logic: when opening session B while session A is active and dirty, show confirm. If confirmed, set B as active.

2. **Data model** - No new persistence in the frontend. The server already has sessions and an "active session" pointer. The frontend doesn't add tables. So "none".

3. **Types and signatures** - This is the meat. Let me enumerate:
   - `ActiveSession` type (what GET /sessions/active returns)
   - The bar component: `ActiveSessionBar`
   - A custom hook: `useActiveSession` (wraps react-query for GET /sessions/active + mutation to set active)
   - `useDirtyFlag` or the dirty flag is already on the detail screen - we need to lift it or use a shared context
   - Actually, re-reading: "the detail screen already tracks a dirty flag" - so it exists. We need to expose it so the bar can check it before replacing. This suggests a context or a lifted state.
   - `setActiveSession(sessionId: string): Promise<void>` - the mutation
   - `closeSession(): Promise<void>` - calls existing close endpoint
   - The bar component's props (or it reads from hooks directly)

4. **Control flow** - State machine for the active session:
   - No active session → bar hidden/empty
   - Active session set → bar shows (name, status, elapsed)
   - Opening another session while active+dirty → confirm → replace
   - Close → confirm → call close API → bar empties
   - Refresh → GET /sessions/active repopulates

5. **Tests** - Test the bar rendering, the hook behavior, the confirm logic, the dirty flag interaction.

6. **Manifest** - Files to create/modify.

Let me think about file structure:
- `src/features/sessions/active-session-bar.tsx` - the bar component
- `src/features/sessions/use-active-session.ts` - the hook
- `src/features/sessions/dirty-flag-context.tsx` - context for dirty flag (or maybe it's simpler: the detail screen already has a dirty flag, and we lift it to a context)
- `src/features/sessions/active-session-bar.test.tsx` - tests
- `src/features/sessions/use-active-session.test.ts` - hook tests

Wait, the conventions say:
- `src/<feature>/<feature>.module.ts` - but this is a React app, not NestJS. The conventions at the top are for the codebase's API side (NestJS). The task is a frontend React app. Let me re-read the conventions...

Actually, looking again at the conventions: "TypeScript (strict), Node 20+. NestJS for the API. Prisma as the ORM, PostgreSQL as the database." - These are the backend conventions. But the task is about a React frontend. The layout shows `src/<feature>/<feature>.module.ts` etc. which is NestJS structure.

But the task says "The scaffold is an operations back-office (React + TS + react-query + router)". So the frontend is React. The conventions about NestJS/Prisma don't apply to the frontend files.

For the frontend, I'll use:
- `src/features/sessions/` as the feature directory
- kebab-case file names (matching the convention)

Let me think about what files I'm writing:
- `src/features/sessions/active-session-bar.tsx` - the persistent bar component
- `src/features/sessions/use-active-session.ts` - react-query hook for active session
- `src/features/sessions/dirty-context.tsx` - React context to share dirty flag
- `src/app/layout.tsx` or wherever the authenticated layout is - modified to include the bar
- `src/features/sessions/session-detail.tsx` - modified to use dirty context
- `test/active-session-bar.test.tsx`
- `test/use-active-session.test.ts`

Actually, I need to be careful. The task says "Deliver the edit as a coherent diff + tests". So I'm modifying existing files and creating new ones.

Let me think about the dirty flag more carefully. The detail screen "already tracks a dirty flag". For the bar to check it when replacing, we need to share it. Options:
1. Lift dirty state to a context (DirtyProvider)
2. Use a simple event bus
3. Use react-query cache

I'll go with a lightweight context: `DirtyContext` with `{ isDirty: boolean }`. The detail screen writes to it, the bar reads from it.

Now for the API:
- `GET /sessions/active` → returns `{ id, name, status, startedAt }` or `null` if no active session
- Setting active: `PUT /sessions/active` with body `{ sessionId: string }` → returns the active session
- Close: `POST /sessions/:id/close` (existing)

Let me now structure the PLAN.md properly.

For types:
```typescript
// What GET /sessions/active returns
interface ActiveSession {
  id: string;
  name: string;
  status: SessionStatus; // 'open' | 'closed'
  startedAt: string; // ISO 8601
}

type SessionStatus = 'open' | 'closed';
```

The hook:
```typescript
function useActiveSession(): {
  data: ActiveSession | null;
  isPending: boolean;
  setActive: (sessionId: string) => Promise<void>;
  closeActive: () => Promise<void>;
  isMutating: boolean;
}
```

The context:
```typescript
interface DirtyState {
  isDirty: boolean;
}
// DirtyContext: React.Context<DirtyState>
// useDirty(): DirtyState  (reads)
// setDirty(isDirty: boolean): void (called by detail screen)
```

Actually, for the dirty context, I need both read and write. Let me think...

The detail screen sets `isDirty = true` when the operator types in notes. It sets `isDirty = false` on save or navigate. The bar reads `isDirty` before replacing.

```typescript
interface DirtyContextValue {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
}
const DirtyContext = React.createContext<DirtyContextValue | null>(null);
function useDirty(): DirtyContextValue { ... } // throws if no provider
```

The bar component:
```typescript
function ActiveSessionBar(): React.ReactElement | null;
```

It reads from `useActiveSession()` and `useDirty()`.

For the "elapsed time ticking" - a small interval that re-renders every second to update the elapsed display. I'll put this in the bar component with a `useEffect` + `setInterval`.

Now, the confirm flow:
1. Operator clicks "open session B" on the list screen (or navigates to detail of B)
2. If there's already an active session A, and `useDirty().isDirty` is true → show confirm dialog
3. If confirmed → call `setActive(B.id)` → bar updates
4. If not confirmed → do nothing (stay on current view)

Wait, actually "opening a session from the list makes it the active session" - so the act of navigating to the detail sets it as active. The confirm happens before that navigation.

Let me think about where the "open session" action lives. It's on the list screen - clicking a session row navigates to `/sessions/:id`. We need to intercept that: before navigating, check if there's a dirty active session, confirm if so, then navigate AND set the new session as active.

Actually, a cleaner approach: when you arrive at the detail screen (`/sessions/:id`), that's when it becomes active. So in the detail screen's `useEffect`, if this session ID differs from the current active, call `setActive(id)` (with confirm if dirty). But that's awkward because the confirm blocks navigation.

Better: intercept at the list level. The list has a "view session" action. That action:
1. If active session exists and is dirty → confirm("You have unsaved notes. Open this session and discard?")
2. Navigate to `/sessions/:id`
3. The detail screen, on mount, if its id !== activeSession.id → calls setActive(id)

Or even simpler: the "set active" call happens as part of the navigation from the list. The detail screen, when deep-linked directly (no active session yet), also sets itself as active.

Let me settle on: **Setting the active session happens in a shared hook that both the list (on click) and the detail (on mount for deep-link) call.** The confirm logic is in a helper that both use.

Actually, let me simplify. The rule is: "Opening a session from the list makes it the active session." And for deep-linking to detail: "deep-linking directly to a detail URL" must not regress. So deep-linking should also set the session as active (otherwise the bar wouldn't show for deep-linked sessions, which contradicts "visible on every authenticated screen" once you're in a session).

So: **Whenever the operator lands on a session detail screen, that session becomes active** (replacing any previous one, with confirm if dirty). This handles both list-click and deep-link uniformly.

The confirm: happens before the `setActive` call. If the operator cancels, they stay on the detail screen but the PREVIOUS session remains active. That's a bit odd. Alternative: if they cancel, they're navigated back to where they came from. But for deep-link there's no "back".

I think the cleanest behavior:
- On detail screen mount, if `session.id !== activeSession?.id`:
  - If `activeSession && isDirty` → show confirm
    - Confirm → `setActive(session.id)`, clear dirty
    - Cancel → navigate back (to list if came from list; to home if deep-linked)
  - Else → `setActive(session.id)` directly

This is clean. Let me go with this.

Now for the manifest - what files am I writing?

New files:
- `src/features/sessions/active-session-bar.tsx`
- `src/features/sessions/use-active-session.ts`
- `src/features/sessions/dirty-context.tsx`

Modified files (I'll list them but note they're modified):
- `src/features/sessions/session-detail.tsx` (wraps in DirtyProvider, calls setActive on mount)
- `src/features/sessions/session-list.tsx` (no change needed if the detail handles it)
- `src/app/authenticated-layout.tsx` (adds ActiveSessionBar)
- Maybe a confirm dialog component

Actually, for the PLAN.md I should focus on what's being created/changed and specify interfaces. Let me not over-specify the list screen since it doesn't need changes (the detail handles activation).

Let me also think about the confirm dialog. I'll use a simple inline component rather than pulling in a library:
- `src/features/sessions/confirm-dialog.tsx` - a small modal with "Confirm" / "Cancel" buttons

Or even simpler: use `window.confirm()`. For a back-office, that's acceptable and avoids extra code. I'll choose `window.confirm()` to keep the diff minimal. Actually no, the task says "with confirm" which in UI terms usually means a proper dialog. But for plan purposes, I'll specify it as a simple confirm dialog component and let the implementer choose. Actually, let me just use `window.confirm()` - it's a back-office, it's pragmatic, and it reduces the diff. I'll note this in assumptions.

Wait, let me reconsider. The task says "Deliver the edit as a coherent diff + tests in the app's style." Using window.confirm is fine for a back-office. I'll go with it.

Let me now write the plan concisely.

Files I'm listing in the manifest:
1. `src/features/sessions/dirty-context.tsx` - new
2. `src/features/sessions/use-active-session.ts` - new
3. `src/features/sessions/active-session-bar.tsx` - new
4. `test/active-session-bar.test.tsx` - new
5. `test/use-active-session.test.ts` - new

Modified (I'll note in assumptions that these are modified, not new):
- `src/app/authenticated-layout.tsx` - add bar
- `src/features/sessions/session-detail.tsx` - activate on mount, use dirty context

For the manifest, I should only list files I'm writing. Modified files are also "written" in the sense of producing a diff. Let me include them.

Actually re-reading the manifest format: "List only files you will write." I interpret this as all files that appear in the diff. So modified files count.

Let me finalize my structure and write it out.
```

## reply

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
