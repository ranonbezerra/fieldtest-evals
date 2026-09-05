# 03-active-session-bar.tsx

## reasoning

```
Let me analyze what I need to write for `src/features/sessions/active-session-bar.tsx`.

From the PLAN.md:
- Renders the persistent bar. Returns null (renders nothing) when no active session.
- Shows: session name, status badge, elapsed time (ticking), "Resume" button, "Close session" button.
- "Close session": window.confirm → closeActive().
- The bar is purely presentational + two button handlers that call the hook.
- "What must NOT be inside the bar component": any API call, any navigation logic beyond `useNavigate().push('/sessions/:id')` for the Resume button, any dirty-flag write. The bar is purely presentational + two button handlers that call the hook.

From the plan's types:
```ts
export declare function ActiveSessionBar(): React.ReactElement | null;
```

The bar reads `useActiveSession()` hook which gives:
- `active: ActiveSession | null`
- `isFetching: boolean`
- `setActive: (sessionId: string) => Promise<void>`
- `closeActive: () => Promise<void>`
- `isMutating: boolean`

The bar needs:
1. If no active session → return null
2. Show session name, status badge, elapsed time (ticking via setInterval), "Resume" button, "Close session" button
3. Resume: `useNavigate().push('/sessions/:id')`
4. Close session: `window.confirm()` → `closeActive()`
5. Elapsed time computed from `startedAt` (ISO string) via a 1-second setInterval

Let me think about the structure:
- Import React (useState, useEffect, useCallback)
- Import useNavigate from react-router-dom
- Import useActiveSession from './use-active-session'

The component:
- Calls `useActiveSession()` to get `active`, `closeActive`, `isMutating`
- If `active` is null, return null
- Uses a local state for elapsed time (seconds), updated via setInterval every 1s
- Elapsed computed from `Date.now() - new Date(active.startedAt).getTime()`

For the Resume button: navigate to `/sessions/${active.id}`
For the Close button: `window.confirm('Close this session?')` then if true, call `closeActive()`

Let me write this:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveSession } from './use-active-session';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ActiveSessionBar(): React.ReactElement | null {
  const { active, closeActive, isMutating } = useActiveSession();
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const update = (): void => {
      setElapsed(Date.now() - new Date(active.startedAt).getTime());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [active?.id, active?.startedAt]);

  const handleResume = useCallback(() => {
    if (active) navigate(`/sessions/${active.id}`);
  }, [active, navigate]);

  const handleClose = useCallback(() => {
    if (!active) return;
    if (window.confirm('Close this session?')) {
      void closeActive();
    }
  }, [active, closeActive]);

  if (!active) return null;

  return (
    <div data-testid="active-session-bar" role="banner" aria-label="Active session">
      <span data-testid="active-session-name">{active.name}</span>
      <span data-testid="active-session-status" className={`status-badge status-${active.status}`}>
        {active.status}
      </span>
      <span data-testid="active-session-elapsed">{formatElapsed(elapsed)}</span>
      <button type="button" onClick={handleResume} disabled={isMutating}>
        Resume
      </button>
      <button type="button" onClick={handleClose} disabled={isMutating}>
        Close session
      </button>
    </div>
  );
}
```

Wait, let me reconsider the `useEffect` dependency. I should use `active?.id` and `active?.startedAt` to properly reset the timer when the active session changes. But since I return null early if `active` is null, and the effect has a guard, this should be fine.

Actually, looking more carefully at the useEffect dependency - I'm using `active?.id` and `active?.startedAt`. But `active` could be null. Let me restructure slightly.

Actually the pattern is fine - the effect runs when active changes, and if active is null it just returns early (no interval). When active becomes non-null, the effect re-runs with the new values.

Let me also think about whether I should use `useCallback` - the plan says the bar is "purely presentational + two button handlers that call the hook". So the handlers are fine.

One thing: the plan says "Returns null (renders nothing) when no active session." - I handle that with the early return.

Let me also consider: should I use `data-testid` attributes? The plan's tests reference specific behaviors. Looking at the test descriptions:
- "bar shows name, status, and a non-zero elapsed string"
- "Bar 'Resume' button navigates to /sessions/:active.id"
- "Bar 'Close session' calls closeActive only after window.confirm returns true"

Having test IDs makes the component testable. I'll include them as they're reasonable for a testable component.

I think this is solid. Let me finalize it.
```

## reply

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveSession } from './use-active-session';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ActiveSessionBar(): React.ReactElement | null {
  const { active, closeActive, isMutating } = useActiveSession();
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const update = (): void => {
      setElapsed(Date.now() - new Date(active.startedAt).getTime());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [active?.id, active?.startedAt]);

  const handleResume = useCallback((): void => {
    if (active) navigate(`/sessions/${active.id}`);
  }, [active, navigate]);

  const handleClose = useCallback((): void => {
    if (!active) return;
    if (window.confirm('Close this session?')) {
      void closeActive();
    }
  }, [active, closeActive]);

  if (!active) return null;

  return (
    <div data-testid="active-session-bar" role="banner" aria-label="Active session">
      <span data-testid="active-session-name">{active.name}</span>
      <span
        data-testid="active-session-status"
        className={`status-badge status-${active.status}`}
      >
        {active.status}
      </span>
      <span data-testid="active-session-elapsed">{formatElapsed(elapsed)}</span>
      <button type="button" onClick={handleResume} disabled={isMutating}>
        Resume
      </button>
      <button type="button" onClick={handleClose} disabled={isMutating}>
        Close session
      </button>
    </div>
  );
}
```
