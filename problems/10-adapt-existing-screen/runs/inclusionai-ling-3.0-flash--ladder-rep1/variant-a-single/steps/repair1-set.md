# repair1-set

## reasoning

```
Let me analyze all the errors:

1. `ActiveSessionBar.test.tsx(6,1)`: 'ActiveSessionBar' is declared but never read — remove the import.

2. `ActiveSessionBar.tsx(6,10)`: 'getActiveSessionDirty' is declared but never read — remove the import.

3. `queries.ts(22,5)`: `onSuccess` doesn't exist on `useQuery` options — this is the second `useSession` hook. In newer react-query, `onSuccess` is a callback on `useQuery`, but the type signature doesn't match. Wait, actually `onSuccess` IS a valid option in `useQuery`. Let me re-read... The error says "onSuccess does not exist in type". This is strange. Looking at the query options — maybe the issue is that `useQuery` in this version expects `onSuccess` as a separate property but the generic types don't match. Actually, looking more carefully, `onSuccess` is a valid option in `@tanstack/react-query` v4/v5. But the error says it doesn't exist. This might be a version issue. Let me look at the actual code:

```ts
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}
```

The error is about `onSuccess` not being a known property. This might be a version of react-query where `onSuccess` was removed or changed. In react-query v5, `onSuccess` is still a valid option. But the error message suggests the type system doesn't recognize it. 

Wait — maybe it's a react-query version where `onSuccess` is not available as an inline option but only as a separate callback? Actually in some versions, `onSuccess` was deprecated. Let me think about this differently.

The task says "Fix all of them" and "Change exactly what the compiler requires." The simplest fix that removes the error without changing behavior would be to use `useEffect` instead of `onSuccess`, or to use the callback form. But the instructions say "Do not add features, do not rename anything the errors do not mention."

Actually, the simplest fix: replace `onSuccess` with a `useEffect` that watches the data, or use the `queryClient` approach. But let me think about what the compiler is telling me — it says `onSuccess` doesn't exist. So I need to remove it and find an alternative way to do the same thing (invalidate active session query when viewing a session).

I'll use `useEffect` with the data:

```ts
export function useSession(id: string) {
  const qc = useQueryClient();
  const result = useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });
  
  useEffect(() => {
    if (result.data) {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    }
  }, [result.data, qc]);
  
  return result;
}
```

Wait, but the error says the issue is specifically with the type. Maybe I should check if it's a react-query v5 thing. In v5, `onSuccess` is still valid. Hmm.

Actually, let me reconsider. The error is at line 22, which is in the `useSession` function. The error says `onSuccess` doesn't exist. Maybe the installed version of @tanstack/react-query doesn't have `onSuccess` in its types. This could be a v5 beta or something. Regardless, I need to fix it.

The cleanest approach: use `useEffect` to do the invalidation after data loads.

4. `SessionDetailScreen.tsx` errors about `notes`, `name`, `status`, `id`, `session` being possibly null — these are all TypeScript type issues. The `session` data from the query is typed as `{}` (empty object) instead of `Session`. Looking at the import: `useSession` returns `useQuery` result, and the query returns `Session` type. But the types are not propagating correctly.

Wait, let me look at the errors more carefully:
- Line 19: `session.notes` — property 'notes' does not exist on type '{}'
- Line 24: `session` is possibly 'null', and `session.notes` doesn't exist
- Line 37: `session.name` doesn't exist on '{}'
- etc.

The issue is that `session` from `useSession` is typed as `{} | null` or similar. This is a type inference issue. The API client probably returns something typed loosely.

Looking at the import: `import type { Page, Session } from '../../api/types';` — so `Session` type exists. But `useSession` might not be returning the right type. Let me check — in `queries.ts`, `useSession` returns `useQuery({...})` without explicit typing, so TypeScript infers from `api.getSession(id)` return type. If `api.getSession` returns `Promise<{}>` or `Promise<unknown>`, that would cause this.

But wait — the errors say "Property 'notes' does not exist on type '{}'". So the inferred type is `{}`. This might be because the API client function returns a generic/loose type.

How to fix? I could cast or explicitly type the query. But the instructions say to fix what the compiler requires, not to add features. The simplest fix: add explicit typing to `useSession` to return `Session`:

```ts
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery<Session>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });
}
```

Wait, but the error also mentions that `onSuccess` doesn't exist. If I'm already planning to change that function, I can combine fixes.

But actually, let me reconsider. The errors in SessionDetailScreen are about the type of `session` being `{}`. If `useSession` is typed correctly, those errors go away. So maybe I should fix `useSession` typing in queries.ts, and that cascades to fix SessionDetailScreen.

But the `useSession` function has the `onSuccess` error too. So I need to:
1. Fix the `onSuccess` issue (remove it, use useEffect)
2. Make sure the return type is `Session`

Let me add explicit generics:

```ts
export function useSession(id: string) {
  const qc = useQueryClient();
  const query = useQuery<Session, Error, Session>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });
  
  useEffect(() => {
    if (query.data) {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    }
  }, [query.data, qc]);
  
  return query;
}
```

Hmm, but I need to import `useEffect` and `Session` in queries.ts. Let me check what's already imported.

queries.ts imports: `useMutation, useQuery, useQueryClient` from '@tanstack/react-query'; `api, type SessionQuery` from '../../api/client'; `type Page, Session` from '../../api/types'.

So `Session` is already imported. I just need to add `useEffect` import.

Wait, actually — the issue might be simpler. Let me check if `useQuery` needs explicit generics. The `api.getSession(id)` might return `Promise<Session>`, but if TypeScript can't infer it, it falls back to `{}`. Let me just add the generic.

Actually, let me reconsider the whole approach. The errors in SessionDetailScreen about types might be fixed by properly typing `useSession`. But there's also the `session` possibly being null issue at line 24. Let me look at the code:

```ts
const { data: session, isLoading } = useSession(id);
// ...
useEffect(() => {
  if (session) setNotes(session.notes);
}, [session]);
```

After fixing the type, `session` would be `Session | undefined`, so `session.notes` in the useEffect would still complain unless we check for null/undefined. But the code already has `if (session)` — that should narrow it. Unless the type is `Session | null`. Let me check: `useQuery` returns `data` as `T | undefined` by default. So `session` would be `Session | undefined`. The `if (session)` check should narrow it.

But error 5 says `session` is possibly 'null'. So maybe the type is `Session | null`. That's unusual for react-query. Maybe `api.getSession` returns `Promise<Session | null>`?

Hmm, let me just fix the type issues. If I type `useSession` properly with `<Session>`, the data should be `Session | undefined`, and the null check should work.

Let me now go through each error systematically:

**Error 1**: `ActiveSessionBar.test.tsx(6,1)`: Remove unused `ActiveSessionBar` import.

**Error 2**: `ActiveSessionBar.tsx(6,10)`: Remove unused `getActiveSessionDirty` import.

**Error 3**: `queries.ts(22,5)`: `onSuccess` doesn't exist on useQuery options. Fix by using `useEffect`. Also need to add explicit type generics for `Session` to fix downstream type issues.

**Error 4-11**: `SessionDetailScreen.tsx` — all type-related. Fix by properly typing `useSession` return.

**Error 12**: `SessionsListScreen.tsx(2,10)`: Remove unused `Link` import.

**Error 13**: `SessionsListScreen.tsx(112,11)`: `setActiveSessionDirty` not found — add import.

Wait, let me check line 112 in SessionsListScreen.tsx. Looking at the ConfirmDialog onConfirm:

```tsx
onConfirm={() => {
  setConfirmOpen(false);
  setActiveSessionDirty(false);
  if (pendingSessionId) {
    navigate(`/sessions/${pendingSessionId}`);
  }
}}
```

It uses `setActiveSessionDirty` but doesn't import it. The import at the top has `getActiveSessionDirty` but not `setActiveSessionDirty`. So I need to add `setActiveSessionDirty` to the import.

Now let me also check if queries.ts needs `useEffect`. Let me write out the complete fixes.

Actually, wait. Let me reconsider the `useSession` fix. The error is specifically about `onSuccess` not existing. Let me look at what react-query version would not have `onSuccess`. In react-query v4, `onSuccess` IS a valid option. In v5, it's also valid. So this might be a very specific version or a custom setup.

The safest fix that preserves behavior: use `useEffect`:

```ts
import { useEffect } from 'react';

export function useSession(id: string) {
  const qc = useQueryClient();
  const query = useQuery<Session>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });

  useEffect(() => {
    if (query.data) {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    }
  }, [query.data, qc]);

  return query;
}
```

Wait, but `useEffect` with `query.data` and `qc` — `qc` is stable (from `useQueryClient()`), so the dependency array is fine. But I should be careful: `query.data` changes, and we want to invalidate only when it changes from undefined to defined or to a new value. That works.

But actually, there might be a simpler approach: use the `meta` option or the `queryFn` approach. No, let me just use `useEffect`.

Hmm, wait. I realize there's another consideration. The original code uses `onSuccess` which fires only once when data is first loaded. Using `useEffect` with `query.data` would fire whenever `query.data` changes, including on refetches. But that should be fine — invalidating the active query multiple times is idempotent.

Let me now write out all the fixed files:

1. **ActiveSessionBar.test.tsx** — remove `ActiveSessionBar` import
2. **ActiveSessionBar.tsx** — remove `getActiveSessionDirty` import
3. **queries.ts** — fix `useSession` (remove onSuccess, add useEffect, add generic type)
4. **SessionDetailScreen.tsx** — these errors should be fixed by typing useSession correctly, but let me check if there are remaining issues.

Actually, let me trace through SessionDetailScreen errors carefully with the type fix:

After fixing `useSession` to return `UseQueryResult<Session>`, `data: session` would be `Session | undefined`.

- Line 19: `if (session) setNotes(session.notes);` — session is `Session | undefined`, narrowed by `if (session)` → `Session`. So `session.notes` should work. This error goes away.

- Line 24: `if (!session) return <p>Session not found.</p>;` — after this check, session is `Session`. But the error says "session is possibly 'null'" at line 24. Wait, let me check the exact code:

```tsx
const { data: session, isLoading } = useSession(id);
```

If `useSession` returns `data: Session | undefined`, then session is `Session | undefined`, not `Session | null`. The error says "possibly null". This suggests the current inferred type includes `null`. With proper typing, it should be `Session | undefined`.

After adding the `<Session>` generic:
- `data: session` → `Session | undefined`
- After `if (!session)` → `Session` (not null)
- `session.notes` → OK
- `session.name` → OK  
- `session.status` → OK
- `session.id` → OK

So all SessionDetailScreen errors should be fixed by just fixing `useSession` typing. Good.

But wait — the error at line 24 says "session is possibly 'null'". If `api.getSession` returns `Promise<Session | null>`, then even with `<Session>` generic, it might still include null? No, `useQuery<Session>` would type data as `Session | undefined`. The null from the API response would be a runtime concern, not a type concern.

OK, I think fixing `useSession` with proper generics solves the SessionDetailScreen errors. Let me also make sure there are no remaining issues in SessionDetailScreen after the type fix.

Actually, let me be more careful. The `useQuery` generic should be `<Session, Error>`:

```ts
useQuery<Session, Error, Session>({
```

Or just `<Session>`:
```ts
useQuery<Session>({
```

The default error type is `Error`, and default data type would be inferred from queryFn. Let me just use `<Session, Error, Session>` to be explicit, matching the pattern in the error message.

Actually, looking at the error message more carefully:
```
Overload 1 of 3, '(options: DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>...
```

The types are `<unknown, Error, unknown>` — meaning the error is Error (good), but both TData and TQueryData are unknown. So adding `<Session>` should fix it.

Now let me also think about the `useEffect` dependency. In the fixed `useSession`:

```ts
useEffect(() => {
  if (query.data) {
    qc.invalidateQueries({ queryKey: sessionKeys.active() });
  }
}, [query.data, qc]);
```

This looks fine.

Let me also double-check: do I need to import `useEffect` in queries.ts? Yes, I need to add it.

Now let me finalize all changes:

### 1. ActiveSessionBar.test.tsx
Remove `ActiveSessionBar` from import line:
```tsx
import { renderApp } from '../../test/render';
```
Wait, let me check the exact import line:
```tsx
import { renderApp } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';
```

Remove the second line.

### 2. ActiveSessionBar.tsx
Remove `getActiveSessionDirty` from import:
```tsx
import { useActiveSession, useCloseSession } from './queries';
```
Currently:
```tsx
import { getActiveSessionDirty, setActiveSessionDirty } from './activeSession';
```
Wait, this file uses `setActiveSessionDirty`? Let me check... Looking at the code, I see `useEffect` that calls `setActiveSessionDirty(false)`. So I need to keep `setActiveSessionDirty` but remove `getActiveSessionDirty`.

```tsx
import { setActiveSessionDirty } from './activeSession';
```

### 3. queries.ts
Need to:
- Add `useEffect` import from 'react'
- Fix `useSession` to remove `onSuccess` and use `useEffect` instead, with proper typing

Current import: `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';`
Need to add: `import { useEffect } from 'react';`

And fix `useSession`.

### 4. SessionDetailScreen.tsx
Should be fixed by the queries.ts type fix. But let me double check — the errors are all about `session` being typed as `{}`. If `useSession` now returns proper `Session` type, all these go away. No changes needed to this file.

Wait, actually — should I verify? The error is specifically about `useSession`'s data type. If I fix `useSession` typing, then `const { data: session } = useSession(id)` gets `session: Session | undefined`, and all property accesses work. Yes, no changes needed.

### 5. SessionsListScreen.tsx
- Remove unused `Link` import
- Add `setActiveSessionDirty` to import from `./activeSession`

Current: `import { getActiveSessionDirty } from './activeSession';`
Change to: `import { getActiveSessionDirty, setActiveSessionDirty } from './activeSession';`

And remove `Link` from the react-router-dom import.

Let me now write out the complete files. But I should only output files I changed. Let me determine which files need changes:

1. `src/features/sessions/ActiveSessionBar.test.tsx` — remove unused import
2. `src/features/sessions/ActiveSessionBar.tsx` — remove unused import
3. `src/features/sessions/queries.ts` — fix useSession, add useEffect import
4. `src/features/sessions/SessionsListScreen.tsx` — remove unused import, add missing import

SessionDetailScreen.tsx doesn't need changes — its errors are caused by queries.ts typing issue.

Wait, let me reconsider. The task says "Fix all of them." But SessionDetailScreen.tsx errors are all downstream of the type issue in queries.ts. Fixing queries.ts should cascade and fix them. The instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise." So I should only fix what's needed.

Actually, let me reconsider more carefully. Could the type issue in SessionDetailScreen be an independent issue? Let me look: the `useSession` hook in queries.ts has `onSuccess` error. The `data` from useQuery is inferred from `api.getSession(id)` which returns... let me check the import. `api` comes from `'../../api/client'`. I don't have access to that file, but based on the error types (`{}`), it seems like the return type is inferred as `{}`.

If I fix `useSession` with explicit `<Session>` generic, the data type becomes `Session | undefined`, and SessionDetailScreen errors go away. So no need to change SessionDetailScreen.

Let me verify by going through each SessionDetailScreen error:
- Line 19: `session.notes` → with `Session` type, `notes` exists ✓
- Line 24: `session` possibly null → with `Session | undefined`, `if (session)` narrows to `Session` ✓. But error says "null" not "undefined"... hmm. Actually `session` from `useQuery` is `TData | undefined` by default. If `TData` is `Session`, then it's `Session | undefined`. The `if (session)` check narrows correctly. But what about `if (!session)` — after that, `session` should be `Session`. The error says "possibly null" at line 24 column 52. Let me check the exact line.

Line 24 in SessionDetailScreen: `if (!session) return <p>Session not found.</p>;` — and then later code uses `session`. After this check, TypeScript narrows `session` to `Session`. So `session.name` at line 37 should be fine, `session.status` at line 38 fine, etc.

But the error at line 24:52 says "session is possibly 'null'" and at 24:60 says "Property 'notes' does not exist on type '{}'". Wait, these are about the `useEffect`:

```tsx
useEffect(() => {
  if (session) setNotes(session.notes);
}, [session]);
```

Line 24 is this line. `session` is `Session | {} | null | undefined` (messed up types). With proper typing, `session` would be `Session | undefined`, `if (session)` narrows to `Session`, and `session.notes` works.

OK so fixing `useSession` type fixes all of these. Let me proceed.

Let me write out the complete files now.

Actually, one more thing: for the `useSession` fix, I should make sure the `useEffect` correctly imports. Let me check: `import { useEffect } from 'react';` — yes, react-query is separate.

Let me now draft each file completely:

**queries.ts** — I need to show the whole file. From the reference:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionQuery } from '../../api/client';
import type { Page, Session } from '../../api/types';

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    },
  });
}

export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() });
}

export function useUpdateSessionNotes(id: string) {
  ...
}

export function useCloseSession() {
  ...
}

export function patchLists(...) {
  ...
}
```

Fixed version:
- Add `useEffect` import
- Fix `useSession` with generic type and useEffect

**ActiveSessionBar.tsx** — whole file from reference minus the unused import.

**ActiveSessionBar.test.tsx** — whole file from reference minus the unused import.

**SessionsListScreen.tsx** — whole file from reference with import fixes.

Let me now write them out properly.

For ActiveSessionBar.test.tsx, the import line is:
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';
```

Remove the last line → 
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';
```

For ActiveSessionBar.tsx, the import line:
```tsx
import { getActiveSessionDirty, setActiveSessionDirty } from './activeSession';
```
→
```tsx
import { setActiveSessionDirty } from './activeSession';
```

For SessionsListScreen.tsx:
```tsx
import { Link, useNavigate } from 'react-router-dom';
```
→
```tsx
import { useNavigate } from 'react-router-dom';
```

And:
```tsx
import { getActiveSessionDirty } from './activeSession';
```
→
```tsx
import { getActiveSessionDirty, setActiveSessionDirty } from './activeSession';
```

Now let me write out all four complete files.
```

## reply

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  afterEach(() => {
    state.activeSessionId = null;
  });

  it('appears on authenticated screens', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('does not appear on the login screen', async () => {
    state.activeSessionId = 's-001';
    renderApp('/login');
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('resume navigates to the session detail', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'));
  });

  it('close calls the endpoint behind a confirm and empties the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close session' }),
    );

    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('shows elapsed time that ticks', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => {
      const bar = screen.getByTestId('active-session-bar');
      return bar.textContent?.match(/\d+m \d+s/);
    });

    expect(screen.getByTestId('active-session-bar').textContent).toMatch(/\d+m \d+s/);
  });

  it('shows the active session from GET /sessions/active on fresh load', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  });

  it('confirms before replacing a session with unsaved notes', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Open session 1 detail
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'));

    // Edit notes → dirty
    const textarea = screen.getByLabelText('Notes');
    await userEvent.click(textarea);
    await userEvent.type(textarea, 'unsaved change');

    // Going back triggers the dirty-flag blocker on the detail screen
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Leave with unsaved notes?' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

    // Now on the list, clicking another session triggers the list's confirm
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Switch active session?' })).toBeInTheDocument(),
    );

    // Confirm switch
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Switch active session?' })).getByRole('button', {
        name: 'Switch',
      }),
    );

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 2'));
  });
});
```

### src/features/sessions/ActiveSessionBar.tsx
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { setActiveSessionDirty } from './activeSession';
import { useActiveSession, useCloseSession } from './queries';

function useElapsedTime(startedAt: string) {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  const diff = Math.floor((tick.getTime() - new Date(startedAt).getTime()) / 1000);
  const minutes = Math.floor(diff / 60);
  const seconds = String(diff % 60).padStart(2, '0');
  return `${minutes}m ${seconds}s`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!session) {
      setActiveSessionDirty(false);
    }
  }, [session]);

  if (isError) {
    return (
      <div className="active-session-bar active-session-bar--error" role="alert">
        Could not load the active session.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="active-session-bar active-session-bar--loading">
        Loading active session…
      </div>
    );
  }

  if (!session) return null;

  const elapsed = useElapsedTime(session.startedAt);

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsed}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
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
    </div>
  );
}
```

### src/features/sessions/queries.ts
```ts
import { useEffect } from 'react';
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
  const query = useQuery<Session>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });

  useEffect(() => {
    if (query.data) {
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
    }
  }, [query.data, qc]);

  return query;
}

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
      qc.invalidateQueries({ queryKey: sessionKeys.active() });
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

### src/features/sessions/SessionsListScreen.tsx
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { getActiveSessionDirty, setActiveSessionDirty } from './activeSession';
import { useSessions } from './queries';

const STATUSES = ['', 'open', 'paused', 'closed'] as const;

export function SessionsListScreen() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  const { data, isLoading } = useSessions({ status: status || undefined, q: q || undefined, page });

  if (isLoading) return <p>Loading…</p>;
  if (!data) return <p>Could not load sessions.</p>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const handleOpenSession = (id: string) => {
    if (getActiveSessionDirty()) {
      setPendingSessionId(id);
      setConfirmOpen(true);
    } else {
      navigate(`/sessions/${id}`);
    }
  };

  return (
    <section>
      <h1>Sessions</h1>

      <div className="filters">
        <input
          aria-label="Search sessions"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === '' ? 'All statuses' : s}
            </option>
          ))}
        </select>
      </div>

      {data.items.length === 0 ? (
        <p>No sessions match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Operator</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id} onClick={() => handleOpenSession(s.id)} className="row--clickable">
                <td>{s.name}</td>
                <td>{s.operator}</td>
                <td>
                  <Badge tone={s.status}>{s.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav className="pagination">
        <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>
          Page {data.page} of {pages}
        </span>
        <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </nav>

      <ConfirmDialog
        open={confirmOpen}
        title="Switch active session?"
        body="The current active session has unsaved notes. Switching will discard them."
        confirmLabel="Switch"
        onCancel={() => {
          setConfirmOpen(false);
          setPendingSessionId(null);
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          setActiveSessionDirty(false);
          if (pendingSessionId) {
            navigate(`/sessions/${pendingSessionId}`);
          }
        }}
      />
    </section>
  );
}
```
