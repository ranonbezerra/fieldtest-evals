# 07-active-session-bar.test.tsx

## reasoning

```
Let me analyze the test cases I need to implement from `steps/07-active-session-bar.test.tsx-cases.txt`:

1. Renders nothing when no active session
2. Renders session name, status badge, and a non-zero elapsed string when an active session exists
3. Elapsed time ticks forward after two intervals (fake timers advanced 2000ms)
4. Elapsed display formats hours, minutes, and seconds correctly at each threshold (59s, 61s, 3601s)
5. Interval is cleared when the active session changes to a different `id`
6. Interval is cleared when `active` transitions to `null`
7. "Resume" button navigates to `/sessions/<active.id>`
8. "Resume" does nothing (no navigation) when `active` is `null`
9. "Close session" calls `closeActive` only when `window.confirm` returns `true`
10. "Close session" does not call `closeActive` when `window.confirm` returns `false`
11. Both buttons are disabled while `isMutating` is `true`
12. Re-rendering with the same active session does not create a second interval
13. Component does not crash when `active.startedAt` is an invalid ISO string

Now let me think about the implementation:

- I need to mock `useActiveSession` from `./src/features/sessions/use-active-session`
- I need to mock `react-router-dom`'s `useNavigate`
- I'll use Vitest with React Testing Library (or similar)
- For fake timers, I'll use `vi.useFakeTimers()`

Let me think about the structure:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ActiveSessionBar } from '../src/features/sessions/active-session-bar';
import { useActiveSession } from '../src/features/sessions/use-active-session';

// Mock the hook
vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: vi.fn(),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));
```

Wait, I need to think about what testing library is available. The plan says "Vitest" and the project uses React + TS. I'll assume `@testing-library/react` is available since it's standard for React testing with Vitest.

Let me also think about the mock structure. The `useActiveSession` hook returns:
```ts
{
  active: ActiveSession | null;
  isFetching: boolean;
  setActive: (sessionId: string) => Promise<void>;
  closeActive: () => Promise<void>;
  isMutating: boolean;
}
```

For the `useNavigate` mock, I need to mock it from `react-router-dom`.

Let me write the test file now:

For case 4 (formatting at thresholds), I need to set up `active.startedAt` such that the elapsed time is exactly 59s, 61s, and 3601s. I'll set `Date.now()` to a fixed value and compute `startedAt` accordingly.

For case 5 (interval cleared when session changes), I need to render with session A, then re-render with session B, and verify only one interval is running.

For case 12 (re-rendering with same session doesn't create second interval), I need to verify that the `setInterval` is called only once across the lifecycle.

For case 13 (invalid ISO string), I need to verify the component doesn't crash and doesn't show "NaN".

Let me think about how to count interval calls. I can spy on `setInterval` and `clearInterval`.

Actually, with fake timers, I can use `vi.useFakeTimers()` and then check the number of timers. But that's complex. A simpler approach is to spy on `setInterval` directly.

Wait, but the component uses `setInterval` from the global scope. If I use `vi.useFakeTimers()`, the fake timers replace the global `setInterval`. So I can spy on it.

Let me think more carefully:

```tsx
const setIntervalSpy = vi.spyOn(global, 'setInterval');
```

But with fake timers, this might not work as expected. Let me use a different approach.

Actually, with `vi.useFakeTimers()`, the global `setInterval` is replaced by the fake version. I can still spy on it:

```tsx
vi.useFakeTimers();
const setIntervalSpy = vi.spyOn(global, 'setInterval');
```

Hmm, but that might not capture calls made after `useFakeTimers` is called. Let me think...

Actually, a better approach: I'll just verify the behavior (the elapsed text changes) rather than counting intervals. But the test case specifically says "only one interval is alive" and "only one `setInterval` invocation across the lifecycle."

Let me use `vi.spyOn(globalThis, 'setInterval')` before calling `vi.useFakeTimers()`. Or I can check the number of pending timers with `vi.getTimerCount()`.

Actually, `vi.getTimerCount()` returns the number of pending timers. That's perfect for cases 5 and 12!

Let me restructure:

For case 5: Render with session A, advance time, get timer count (should be 1). Re-render with session B, advance time, get timer count (should still be 1, not 2).

For case 12: Render with session A, unmount, re-mount with same session A. Get timer count (should be 1).

Wait, but `vi.getTimerCount()` counts all pending timers, not just the ones from our component. In a test environment, there shouldn't be other timers, so it should be fine.

Actually, let me reconsider. The test cases say:
- Case 5: "after the swap only one interval is alive"
- Case 12: "only one `setInterval` invocation across the lifecycle"

For case 12, it's about the total number of `setInterval` calls, not the number of alive timers. So I should spy on `setInterval` to count invocations.

Let me use a different approach: I'll spy on `globalThis.setInterval` and count calls.

```tsx
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
```

And for counting, I can do:
```tsx
const spy = vi.spyOn(globalThis, 'setInterval');
// ... render ...
expect(spy).toHaveBeenCalledTimes(1);
```

But wait, with fake timers, `setInterval` is the fake one. If I spy on it before using fake timers, I might be spying on the real one and then fake timers replaces it.

Let me try a different approach. I'll use `vi.useFakeTimers()` and then check `vi.getTimerCount()`.

For case 5:
1. Render with session A (startedAt = now - 10s)
2. `vi.getTimerCount()` should be 1
3. Re-render with session B (different startedAt)
4. `vi.getTimerCount()` should be 1 (old one cleared, new one created)
5. Advance time, verify elapsed reflects B

For case 12:
1. Render with session A
2. `vi.getTimerCount()` should be 1
3. Unmount
4. `vi.getTimerCount()` should be 0 (cleanup ran)
5. Re-mount with same session A
6. `vi.getTimerCount()` should be 1 (not 2)

This works! Let me use this approach.

Now, for the `active` mock, I need to be able to change it between renders. I'll use a mutable object or a ref-like pattern.

Actually, the simplest approach with React Testing Library is to use `render` and then `rerender`. But since I'm mocking the hook, I need to control what it returns.

Let me set up the mock:

```tsx
const mockUseActiveSession = vi.fn();
vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: (...args) => mockUseActiveSession(...args),
}));
```

Wait, this won't work because `vi.mock` is hoisted. I need to use a different pattern.

The standard pattern is:

```tsx
vi.mock('../src/features/sessions/use-active-session');

import { useActiveSession } from '../src/features/sessions/use-active-session';

const mockUseActiveSession = useActiveSession as unknown as ReturnType<typeof vi.fn>;
```

Or I can use the `vi.mock` with a factory that references a variable:

```tsx
let mockReturnValue = { ... };

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: vi.fn(() => mockReturnValue),
}));
```

But the variable needs to be accessible. With Vitest's hoisting, I can use `vi.hoisted`:

Actually, the cleanest pattern in Vitest is:

```tsx
const { mockUseActiveSession } = vi.hoisted(() => ({
  mockUseActiveSession: vi.fn(),
}));

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: mockUseActiveSession,
}));
```

Then in tests: `mockUseActiveSession.mockReturnValue({ active: ..., ... })`.

Similarly for `useNavigate`:

```tsx
const { mockUseNavigate } = vi.hoisted(() => ({
  mockUseNavigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: mockUseNavigate,
}));
```

Now let me write the full test file.

For the `ActiveSession` type, I need:
```ts
interface ActiveSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string; // ISO-8601
}
```

Let me define a helper to create a mock active session:

```tsx
function makeActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'sess-1',
    name: 'Test Session',
    status: 'open',
    startedAt: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
    ...overrides,
  };
}
```

And a helper for the full hook return:

```tsx
function makeHookResult(overrides: Partial<UseActiveSessionResult> = {}) {
  return {
    active: null as ActiveSession | null,
    isFetching: false,
    setActive: vi.fn().mockResolvedValue(undefined),
    closeActive: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    ...overrides,
  };
}
```

Now let me think about each test case:

**Case 1: Renders nothing when no active session**
```tsx
it('renders nothing when no active session', () => {
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
  const { container } = render(<ActiveSessionBar />);
  expect(container.innerHTML).toBe('');
});
```

Wait, the component returns `null` when `active` is null. So `container.innerHTML` should be `''`. But actually, React might render an empty div or something. Let me check - if a component returns `null`, React renders nothing, so the container should be empty.

Actually, I should use `screen.queryByTestId('active-session-bar')` to check it's not present.

**Case 2: Renders session name, status badge, and non-zero elapsed string**
```tsx
it('renders session name, status badge, and a non-zero elapsed string', () => {
  const session = makeActiveSession({ startedAt: new Date(Date.now() - 5000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  render(<ActiveSessionBar />);
  
  expect(screen.getByTestId('active-session-name')).toHaveTextContent('Test Session');
  expect(screen.getByTestId('active-session-status')).toHaveTextContent('open');
  const elapsed = screen.getByTestId('active-session-elapsed').textContent;
  expect(elapsed).not.toBe('0s');
});
```

**Case 3: Elapsed time ticks forward after two intervals**
```tsx
it('elapsed time ticks forward after two intervals', () => {
  vi.useFakeTimers();
  const now = Date.now();
  const session = makeActiveSession({ startedAt: new Date(now - 5000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  
  render(<ActiveSessionBar />);
  const initialElapsed = screen.getByTestId('active-session-elapsed').textContent;
  
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  
  const laterElapsed = screen.getByTestId('active-session-elapsed').textContent;
  expect(laterElapsed).not.toBe(initialElapsed);
});
```

**Case 4: Elapsed display formats correctly at thresholds**
This needs three sub-cases or three separate `it` blocks. Let me do three separate ones for clarity.

Actually, I can do it in one test with three assertions by re-rendering:

```tsx
it('formats elapsed correctly at hour, minute, and second thresholds', () => {
  vi.useFakeTimers();
  const now = Date.now();
  
  // 59 seconds ago → "59s"
  let session = makeActiveSession({ startedAt: new Date(now - 59000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  const { rerender, unmount } = render(<ActiveSessionBar />);
  expect(screen.getByTestId('active-session-elapsed').textContent).toBe('59s');
  unmount();
  
  // 61 seconds ago → "1m 1s"
  session = makeActiveSession({ startedAt: new Date(now - 61000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  render(<ActiveSessionBar />);
  expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1m 1s');
  unmount();
  
  // 3601 seconds ago → "1h 0m 1s"
  session = makeActiveSession({ startedAt: new Date(now - 3601000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  render(<ActiveSessionBar />);
  expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1h 0m 1s');
  unmount();
});
```

Wait, but with fake timers, `Date.now()` is frozen. So when the component calls `Date.now()` in the effect, it gets the frozen time. That's fine - I just need to set `startedAt` relative to the frozen time.

Actually, let me be more careful. With `vi.useFakeTimers()`, `Date.now()` returns a fixed value (the time when fake timers were installed, or I can set it with `vi.setSystemTime`). Let me use `vi.setSystemTime` to be explicit.

```tsx
const fixedNow = new Date('2024-01-15T10:00:00.000Z').getTime();
vi.setSystemTime(fixedNow);
```

Then `startedAt` for 59s ago would be `new Date(fixedNow - 59000).toISOString()`.

**Case 5: Interval cleared when session changes to different id**
```tsx
it('clears interval when active session changes to a different id', () => {
  vi.useFakeTimers();
  const now = new Date('2024-01-15T10:00:00.000Z').getTime();
  vi.setSystemTime(now);
  
  const sessionA = makeActiveSession({ id: 'a', startedAt: new Date(now - 10000).toISOString() });
  const sessionB = makeActiveSession({ id: 'b', startedAt: new Date(now - 20000).toISOString() });
  
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionA }));
  const { rerender } = render(<ActiveSessionBar />);
  
  expect(vi.getTimerCount()).toBe(1);
  
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionB }));
  rerender(<ActiveSessionBar />);
  
  expect(vi.getTimerCount()).toBe(1); // not 2
  
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  
  // Should reflect session B's start (20s + 1s = 21s)
  expect(screen.getByTestId('active-session-elapsed').textContent).toBe('21s');
});
```

Wait, but `rerender` with the same component... does that re-run the effect? The effect depends on `[active?.id, active?.startedAt]`. When I change the mock return value and call `rerender`, the component re-renders with new props (well, new hook return value). The effect should re-run because the dependency changed.

Actually, `rerender` from RTL just re-renders the same element. Since the component's hooks will return different values (because the mock changed), the effect's dependencies will have changed, so it should clean up the old interval and start a new one.

**Case 6: Interval cleared when active transitions to null**
```tsx
it('clears interval when active transitions to null', () => {
  vi.useFakeTimers();
  const now = new Date('2024-01-15T10:00:00.000Z').getTime();
  vi.setSystemTime(now);
  
  const session = makeActiveSession({ startedAt: new Date(now - 5000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  const { rerender } = render(<ActiveSessionBar />);
  
  expect(vi.getTimerCount()).toBe(1);
  
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
  rerender(<ActiveSessionBar />);
  
  expect(vi.getTimerCount()).toBe(0);
  expect(screen.queryByTestId('active-session-bar')).toBeNull();
});
```

**Case 7: Resume button navigates to /sessions/<active.id>**
```tsx
it('navigates to /sessions/<active.id> on Resume click', () => {
  const session = makeActiveSession({ id: 'sess-42' });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  render(<ActiveSessionBar />);
  
  screen.getByText('Resume').click();
  
  expect(mockUseNavigate).toHaveBeenCalledWith('/sessions/sess-42');
});
```

**Case 8: Resume does nothing when active is null**
```tsx
it('does not navigate on Resume click when active is null', () => {
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
  const { container } = render(<ActiveSessionBar />);
  
  // Component renders nothing, so there's no Resume button to click.
  // But the test case says "defensive guard" - let me re-read...
  // "Resume does nothing (no navigation) when active is null — defensive guard; 
  // if the handler called navigate('/sessions/undefined') this fails."
  
  // Since the component returns null when active is null, there's no button to click.
  // But the test is about the handler itself being safe. Since the component doesn't render,
  // we can verify that no navigation happened.
  expect(mockUseNavigate).not.toHaveBeenCalled();
});
```

Hmm, but if the component returns null, there's no button. The test is really just verifying that when active is null, navigation doesn't happen (which is trivially true since the component doesn't render). Let me keep it simple.

Actually wait - looking at the component code more carefully:

```tsx
const handleResume = useCallback((): void => {
  if (active) navigate(`/sessions/${active.id}`);
}, [active, navigate]);
```

The guard is inside the handler. But since the component returns `null` when `active` is null, the handler can never be called. The test case is really just a defensive check that confirms no navigation occurs. I'll write it as: render with null, assert no navigate call.

**Case 9: Close session calls closeActive only when confirm returns true**
```tsx
it('calls closeActive when window.confirm returns true', () => {
  const session = makeActiveSession();
  const closeActive = vi.fn().mockResolvedValue(undefined);
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));
  
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ActiveSessionBar />);
  
  screen.getByText('Close session').click();
  
  expect(confirmSpy).toHaveBeenCalledWith('Close this session?');
  expect(closeActive).toHaveBeenCalled();
});
```

**Case 10: Close session does not call closeActive when confirm returns false**
```tsx
it('does not call closeActive when window.confirm returns false', () => {
  const session = makeActiveSession();
  const closeActive = vi.fn().mockResolvedValue(undefined);
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));
  
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ActiveSessionBar />);
  
  screen.getByText('Close session').click();
  
  expect(closeActive).not.toHaveBeenCalled();
});
```

**Case 11: Both buttons disabled while isMutating is true**
```tsx
it('disables both buttons while isMutating is true', () => {
  const session = makeActiveSession();
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, isMutating: true }));
  render(<ActiveSessionBar />);
  
  expect(screen.getByText('Resume')).toBeDisabled();
  expect(screen.getByText('Close session')).toBeDisabled();
});
```

**Case 12: Re-rendering with same session does not create a second interval**
```tsx
it('does not create a second interval on re-mount with same session', () => {
  vi.useFakeTimers();
  const now = new Date('2024-01-15T10:00:00.000Z').getTime();
  vi.setSystemTime(now);
  
  const session = makeActiveSession({ startedAt: new Date(now - 5000).toISOString() });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  
  const { unmount } = render(<ActiveSessionBar />);
  expect(vi.getTimerCount()).toBe(1);
  
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  
  render(<ActiveSessionBar />);
  expect(vi.getTimerCount()).toBe(1); // not 2
});
```

**Case 13: Does not crash when startedAt is invalid ISO string**
```tsx
it('does not crash or display NaN when startedAt is an invalid ISO string', () => {
  const session = makeActiveSession({ startedAt: 'not-a-date' });
  mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
  
  render(<ActiveSessionBar />);
  
  const elapsed = screen.getByTestId('active-session-elapsed').textContent;
  expect(elapsed).not.toContain('NaN');
});
```

Now, let me think about potential issues:

1. The `formatElapsed` function in the component:
```tsx
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

When `ms` is `NaN`:
- `totalSeconds = Math.floor(NaN / 1000) = NaN`
- `h = Math.floor(NaN / 3600) = NaN`
- `m = Math.floor((NaN % 3600) / 60) = NaN`
- `s = NaN % 60 = NaN`
- `h > 0` → `NaN > 0` → `false`
- `m > 0` → `NaN > 0` → `false`
- Returns `` `${NaN}s` `` → `"NaNs"`

So the component WILL display "NaNs" when `startedAt` is invalid. The test case says:
"Component does not crash when `active.startedAt` is an invalid ISO string — `new Date(invalid)` yields `NaN`; `formatElapsed(NaN)` should not produce `"NaNs"` in the DOM (or the component guards); if there is no guard and the test asserts absence of `"NaN"`, this fails."

So the test asserts that "NaN" is NOT in the DOM. But looking at the component code, there's no guard! The component will produce "NaNs".

Wait, let me re-read the test case: "if there is no guard and the test asserts absence of `"NaN"`, this fails."

This means: if the component doesn't have a guard, and the test asserts that "NaN" is absent, then the test will fail. So the test is designed to catch this bug.

But wait - the task says "Write every one of them" from the cases file. The cases file lists what tests to write, not necessarily that they all pass. The test is meant to verify the behavior - if the component has a bug, the test should fail.

So I should write the test that asserts "NaN" is NOT in the DOM. If the component doesn't guard against it, the test will fail, which is the correct behavior for a test.

Actually, re-reading more carefully: "Component does not crash when `active.startedAt` is an invalid ISO string — `new Date(invalid)` yields `NaN`; `formatElapsed(NaN)` should not produce `"NaNs"` in the DOM (or the component guards); if there is no guard and the test asserts absence of `"NaN"`, this fails."

The parenthetical "(or the component guards)" suggests the test is checking that either:
1. The component guards against invalid dates, OR
2. If it doesn't guard, the test would fail

So I should write the test asserting absence of "NaN". This is a valid test that documents the expected behavior.

Now, let me also think about whether `render` might throw. Looking at the component:
```tsx
useEffect(() => {
  if (!active) return;
  const update = (): void => {
    setElapsed(Date.now() - new Date(active.startedAt).getTime());
  };
  update();
  ...
}, [active?.id, active?.startedAt]);
```

`new Date('not-a-date').getTime()` returns `NaN`. Then `Date.now() - NaN` = `NaN`. `setElapsed(NaN)` is fine (it's a number state). Then `formatElapsed(NaN)` returns `"NaNs"`. The component doesn't crash, it just displays "NaNs".

So the test should assert that the text does NOT contain "NaN". This will fail with the current implementation, which is correct - it's a test that identifies a bug.

Now let me also think about the `act` wrapping. When using fake timers with RTL, I need to wrap timer advancement in `act`:

```tsx
act(() => {
  vi.advanceTimersByTime(2000);
});
```

Let me also think about cleanup. RTL's `render` should auto-cleanup after each test (with `@testing-library/react` and Vitest globals). But to be safe, I should make sure to unmount in `afterEach` or rely on RTL's auto-cleanup.

Actually, with Vitest and `@testing-library/react`, if I set up the environment properly, auto-cleanup happens. But since I don't know the exact setup, let me add explicit cleanup in `afterEach`.

Wait, actually the standard pattern is that `@testing-library/react` auto-cleans up if `afterEach` is available globally (which it is with Vitest). So I don't need to worry about it.

But for fake timers, I do need `afterEach(() => vi.useRealTimers())`.

Let me also think about the `window.confirm` spy. I need to clean it up too. I'll use `vi.restoreAllMocks()` in `afterEach`.

Actually, let me be more careful. I'll use:
- `afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); })`

But wait, `vi.restoreAllMocks()` would also restore my spies on `setInterval` etc. That's fine since I set up new mocks in each test.

Hmm, but `mockUseActiveSession` and `mockUseNavigate` are set up via `vi.hoisted` and `vi.mock`. They won't be affected by `restoreAllMocks`. I should use `mockReset()` or `mockClear()` on them.

Actually, let me just use `beforeEach` to set up fresh mock return values for each test. The `vi.mock` factory creates the mock functions once, but I can set their return values in each test.

Let me finalize my approach:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ActiveSession, UseActiveSessionResult } from '../src/features/sessions/use-active-session';

const { mockUseActiveSession, mockUseNavigate } = vi.hoisted(() => ({
  mockUseActiveSession: vi.fn(),
  mockUseNavigate: vi.fn(),
}));

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: mockUseActiveSession,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: mockUseNavigate,
}));

import { ActiveSessionBar } from '../src/features/sessions/active-session-bar';
```

Wait, there's a problem. The `ActiveSession` and `UseActiveSessionResult` types are exported from the mocked module. Can I import types from a mocked module? Yes! Type imports are erased at compile time, so `import type` will work fine even if the module is mocked.

Actually, I realize I should double-check: does `vi.mock` affect type imports? No, `import type` is purely compile-time and is erased. The mock only affects runtime imports.

Let me also think about whether I need `React` in scope. With the new JSX transform (React 17+), I don't need to import React. But for the JSX in tests, I just use it directly.

Now, one more consideration: the `useActiveSession` mock. The component calls `useActiveSession()` which returns an object. I need to make sure my mock returns a stable reference for the `closeActive` and `setActive` functions within a single test, but I can change them between tests.

Let me write the final version:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ActiveSession, UseActiveSessionResult } from '../src/features/sessions/use-active-session';

const { mockUseActiveSession, mockUseNavigate } = vi.hoisted(() => ({
  mockUseActiveSession: vi.fn(),
  mockUseNavigate: vi.fn(),
}));

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: mockUseActiveSession,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: mockUseNavigate,
}));

import { ActiveSessionBar } from '../src/features/sessions/active-session-bar';

function makeActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'sess-1',
    name: 'Test Session',
    status: 'open',
    startedAt: new Date('2024-01-15T10:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function makeHookResult(overrides: Partial<UseActiveSessionResult> = {}): UseActiveSessionResult {
  return {
    active: null,
    isFetching: false,
    setActive: vi.fn().mockResolvedValue(undefined),
    closeActive: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    ...overrides,
  };
}

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    mockUseNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ... tests
});
```

Wait, I have a concern about `vi.restoreAllMocks()`. This will restore `window.confirm` if I spied on it, which is good. But it might also affect other things. Let me be more targeted and just restore the confirm spy.

Actually, `vi.restoreAllMocks()` is fine here. It restores all spies created with `vi.spyOn`. My mock functions from `vi.hoisted` are not affected.

But wait - if I use `vi.useFakeTimers()` in some tests, and then `vi.restoreAllMocks()`, does that interfere? No, `restoreAllMocks` only affects spies, not the timer system.

Let me also think: do I need `vi.useFakeTimers()` in ALL tests or just the timer-related ones? Only the timer-related ones (cases 3, 4, 5, 6, 12). For the others, real timers are fine.

But there's a subtlety: even in non-timer tests, the component sets up a `setInterval` in its effect. With real timers, this interval will fire and cause a state update, which might trigger React warnings about updates not wrapped in `act`. To avoid this, I should either:
1. Use fake timers in all tests, OR
2. Unmount the component before the interval fires (1 second)

Since RTL's auto-cleanup happens after each test (in `afterEach`), and the interval is 1 second, if the test completes in less than 1 second (which it will for synchronous assertions), the interval won't fire. But to be safe, I'll use fake timers in all tests.

Actually, let me just use fake timers globally in `beforeEach`:

```tsx
beforeEach(() => {
  vi.useFakeTimers();
  mockUseNavigate.mockReset();
});
```

This is cleaner and avoids any timing issues.

Now, one more thing: when I use `vi.useFakeTimers()`, `Date.now()` is mocked. By default, it returns the current time when fake timers were installed. I can use `vi.setSystemTime()` to set it explicitly.

For tests where I need specific elapsed times, I'll set the system time explicitly. For others, the default is fine.

Let me now write the complete file:

Actually, wait. Let me reconsider the structure of case 4. The test case says:
"Elapsed display formats hours, minutes, and seconds correctly at each threshold — sessions started 59 s, 61 s, and 3601 s ago must produce `"59s"`, `"1m 1s"`, and `"1h 0m 1s"` respectively"

I can do this in a single test with three render/unmount cycles, or I can use `it.each`. Let me use a single test with three sub-assertions for clarity.

Actually, I realize there might be an issue with `rerender` and the mock. When I call `mockUseActiveSession.mockReturnValue(newResult)` and then `rerender(<ActiveSessionBar />)`, the component will call `useActiveSession()` again and get the new value. This should work.

But for case 4, I'm doing unmount + render (not rerender) for each sub-case. That's cleaner.

Let me also think about whether I need to wrap the initial render in `act()`. With RTL, `render` already wraps in `act()`. And with fake timers, the effect runs synchronously during `render`, so the initial `setElapsed` call happens within `act`. Good.

One more edge case: in case 3, after advancing timers by 2000ms, the interval fires twice. Each time it calls `setElapsed`. The first fire updates to 7s (5+2), the second... wait, no. The interval fires every 1000ms. So after 2000ms, it fires twice: at 1000ms (elapsed = 6s) and at 2000ms (elapsed = 7s). The displayed value should be 7s.

Actually wait: `startedAt` is 5000ms ago. At render time, `Date.now() - startedAt = 5000ms` → displays "5s". After 1000ms: `6000ms` → "6s". After another 1000ms: `7000ms` → "7s". So after advancing 2000ms, it should show "7s", which is different from "5s". Good.

Let me finalize the test file now. I'll be careful about:
1. Using `vi.hoisted` for mock factories
2. Setting up fake timers in all tests
3. Properly cleaning up spies
4. Using `act()` for timer advancement
5. Importing types with `import type`

Here's my final version:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ActiveSession, UseActiveSessionResult } from '../src/features/sessions/use-active-session';

const { mockUseActiveSession, mockUseNavigate } = vi.hoisted(() => ({
  mockUseActiveSession: vi.fn(),
  mockUseNavigate: vi.fn(),
}));

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: mockUseActiveSession,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: mockUseNavigate,
}));

import { ActiveSessionBar } from '../src/features/sessions/active-session-bar';

function makeActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'sess-1',
    name: 'Test Session',
    status: 'open',
    startedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeHookResult(overrides: Partial<UseActiveSessionResult> = {}): UseActiveSessionResult {
  return {
    active: null,
    isFetching: false,
    setActive: vi.fn().mockResolvedValue(undefined),
    closeActive: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    ...overrides,
  };
}

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when no active session', () => {
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    const { container } = render(<ActiveSessionBar />);
    expect(container.innerHTML).toBe('');
  });

  it('renders session name, status badge, and a non-zero elapsed string when an active session exists', () => {
    vi.setSystemTime(new Date('2024-01-15T10:00:05.000Z').getTime());
    const session = makeActiveSession({ startedAt: '2024-01-15T10:00:00.000Z' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);

    expect(screen.getByTestId('active-session-name').textContent).toBe('Test Session');
    expect(screen.getByTestId('active-session-status').textContent).toBe('open');
    const elapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(elapsed).not.toBe('0s');
  });

  it('elapsed time ticks forward after two intervals', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime + 5000); // system clock is 5s after session start
    const session = makeActiveSession({ startedAt: '2024-01-15T10:00:00.000Z' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);
    const initialElapsed = screen.getByTestId('active-session-elapsed').textContent;

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const laterElapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(laterElapsed).not.toBe(initialElapsed);
  });

  it('formats elapsed correctly at second, minute, and hour thresholds', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    // 59 seconds → "59s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 59000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('59s');
      unmount();
    }

    // 61 seconds → "1m 1s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 61000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1m 1s');
      unmount();
    }

    // 3601 seconds → "1h 0m 1s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 3601000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1h 0m 1s');
      unmount();
    }
  });

  it('clears interval when active session changes to a different id', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const sessionA = makeActiveSession({ id: 'a', startedAt: new Date(baseTime - 10000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionA }));
    const { rerender } = render(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    const sessionB = makeActiveSession({ id: 'b', startedAt: new Date(baseTime - 20000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionB }));
    rerender(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Session B started 20s ago, +1s from timer = 21s
    expect(screen.getByTestId('active-session-elapsed').textContent).toBe('21s');
  });

  it('clears interval when active transitions to null', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const session = makeActiveSession({ startedAt: new Date(baseTime - 5000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
    const { rerender } = render(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    rerender(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByTestId('active-session-bar')).toBeNull();
  });

  it('navigates to /sessions/<active.id> on Resume click', () => {
    const session = makeActiveSession({ id: 'sess-42' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
    render(<ActiveSessionBar />);

    screen.getByText('Resume').click();

    expect(mockUseNavigate).toHaveBeenCalledWith('/sessions/sess-42');
  });

  it('does not navigate on Resume click when active is null', () => {
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    render(<ActiveSessionBar />);

    expect(mockUseNavigate).not.toHaveBeenCalled();
  });

  it('calls closeActive when window.confirm returns true', () => {
    const session = makeActiveSession();
    const closeActive = vi.fn().mockResolvedValue(undefined);
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ActiveSessionBar />);

    screen.getByText('Close session').click();

    expect(confirmSpy).toHaveBeenCalledWith('Close this session?');
    expect(closeActive).toHaveBeenCalledTimes(1);
  });

  it('does not call closeActive when window.confirm returns false', () => {
    const session = makeActiveSession();
    const closeActive = vi.fn().mockResolvedValue(undefined);
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ActiveSessionBar />);

    screen.getByText('Close session').click();

    expect(closeActive).not.toHaveBeenCalled();
  });

  it('disables both buttons while isMutating is true', () => {
    const session = makeActiveSession();
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, isMutating: true }));
    render(<ActiveSessionBar />);

    expect(screen.getByText('Resume')).toBeDisabled();
    expect(screen.getByText('Close session')).toBeDisabled();
  });

  it('does not create a second interval on re-mount with the same session', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const session = makeActiveSession({ startedAt: new Date(baseTime - 5000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    const { unmount } = render(<ActiveSessionBar />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    render(<ActiveSessionBar />);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not crash or display NaN when startedAt is an invalid ISO string', () => {
    const session = makeActiveSession({ startedAt: 'not-a-valid-date' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);

    const elapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(elapsed).not.toContain('NaN');
  });
});
```

Wait, I need to double-check something. In the "renders nothing when no active session" test, I'm checking `container.innerHTML`. But RTL's `render` renders into a div that's appended to the document. If the component returns `null`, the container div will be empty. Let me verify this is correct.

When React renders a component that returns `null`, it renders nothing into the DOM. So the container div (created by RTL) will have no children, and `innerHTML` will be `''`. This should work.

Alternatively, I could use `expect(screen.queryByTestId('active-session-bar')).toBeNull()`. Both approaches work. Let me use the testid approach for consistency with other tests.

Actually, let me reconsider. The test case says "Renders nothing when no active session — the hook returns `active: null`; if the component rendered a skeleton, an empty div, or crashed on `.name`, this fails."

So the key assertions are:
1. No skeleton rendered
2. No empty div rendered (i.e., truly nothing)
3. No crash

Using `container.innerHTML` being `''` covers all three (if it crashed, the test would throw; if there's a skeleton or empty div, innerHTML wouldn't be '').

But actually, if the component renders an empty `<div></div>`, `innerHTML` would be `'<div></div>'` which is not `''`. And if it renders a skeleton, it would have content. So checking `innerHTML === ''` is the strictest check.

Let me keep `expect(container.innerHTML).toBe('')`.

Hmm, but there's a subtlety. React might add comment nodes or other artifacts. Let me use a slightly less strict check: `expect(screen.queryByTestId('active-session-bar')).toBeNull()` to verify no bar is rendered, and also check that the container has no meaningful content.

Actually, for a component that returns `null`, React truly renders nothing. The container will be empty. I'll stick with `container.innerHTML` being `''`.

Wait, one more thought: in some React versions or test setups, there might be a leading/trailing space or comment. To be safe, I could use `expect(container.firstChild).toBeNull()`. But that might be too strict. Let me just use the testid approach:

```tsx
expect(screen.queryByTestId('active-session-bar')).toBeNull();
```

This is clear and unambiguous. If the component rendered anything with that testid, it would fail. And if it crashed, the test would throw.

Actually, I'll use both for maximum clarity:
```tsx
expect(container.innerHTML).toBe('');
```

This is the most direct check. Let me go with it.

Now let me also reconsider: do I need `import React from 'react'`? With the new JSX transform (which is standard in modern React projects), I don't. The test file uses JSX (`<ActiveSessionBar />`), which the compiler will transform. No explicit React import needed.

Let me also make sure I'm not importing anything unused. I import:
- `describe, it, expect, vi, beforeEach, afterEach` from vitest ✓
- `render, screen, act` from @testing-library/react ✓
- `ActiveSession, UseActiveSessionResult` (types only) from use-active-session ✓
- `ActiveSessionBar` from active-session-bar ✓

All used. Good.

One final thought: the `makeHookResult` function creates new `vi.fn()` instances for `setActive` and `closeActive` each time it's called. This is fine for most tests. For the close session tests, I pass a specific `closeActive` in the overrides, so the one created by `makeHookResult` is overridden. Good.

I think the test file is complete. Let me write it out one final time cleanly.
```

## reply

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ActiveSession, UseActiveSessionResult } from '../src/features/sessions/use-active-session';

const { mockUseActiveSession, mockUseNavigate } = vi.hoisted(() => ({
  mockUseActiveSession: vi.fn(),
  mockUseNavigate: vi.fn(),
}));

vi.mock('../src/features/sessions/use-active-session', () => ({
  useActiveSession: mockUseActiveSession,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: mockUseNavigate,
}));

import { ActiveSessionBar } from '../src/features/sessions/active-session-bar';

function makeActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'sess-1',
    name: 'Test Session',
    status: 'open',
    startedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeHookResult(overrides: Partial<UseActiveSessionResult> = {}): UseActiveSessionResult {
  return {
    active: null,
    isFetching: false,
    setActive: vi.fn().mockResolvedValue(undefined),
    closeActive: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    ...overrides,
  };
}

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when no active session', () => {
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    const { container } = render(<ActiveSessionBar />);

    expect(container.innerHTML).toBe('');
  });

  it('renders session name, status badge, and a non-zero elapsed string when an active session exists', () => {
    vi.setSystemTime(new Date('2024-01-15T10:00:05.000Z').getTime());
    const session = makeActiveSession({ startedAt: '2024-01-15T10:00:00.000Z' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);

    expect(screen.getByTestId('active-session-name').textContent).toBe('Test Session');
    expect(screen.getByTestId('active-session-status').textContent).toBe('open');
    const elapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(elapsed).not.toBe('0s');
  });

  it('elapsed time ticks forward after two intervals', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime + 5000);
    const session = makeActiveSession({ startedAt: '2024-01-15T10:00:00.000Z' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);
    const initialElapsed = screen.getByTestId('active-session-elapsed').textContent;

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const laterElapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(laterElapsed).not.toBe(initialElapsed);
  });

  it('formats elapsed correctly at second, minute, and hour thresholds', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    // 59 seconds → "59s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 59_000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('59s');
      unmount();
    }

    // 61 seconds → "1m 1s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 61_000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1m 1s');
      unmount();
    }

    // 3601 seconds → "1h 0m 1s"
    {
      const session = makeActiveSession({ startedAt: new Date(baseTime - 3_601_000).toISOString() });
      mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
      const { unmount } = render(<ActiveSessionBar />);
      expect(screen.getByTestId('active-session-elapsed').textContent).toBe('1h 0m 1s');
      unmount();
    }
  });

  it('clears interval when active session changes to a different id', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const sessionA = makeActiveSession({ id: 'a', startedAt: new Date(baseTime - 10_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionA }));
    const { rerender } = render(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    const sessionB = makeActiveSession({ id: 'b', startedAt: new Date(baseTime - 20_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: sessionB }));
    rerender(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Session B started 20 s ago; after one more tick the elapsed is 21 s.
    expect(screen.getByTestId('active-session-elapsed').textContent).toBe('21s');
  });

  it('clears interval when active transitions to null', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const session = makeActiveSession({ startedAt: new Date(baseTime - 5_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
    const { rerender } = render(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(1);

    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    rerender(<ActiveSessionBar />);

    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByTestId('active-session-bar')).toBeNull();
  });

  it('navigates to /sessions/<active.id> on Resume click', () => {
    const session = makeActiveSession({ id: 'sess-42' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));
    render(<ActiveSessionBar />);

    screen.getByText('Resume').click();

    expect(mockUseNavigate).toHaveBeenCalledWith('/sessions/sess-42');
  });

  it('does not navigate on Resume click when active is null', () => {
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: null }));
    render(<ActiveSessionBar />);

    expect(mockUseNavigate).not.toHaveBeenCalled();
  });

  it('calls closeActive when window.confirm returns true', () => {
    const session = makeActiveSession();
    const closeActive = vi.fn().mockResolvedValue(undefined);
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ActiveSessionBar />);

    screen.getByText('Close session').click();

    expect(confirmSpy).toHaveBeenCalledWith('Close this session?');
    expect(closeActive).toHaveBeenCalledTimes(1);
  });

  it('does not call closeActive when window.confirm returns false', () => {
    const session = makeActiveSession();
    const closeActive = vi.fn().mockResolvedValue(undefined);
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, closeActive }));

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ActiveSessionBar />);

    screen.getByText('Close session').click();

    expect(closeActive).not.toHaveBeenCalled();
  });

  it('disables both buttons while isMutating is true', () => {
    const session = makeActiveSession();
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session, isMutating: true }));
    render(<ActiveSessionBar />);

    expect(screen.getByText('Resume')).toBeDisabled();
    expect(screen.getByText('Close session')).toBeDisabled();
  });

  it('does not create a second interval on re-mount with the same session', () => {
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const session = makeActiveSession({ startedAt: new Date(baseTime - 5_000).toISOString() });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    const { unmount } = render(<ActiveSessionBar />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    render(<ActiveSessionBar />);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not crash or display NaN when startedAt is an invalid ISO string', () => {
    const session = makeActiveSession({ startedAt: 'not-a-valid-date' });
    mockUseActiveSession.mockReturnValue(makeHookResult({ active: session }));

    render(<ActiveSessionBar />);

    const elapsed = screen.getByTestId('active-session-elapsed').textContent;
    expect(elapsed).not.toContain('NaN');
  });
});
```
