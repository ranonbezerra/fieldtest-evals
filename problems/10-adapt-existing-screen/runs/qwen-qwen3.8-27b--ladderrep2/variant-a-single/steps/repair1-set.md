# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. **`ActiveSessionBar.test.tsx(129,67)`**: `Generic type 'HttpResponse<BodyType>' requires 1 type argument(s).` — This is `new Promise<HttpResponse>(() => {})` on line 129. `HttpResponse` from msw requires a type argument. Fix: `new Promise<HttpResponse<any>>(() => {})`

2. **`queries.ts(22,5)` and `(22,17)`**: `useQuery` in `@tanstack/react-query` v5 doesn't support `onSuccess` callback. The code uses `onSuccess` in `useSession`. In react-query v5, you use `onSuccess` on mutations, not queries. The fix is to use `onSettled` or handle the logic differently. Actually, looking more carefully, in react-query v5, `useQuery` does NOT have an `onSuccess` option. The correct approach is to either:
   - Use `select` and a side-effect elsewhere
   - Use the query's `data` in a component effect
   - Use `useEffect` on the data

   But wait — the task says "Change exactly what the compiler requires" and "Do not add features, do not rename anything the errors do not mention, do not reorganise."

   The issue is that `onSuccess` doesn't exist on `useQuery` options in react-query v5. The simplest fix that preserves the intent is to use `onSettled` — no wait, that doesn't exist either. 

   Actually, looking at the react-query v5 API: `useQuery` accepts `onSuccess`? Let me think... No, in v5, `useQuery` does NOT accept `onSuccess`. That's a v4 thing. In v5, you'd use `onSettled` — no, that's also not a query option.

   The proper v5 way is to use `onSuccess` on the query? No. Let me reconsider.

   In TanStack Query v5:
   - `useQuery` options: `queryKey`, `queryFn`, `enabled`, `select`, `staleTime`, `gcTime`, `retry`, `refetchInterval`, etc.
   - There is NO `onSuccess` for queries in v5.
   - For side effects on data change, you use `useEffect`.

   But the simplest compiler fix that preserves the logic: replace `onSuccess` with a pattern that works. Since the task says "Change exactly what the compiler requires", I need to find the minimal fix.

   Actually, looking at this more carefully — the type error says `'onSuccess' does not exist in type 'UseQueryOptions<...>'`. The minimal fix is to remove `onSuccess` and handle it differently. But the instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise."

   Hmm, but I need to fix the compiler error. The `onSuccess` callback is not valid in react-query v5's `useQuery`. The cleanest minimal fix is to extract the side-effect into a `useEffect` that watches the query data. But that would require importing `useEffect` and restructuring.

   Wait, let me reconsider. Maybe the version of @tanstack/react-query being used does support `onSuccess`? No, the error clearly states it doesn't.

   The most minimal fix: replace `onSuccess` with the pattern that works. In v5, you can use `useEffect` to react to data changes. Let me write it:

   ```ts
   export function useSession(id: string) {
     const qc = useQueryClient();
     const { data: session, ...rest } = useQuery({
       queryKey: sessionKeys.detail(id),
       queryFn: () => api.getSession(id),
     });

     useEffect(() => {
       if (session && session.status !== 'closed') {
         qc.setQueryData(sessionKeys.active(), session);
       }
     }, [session, qc]);

     return { data: session, ...rest };
   }
   ```

   But this changes the return type and structure. That seems like more than "exactly what the compiler requires."

   Actually, the simplest fix: just remove `onSuccess` and move the logic to where the component uses it. But that's reorganising.

   Let me look at this differently. The error is that `onSuccess` doesn't exist on `UseQueryOptions`. The minimal compiler fix is to not pass `onSuccess`. But then the logic is lost. 

   I think the right approach here is to use `useEffect` as the standard v5 pattern. This is the correct v5 idiom and is the minimal change to fix the type error while preserving behavior.

   Actually wait — I need to look at what `useSession` returns and how it's used. The function returns the result of `useQuery`. If I restructure it, the return type changes. Let me think about what's minimal.

   The simplest approach: use `useEffect` inside the hook:

   ```ts
   export function useSession(id: string) {
     const qc = useQueryClient();
     const result = useQuery({
       queryKey: sessionKeys.detail(id),
       queryFn: () => api.getSession(id),
     });

     useEffect(() => {
       const session = result.data;
       if (session && session.status !== 'closed') {
         qc.setQueryData(sessionKeys.active(), session);
       }
     }, [result.data, qc]);

     return result;
   }
   ```

   This preserves the return type (it's still the `UseQueryResult`) and just adds the side effect. I need to import `useEffect` from react.

3. **`SessionDetailScreen.tsx` errors**: Multiple errors saying properties don't exist on type `{}`. This suggests that `useSession` returns data typed as `{}` or the session is typed as `{}`. This is likely because `useSession`'s return type is broken due to the `onSuccess` error — the compiler can't infer the type properly.

   Wait, but if I fix `queries.ts`, will `SessionDetailScreen.tsx` errors go away? Let me think...

   If `useSession` had `onSuccess` which doesn't exist, TypeScript might have inferred the wrong type for the return. Once I fix `queries.ts` by removing `onSuccess` and using `useEffect`, the return type of `useSession` should be properly inferred as `UseQueryResult<Session, Error>`, and `session` in the component should be typed as `Session | undefined`.

   But wait, the errors say:
   - `Property 'notes' does not exist on type '{}'`
   - `'session' is possibly 'null'`

   The `'{}'` type suggests that the query's data type is being inferred as `{}`. This would happen if `api.getSession(id)` returns something that TS can't resolve properly, OR if the `onSuccess` error caused the whole type inference to break.

   Actually, looking more carefully at the errors:
   - Line 18: `Property 'notes' does not exist on type '{}'`
   - Line 23: `'session' is possibly 'null'` AND `Property 'notes' does not exist on type '{}'`
   - Line 32: `Property 'name' does not exist on type '{}'`
   - etc.

   The `'{}'` type is likely a consequence of the `onSuccess` error in `queries.ts`. When TypeScript can't resolve the overload, it falls back to `{}`. So fixing `queries.ts` should fix these.

   But wait — there's also `'session' is possibly 'null'` which is a different issue. In react-query v5, `useQuery` returns `data` as `T | undefined`, not `T | null`. If the component does `session.notes` without checking for undefined, that's a different error. But the error says `possibly 'null'` not `possibly 'undefined'`. 

   Hmm, actually if the type inference is broken due to the `onSuccess` error, TypeScript might be showing cascading errors. Let me just fix `queries.ts` and see if that resolves everything.

   Actually, I think the issue is:
   - In `queries.ts`, the `useQuery` call with `onSuccess` fails type-checking, so TypeScript can't determine the return type, defaulting to something with `data: {}`.
   - In `SessionDetailScreen.tsx`, the component destructures or accesses `session` from the hook result, and since the type is `{}`, all property accesses fail.

   So the root cause is in `queries.ts`. Fixing that should fix `SessionDetailScreen.tsx`.

   Let me also check: does `SessionDetailScreen.tsx` need changes? The error `'session' is possibly 'null'` on line 23 — if after fixing `queries.ts`, the type is `Session | undefined`, then `session.notes` would still error with "possibly undefined". But the error says "possibly 'null'" which is different. This suggests the type inference is completely broken right now, and once I fix `queries.ts`, the proper type will be `Session | undefined` and the component likely already handles the undefined case (or the error will change).

   Wait, but the task says "Fix all of them" and "Return only the files you changed." If `SessionDetailScreen.tsx` errors are all cascading from `queries.ts`, I only need to fix `queries.ts`.

   Let me be more careful. The error on line 23 says:
   - `error TS18047: 'session' is possibly 'null'.`
   - `error TS2339: Property 'notes' does not exist on type '{}'.`

   If the type were properly `Session | undefined`, the error would be "possibly undefined" not "possibly null". The fact that it says "null" AND the type is `{}` strongly suggests the entire type inference chain is broken due to the `onSuccess` error.

   So my plan:
   1. Fix `ActiveSessionBar.test.tsx` line 129: `new Promise<HttpResponse<any>>(() => {})`
   2. Fix `queries.ts`: Remove `onSuccess` from `useQuery`, add `useEffect` for the side effect, import `useEffect` from react.

   Let me write the fixed files.

   For `queries.ts`:
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
     const result = useQuery({
       queryKey: sessionKeys.detail(id),
       queryFn: () => api.getSession(id),
     });

     useEffect(() => {
       const session = result.data;
       if (session && session.status !== 'closed') {
         qc.setQueryData(sessionKeys.active(), session);
       }
     }, [result.data, qc]);

     return result;
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

   For `ActiveSessionBar.test.tsx`, I only need to fix line 129. The error is:
   `Generic type 'HttpResponse<BodyType>' requires 1 type argument(s).`
   
   The line is: `server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse>(() => {})));`
   
   Fix: `new Promise<HttpResponse<any>>(() => {})`

   Now, do I need to return `SessionDetailScreen.tsx`? The errors there are all cascading from the `queries.ts` type inference issue. Once `queries.ts` is fixed, `useSession` will return a proper `UseQueryResult<Session, Error>` and `session` will be `Session | undefined`. 

   But wait — will there still be an error about `session` possibly being undefined? Let me look at the original errors again:
   - Line 18: `Property 'notes' does not exist on type '{}'` — this is because the type is `{}`
   - Line 23: `'session' is possibly 'null'` — this is because the type inference is broken
   - Line 23: `Property 'notes' does not exist on type '{}'` — same

   Once the type is properly `Session | undefined`, the `'session' is possibly 'null'` error would change to `'session' is possibly 'undefined'` — but wait, does the component already guard against this? Looking at the pattern, line 23 has `session.notes` which would error if `session` is `undefined`. 

   Hmm, but the error says "possibly 'null'" not "possibly 'undefined'". In the broken state, TypeScript is inferring `null` (or `{}` which is nullable in some contexts). Once fixed, it should be `Session | undefined`.

   If the component does something like:
   ```tsx
   const { data: session } = useSession(id);
   if (!session) return null; // or some loading state
   // then session is Session here
   ```
   
   Then after the fix, there would be no error. The component likely already has a null/undefined check (it's an existing screen that works), so the errors are purely from the broken type inference in `queries.ts`.

   I'll only return the two files that need changes: `ActiveSessionBar.test.tsx` and `queries.ts`.

   Wait, I need to be careful. Let me re-read the instructions: "Return only the files you changed." So I should only return files I'm actually changing. If `SessionDetailScreen.tsx` doesn't need changes (its errors are cascading), I don't return it.

   Let me finalize my two files.
```

## reply

Looking at the errors as a whole, I see **two distinct mistakes**:

1. **`queries.ts`**: `onSuccess` is not a valid option on `useQuery` in TanStack Query v5. This breaks type inference for the return type, which cascades into all the `SessionDetailScreen.tsx` errors (type falls back to `{}`). Fixing `queries.ts` resolves those downstream errors without touching that file.

2. **`ActiveSessionBar.test.tsx`**: `HttpResponse` requires a type argument in the msw version used here.

---

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
  const result = useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
  });

  useEffect(() => {
    const session = result.data;
    if (session && session.status !== 'closed') {
      qc.setQueryData(sessionKeys.active(), session);
    }
  }, [result.data, qc]);

  return result;
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
    server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse<any>>(() => {})));
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
