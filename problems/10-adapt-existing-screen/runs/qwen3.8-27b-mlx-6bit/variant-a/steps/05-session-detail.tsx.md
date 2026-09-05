# 05-session-detail.tsx

## reasoning

```
Let me analyze what's needed for `src/features/sessions/session-detail.tsx` based on the plan and references.

From PLAN.md, this file:
- Is at `src/features/sessions/session-detail.tsx`
- On mount: if session.id !== useActiveSession().active?.id →
  - if active && useDirty().isDirty → window.confirm; on cancel navigate(-1).
  - call setActive(session.id); setDirty(false).
- Existing dirty-flag logic now writes through useDirty().setDirty() instead of local state.
- Reads: `src/features/sessions/use-active-session.ts`, `src/features/sessions/dirty-context.tsx`

The plan specifies:
- Activation trigger: the detail screen sets itself active on mount (covers both list-click and deep-link uniformly).
- Dirty flag sharing: a small React context (`DirtyContext`) sits above the detail route; the detail screen writes, the bar reads.
- "Ordering rule": `setActive` must complete before the detail screen renders its editable form (gate on `isMutating`).

Let me think about what this component needs:

1. Get the session id from route params (using `useParams` from react-router)
2. Fetch the session data (for detail display)
3. On mount, activate the session via `setActive`
4. Track dirty state via `useDirty().setDirty()`
5. Handle the confirm when switching from a dirty active session to a different one
6. Gate rendering on `isMutating`

From the plan's control flow:
- No active session → setActive called with route param id
- Different active session, not dirty → setActive(B.id)
- Different active session, dirty → confirm shown; cancel → navigate(-1) and setActive not called
- Different active session, dirty → confirm yes → setDirty(false) and setActive called
- Same active session → no mutation, no confirm

The plan says:
- "On mount: if session.id !== useActiveSession().active?.id →"
  - "if active && useDirty().isDirty → window.confirm; on cancel navigate(-1)."
  - "call setActive(session.id); setDirty(false)."

Wait, let me re-read: "On mount: if session.id !== useActiveSession().active?.id → if active && useDirty().isDirty → window.confirm; on cancel navigate(-1). call setActive(session.id); setDirty(false)."

So the flow is:
1. On mount, check if current session id differs from active session id
2. If different:
   a. If there IS an active session AND it's dirty → window.confirm("Discard unsaved notes?")
      - If cancel → navigate(-1), don't setActive
      - If confirm → setDirty(false), proceed to setActive
   b. Call setActive(session.id)
3. If same → do nothing

Also from the plan: "Existing dirty-flag logic now writes through useDirty().setDirty() instead of local state."

This means the detail screen has an editable form (notes) and when the user makes changes, it calls `setDirty(true)`.

Now, what does the detail screen actually render? The plan says it's a "session detail screen" that shows session details with editable notes. The scaffold already has this screen - we're modifying it.

Since I don't have the original `session-detail.tsx` file, I need to write a complete one that:
- Shows session details (name, status, notes field)
- Activates the session on mount
- Tracks dirty state via context
- Gates form rendering on `isMutating`

Let me think about what imports I need:
- React: useEffect, useState, useCallback
- react-router-dom: useParams, useNavigate
- @tanstack/react-query: useQuery (for fetching the session itself)
- From our files: useActiveSession, useDirty

Wait - the plan says the file reads `src/features/sessions/use-active-session.ts` and `src/features/sessions/dirty-context.tsx`. It doesn't mention fetching the session detail itself. But a detail screen needs to show the session data...

Actually, looking at the plan more carefully:
- "Opening a session from the list makes it the active session"
- The detail screen shows "name, status, elapsed time" (that's the bar)
- The detail screen has "detail editing + dirty-flag warning on route change"

So the detail screen needs to:
1. Fetch the session by id (for displaying/editing)
2. Have a notes field that can be edited
3. Track dirty state
4. Activate the session on mount

Let me write this. I'll use `useParams` to get the id, `useQuery` to fetch the session, and implement the activation logic.

Actually wait - I need to be careful. The plan says "Implement exactly what the plan specifies for this file." Let me re-read what's specified:

From the manifest:
```
src/features/sessions/session-detail.tsx | reads: src/features/sessions/use-active-session.ts, src/features/sessions/dirty-context.tsx | Detail screen: activates session on mount, writes dirty flag via context
```

From section 3 (Types and signatures):
```ts
// src/features/sessions/session-detail.tsx  (modified)
// On mount: if session.id !== useActiveSession().active?.id →
//   if active && useDirty().isDirty → window.confirm; on cancel navigate(-1).
//   call setActive(session.id); setDirty(false).
// Existing dirty-flag logic now writes through useDirty().setDirty() instead of local state.
```

From section 4 (Control flow):
- The detail screen activates on mount
- Dirty flag confirmation when switching

The plan doesn't explicitly specify the full UI of the detail screen (what fields it shows, what the form looks like). It's described as a "(modified)" file - meaning it already exists and we're modifying it. But since I'm writing it complete, I need to include the full component.

Let me think about what a reasonable session detail screen would contain:
- Session name (display)
- Status (display)  
- Notes field (editable textarea)
- Maybe some other fields

The key behaviors to implement:
1. Fetch session by id from route param
2. On mount, activate the session (with dirty check)
3. Track dirty state when notes are edited
4. Gate form rendering on `isMutating` (from the ordering rule)

For the fetch of the session itself, I'll use `useQuery` with a key like `['sessions', id]`.

Let me also consider: the plan mentions "detail editing + dirty-flag warning on route change" as an existing behavior. The dirty flag warning on route change is typically a `useBlocker` or similar react-router feature. But the plan's focus for this file is the activation logic and dirty context integration.

Actually, re-reading the plan's "Existing behaviors that must not regress": "detail editing + dirty-flag warning on route change". This means the detail screen already has a mechanism to warn on route change when dirty. In react-router v6.4+, this is `useBlocker`. But the plan doesn't explicitly ask me to implement that here - it says "existing" behavior.

However, since I'm writing the file complete, I should include it. The dirty flag is now in context, so the route-change blocker would use `useDirty().isDirty`.

Let me structure the component:

```tsx
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSession, ApiError } from './use-active-session';
import { useDirty } from './dirty-context';

interface SessionDetail {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string;
  notes: string;
}

export function SessionDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { active, setActive, isMutating } = useActiveSession();
  const { isDirty, setDirty } = useDirty();

  // Fetch the session detail
  const { data: session, isLoading } = useQuery<SessionDetail>({
    queryKey: ['sessions', id],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${id}`, { credentials: 'include' });
      if (!res.ok) throw new ApiError('session_not_found', `Session ${id} not found`);
      return res.json();
    },
  });

  // Local state for the notes field
  const [notes, setNotes] = useState('');

  // Initialize notes when session loads
  useEffect(() => {
    if (session) {
      setNotes(session.notes);
    }
  }, [session?.id]);

  // Activation on mount
  useEffect(() => {
    if (!id) return;
    
    if (active && active.id !== id) {
      // Different session is active
      if (isDirty) {
        const confirmed = window.confirm('Discard unsaved notes?');
        if (!confirmed) {
          navigate(-1);
          return;
        }
        setDirty(false);
      }
    }
    
    if (!active || active.id !== id) {
      setActive(id);
    }
  }, []); // Only on mount

  // ... render
}
```

Wait, there's a problem. The `useEffect` with empty deps array captures stale values. But the plan says "on mount" so it should only run once. However, `active` and `isDirty` might not be available yet on the very first render (react-query fetches are async).

Hmm, this is tricky. The plan says:
- "On mount: if session.id !== useActiveSession().active?.id →"

The `useActiveSession()` hook uses react-query, so `active` will be `undefined` initially (while fetching), then become the value. On a fresh page load, `active` won't be set until the query resolves.

I think the correct approach is:
- The activation effect should wait for both `active` to be resolved (not fetching) AND the session to be loaded
- Or, more practically: the effect runs when `active` transitions from undefined/fetching to a settled value

Actually, let me reconsider. The plan says "On mount" but in practice with react-query, the active session data arrives asynchronously. The most defensible reading is:

The activation logic should run once the active session query has settled (i.e., `isFetching` is false for the first time after mount). At that point, we compare and decide.

Let me use a ref to track whether we've already done the activation check:

```tsx
const activationDone = useRef(false);

useEffect(() => {
  if (!id || activationDone.current) return;
  if (isFetching) return; // Wait for active session to resolve
  
  activationDone.current = true;
  
  if (active && active.id !== id) {
    if (isDirty) {
      const confirmed = window.confirm('Discard unsaved notes?');
      if (!confirmed) {
        navigate(-1);
        return;
      }
      setDirty(false);
    }
  }
  
  if (!active || active.id !== id) {
    setActive(id);
  }
}, [id, active, isFetching, isDirty, navigate, setDirty, setActive]);
```

Hmm, but this is getting complex. Let me think about what the plan really specifies.

The plan says:
- "On mount: if session.id !== useActiveSession().active?.id → if active && useDirty().isDirty → window.confirm; on cancel navigate(-1). call setActive(session.id); setDirty(false)."

I think the simplest and most correct interpretation is:
1. Wait for the active session query to settle
2. Compare current route param id with active.id
3. If different and there's an active session that's dirty → confirm
4. If different (and not blocked by dirty) → setActive

The "gate on isMutating" rule means: don't render the editable form until `setActive` completes.

Let me also consider: what does "session.id" mean in the plan? It's the id from the route params (the session we're navigating to). And `useActiveSession().active?.id` is the currently active session's id.

Now for the notes/dirty tracking:
- When the user types in the notes field, `setDirty(true)` is called
- The dirty state persists in the context (so it survives the bar checking it)

Let me also think about what to render:
- Loading state while session is being fetched
- The session details (name, status, startedAt)
- An editable notes textarea
- The form is gated on `!isMutating` (i.e., only show editable form after setActive completes)

Actually wait - the plan says "setActive must complete before the detail screen renders its editable form (gate on isMutating)." So while `isMutating` is true, we show a loading/placeholder state for the form.

Let me also handle the "unauthenticated" case - but that's handled by react-query retry → redirect to login, so I don't need to do anything special here.

For the notes save - the plan doesn't explicitly mention a save button or auto-save. It mentions "detail editing + dirty-flag warning on route change" as existing behavior. I'll include a save button that calls an endpoint and clears the dirty flag on success. Actually, the plan doesn't specify a save endpoint or mechanism beyond "dirty-flag warning on route change." Let me keep it simple: the notes field is editable, and there's a save button.

Actually, I'm overthinking this. The plan focuses on:
1. Activation on mount
2. Dirty flag via context

The rest (display, editing) is "existing" behavior that I'm preserving. Let me write a reasonable detail screen that has these elements without over-engineering.

Let me also consider: the plan says "Existing dirty-flag logic now writes through useDirty().setDirty() instead of local state." This implies there WAS local state for dirty before, and now it goes through context. The component still needs to track the notes value locally (it's form state), but the "is this form dirty" flag goes to context.

Let me write the final version:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSession, ApiError } from './use-active-session.ts';
import { useDirty } from './dirty-context.tsx';

interface SessionDetail {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string;
  notes: string;
}

export function SessionDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { active, isFetching: activeIsFetching, setActive, isMutating } = useActiveSession();
  const { setDirty } = useDirty();

  const { data: session, isLoading } = useQuery<SessionDetail>({
    queryKey: ['sessions', id],
    queryFn: async (): Promise<SessionDetail> => {
      const res = await fetch(`/api/sessions/${id}`, { credentials: 'include' });
      if (!res.ok) {
        throw new ApiError('session_not_found', `Session ${id} not found`);
      }
      return (await res.json()) as SessionDetail;
    },
    enabled: id !== undefined,
  });

  const [notes, setNotes] = useState('');

  // Sync notes when session data arrives
  useEffect(() => {
    if (session) {
      setNotes(session.notes);
    }
  }, [session]);

  // Activation on mount (once, after active-session query settles)
  const activationRan = useRef(false);
  useEffect(() => {
    if (!id || activationRan.current) return;
    if (activeIsFetching) return;

    activationRan.current = true;

    if (active && active.id !== id) {
      const { isDirty } = useDirty(); // Can't call hook conditionally!
    }
  }, []);
```

Wait, I can't call `useDirty()` conditionally inside an effect. It's a hook. I need to get it at the top level and use it in the effect.

Let me restructure:

```tsx
const { isDirty, setDirty } = useDirty();

useEffect(() => {
  if (!id || activationRan.current) return;
  if (activeIsFetching) return;

  activationRan.current = true;

  if (active && active.id !== id) {
    if (isDirty) {
      const confirmed = window.confirm('Discard unsaved notes?');
      if (!confirmed) {
        navigate(-1);
        return;
      }
      setDirty(false);
    }
  }

  if (!active || active.id !== id) {
    void setActive(id);
  }
}, [id, active, activeIsFetching, isDirty, navigate, setDirty, setActive]);
```

This is better. The effect will run when `activeIsFetching` becomes false (meaning the query has settled), and then do the activation check. The `activationRan` ref ensures it only runs once.

Now for the rendering:
- If no id → shouldn't happen (route param required), but handle gracefully
- If session is loading → show loading
- If isMutating (setActive in progress) → show a waiting state for the form
- Otherwise → show the full detail with editable notes

For the notes change handler:
```tsx
const handleNotesChange = (value: string) => {
  setNotes(value);
  setDirty(true);
};
```

For save:
```tsx
const handleSave = async () => {
  // PUT /api/sessions/:id/notes or similar
  // On success: setDirty(false)
};
```

Actually, the plan doesn't specify a save endpoint. Let me keep it minimal - just the editable textarea that sets dirty. The plan's focus is on activation and dirty context, not the save mechanism.

Wait, but "detail editing" is mentioned as existing behavior. I should include a basic save mechanism to be complete. Let me add a simple save that PUTs the notes.

Hmm, but the plan says "Do not add an export, a feature or a file the plan does not name." The plan doesn't name a save endpoint. Let me just have the editable field and dirty tracking, without a save button. The plan's scope for this file is: "activates session on mount, writes dirty flag via context."

Actually, looking again at the plan's "Existing behaviors that must not regress": "detail editing + dirty-flag warning on route change." This implies the detail screen HAS editing (a form) and HAS a route-change warning. Since I'm writing the complete file, I should include these.

For the route-change warning, in React Router 6.4+, you use `useBlocker`. Let me include that:

```tsx
const blocker = useBlocker(isDirty);
```

And render a dialog when `blocker.state === 'blocked'`.

But wait - the plan doesn't explicitly mention `useBlocker` or a route-change dialog component. It just says this is "existing behavior." Since I'm writing the file complete and it's supposed to preserve this behavior, I should include it.

Actually, let me be more careful. The plan says "Do not add an export, a feature or a file the plan does not name." But "detail editing + dirty-flag warning on route change" IS named as existing behavior that must not regress. So including it is required, not an addition.

Let me include `useBlocker` for the dirty-flag warning on route change.

Let me finalize my approach:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSession, ApiError } from './use-active-session.ts';
import { useDirty } from './dirty-context.tsx';

interface Session {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string;
  notes: string;
}

export function SessionDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { active, isFetching: activeIsFetching, setActive, isMutating } = useActiveSession();
  const { isDirty, setDirty } = useDirty();

  // Block navigation when dirty
  const blocker = useBlocker(isDirty);

  // Fetch session
  const { data: session, isLoading } = useQuery<Session>({
    queryKey: ['sessions', id],
    queryFn: async (): Promise<Session> => {
      const res = await fetch(`/api/sessions/${id}`, { credentials: 'include' });
      if (!res.ok) throw new ApiError('session_not_found', `Session ${id} not found`);
      return (await res.json()) as Session;
    },
    enabled: id !== undefined,
  });

  // Local notes state
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (session) {
      setNotes(session.notes);
    }
  }, [session]);

  // Activate on mount
  const activationRan = useRef(false);
  useEffect(() => {
    if (!id || activationRan.current) return;
    if (activeIsFetching) return;

    activationRan.current = true;

    if (active && active.id !== id) {
      if (isDirty) {
        const confirmed = window.confirm('Discard unsaved notes?');
        if (!confirmed) {
          navigate(-1);
          return;
        }
        setDirty(false);
      }
    }

    if (!active || active.id !== id) {
      void setActive(id);
    }
  }, [id, active, activeIsFetching, isDirty, navigate, setDirty, setActive]);

  const handleNotesChange = (value: string): void => {
    setNotes(value);
    setDirty(true);
  };

  // Render
  if (!id) return <p>Session not found.</p>;
  if (isLoading || !session) return <p>Loading session…</p>;

  // Dirty-flag route-change blocker
  if (blocker.state === 'blocked') {
    return (
      <div>
        <p>You have unsaved changes. Leave anyway?</p>
        <button onClick={() => blocker.proceed()}>Leave</button>
        <button onClick={() => blocker.reset()}>Stay</button>
      </div>
    );
  }

  return (
    <article>
      <h1>{session.name}</h1>
      <p>Status: {session.status}</p>
      <p>Started: {new Date(session.startedAt).toLocaleString()}</p>
      
      <section>
        <h2>Notes</h2>
        {isMutating ? (
          <p>Synchronising…</p>
        ) : (
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            rows={10}
          />
        )}
      </section>
    </article>
  );
}
```

Wait, I need to reconsider the import paths. The references show:
- `src/features/sessions/use-active-session.ts` 
- `src/features/sessions/dirty-context.tsx`

Since this file is also in `src/features/sessions/`, the imports would be relative:
- `./use-active-session.ts` or just `./use-active-session`
- `./dirty-context.tsx` or just `./dirty-context`

In ESM with TypeScript, the extension might or might not be needed depending on the config. Looking at the reference files, they don't show how they import each other (the use-active-session.ts doesn't import dirty-context). Let me use no extension since that's more common in TS projects.

Actually wait - the project is ESM (`"type": "module"`). In strict ESM, you typically need extensions. But with TypeScript and certain bundler configs, extensions are optional. The reference files don't show cross-imports between these two files. Let me use no extension to be safe, as that's the most common TS pattern.

Let me also reconsider: do I need `useBlocker`? Looking at the plan again: "detail editing + dirty-flag warning on route change" is listed as "Existing behaviors that must not regress." This means the original code had this. Since I'm rewriting the file, I should preserve it.

However, `useBlocker` is from `react-router-dom` v6.4+ (data router). The plan mentions "router" in the scaffold description. I'll assume it's available.

Actually, I realize I should double-check: the plan says "Do not add an export, a feature or a file the plan does not name." The `useBlocker` is not explicitly named in the plan. But "dirty-flag warning on route change" IS named as a behavior to preserve. I think including it is correct since it's preserving existing behavior, not adding new functionality.

Let me also reconsider the `ApiError` import. The reference file exports it from `use-active-session.ts`. I'll import it for the session fetch error.

One more thought: the plan mentions "gate on isMutating" for the editable form. The `isMutating` from `useActiveSession()` covers both setActive and closeActive mutations. In the context of the detail screen, it's specifically the setActive that matters. But using the combined `isMutating` is fine since closeActive wouldn't typically be in-flight on the detail screen (it's triggered from the bar).

I think my solution is solid. Let me clean it up and write the final version.

Actually, one more consideration: the `useEffect` for activation. The dependency array includes `active`, `isDirty`, etc. This means the effect will re-run when these values change. But the `activationRan` ref ensures the logic only executes once. However, there's a subtle issue: if `activeIsFetching` is initially true and then becomes false, the effect runs. But what if `isDirty` changes between the time `activeIsFetching` becomes false and when we check it? 

In practice, this is fine because:
1. On initial mount, `activeIsFetching` is true (query in flight)
2. When it becomes false, the effect runs
3. At that point, `isDirty` reflects the current state

If the user somehow sets dirty before the active session query resolves, we'd catch it. That's correct behavior.

But wait - there's another edge case. If the user navigates to detail B while on detail A (which is dirty), the component for B mounts fresh. The `isDirty` from context would still be true (from A's edits). So the confirm would show. That's correct per the plan!

I'm satisfied with the logic. Let me write the final version.

One more thing: should I handle the case where `active` is null (no active session)? In that case, we just call `setActive(id)` without any confirm. That's handled by my code: `if (!active || active.id !== id) { void setActive(id); }`.

Final check on the plan's requirements for this file:
✅ "activates session on mount" - done via useEffect + activationRan ref
✅ "writes dirty flag via context" - done via setDirty from useDirty()
✅ "if active && useDirty().isDirty → window.confirm; on cancel navigate(-1)" - done
✅ "call setActive(session.id); setDirty(false)" - done (setDirty(false) only when confirming to discard)
✅ "gate on isMutating" for editable form - done
✅ Preserves "detail editing + dirty-flag warning on route change" - done via useBlocker

I'm ready to write the final file.
```

## reply

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSession, ApiError } from './use-active-session';
import { useDirty } from './dirty-context';

interface Session {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string;
  notes: string;
}

export function SessionDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { active, isFetching: activeIsFetching, setActive, isMutating } = useActiveSession();
  const { isDirty, setDirty } = useDirty();

  // Block navigation while the form is dirty
  const blocker = useBlocker(isDirty);

  // Fetch the full session record for display/editing
  const { data: session, isLoading } = useQuery<Session>({
    queryKey: ['sessions', id],
    queryFn: async (): Promise<Session> => {
      const res = await fetch(`/api/sessions/${id}`, { credentials: 'include' });
      if (!res.ok) throw new ApiError('session_not_found', `Session ${id} not found`);
      return (await res.json()) as Session;
    },
    enabled: id !== undefined,
  });

  // Local editable state for the notes field
  const [notes, setNotes] = useState('');

  // Sync local notes when session data arrives
  useEffect(() => {
    if (session) {
      setNotes(session.notes);
    }
  }, [session]);

  // Activate this session on mount (runs once, after the active-session query settles)
  const activationRan = useRef(false);

  useEffect(() => {
    if (!id || activationRan.current) return;
    if (activeIsFetching) return;

    activationRan.current = true;

    // A different session is currently active — confirm before replacing if dirty
    if (active && active.id !== id) {
      if (isDirty) {
        const confirmed = window.confirm('Discard unsaved notes?');
        if (!confirmed) {
          navigate(-1);
          return;
        }
        setDirty(false);
      }
    }

    // Activate (or re-activate) this session on the server
    if (!active || active.id !== id) {
      void setActive(id);
    }
  }, [id, active, activeIsFetching, isDirty, navigate, setDirty, setActive]);

  const handleNotesChange = (value: string): void => {
    setNotes(value);
    setDirty(true);
  };

  // --- Dirty-flag route-change blocker ---
  if (blocker.state === 'blocked') {
    return (
      <div role="alertdialog" aria-labelledby="dirty-title">
        <p id="dirty-title">You have unsaved changes. Leave this screen?</p>
        <button type="button" onClick={() => blocker.proceed()}>Leave</button>{' '}
        <button type="button" onClick={() => blocker.reset()}>Stay</button>
      </div>
    );
  }

  if (!id) {
    return <p>Session not found.</p>;
  }

  if (isLoading || !session) {
    return <p>Loading session…</p>;
  }

  return (
    <article>
      <h1>{session.name}</h1>
      <dl>
        <dt>Status</dt>
        <dd>{session.status}</dd>
        <dt>Started</dt>
        <dd>{new Date(session.startedAt).toLocaleString()}</dd>
      </dl>

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes</h2>
        {isMutating ? (
          <p role="status">Synchronising…</p>
        ) : (
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            rows={10}
          />
        )}
      </section>
    </article>
  );
}
```
