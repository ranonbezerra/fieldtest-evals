# 06-use-active-session.test.ts

## reasoning

```
Let me analyze what I need to write:

1. A test file `test/use-active-session.test.ts` for the `useActiveSession` hook
2. I need to implement all 17 test cases listed in the cases file
3. The hook uses `@tanstack/react-query` (useQuery, useMutation, useQueryClient)
4. I need to mock `fetch` and test the hook's behavior

Let me look at the cases:
1. Returns null when GET /sessions/active resolves 200 with body null
2. Returns the full ActiveSession object when GET /sessions/active resolves 200 with a session
3. Exposes isFetching true during initial GET and false once it settles
4. Sends PUT to /api/sessions/active with Content-Type application/json and body { "sessionId": "<id>" }
5. Includes credentials: "include" on every fetch call
6. Rejects setActive with ApiError code "session_not_found" when server responds 404
7. Rejects closeActive with ApiError code "session_already_closed" when server responds 409
8. Rejects closeActive with ApiError code "no_active_session" and does not issue a fetch when active is null
9. Invalidates and refetches after successful setActive so active updates to the new session
10. Invalidates and refetches after successful closeActive so active becomes null
11. Sets isMutating to true while setActive is in flight and false once settled
12. Sets isMutating to true while closeActive is in flight and false once settled
13. Parses code, message, and details from a well-formed error envelope
14. Produces a fallback ApiError with code "unknown_error" when error response body is not valid JSON
15. Handles an error envelope where top-level "error" field is a string rather than an object without throwing
16. Returns active as null (not undefined) when query has not yet resolved
17. Resolves setActive (does not reject) when server responds 204 No Content

Now, for testing a react-query hook, I need to:
- Use `renderHook` from `@testing-library/react` (or similar)
- Wrap in a `QueryClientProvider`
- Mock `global.fetch`

Let me think about the structure. The hook uses:
- `useQuery` with key `['sessions', 'active']`
- `useMutation` for setActive (PUT)
- `useMutation` for closeActive (POST)

For the test setup, I'll need:
- A `QueryClient` with retry disabled (to avoid flaky tests)
- Mocking `fetch` globally

Let me write the test file now. I'll use `@testing-library/react` for `renderHook` and `act`.

Looking at the hook source more carefully:

```ts
const { data: active, isFetching } = useQuery<ActiveSession | null>({
  queryKey: ACTIVE_SESSION_KEY,
  queryFn: async (): Promise<ActiveSession | null> => {
    const res = await fetch('/api/sessions/active', {
      credentials: 'include',
    });
    if (!res.ok) throw await parseErrorEnvelope(res);
    const json: unknown = await res.json();
    return (json as ActiveSession | null) ?? null;
  },
});
```

For the closeActive mutation:
```ts
const closeMutation = useMutation({
  mutationFn: async (): Promise<void> => {
    if (active === null) {
      throw new ApiError('no_active_session', 'No active session to close.');
    }
    const res = await fetch(`/api/sessions/${active.id}/close`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw await parseErrorEnvelope(res);
  },
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
  },
});
```

Now let me think about how to structure the tests. I'll use `renderHook` with a wrapper that provides `QueryClientProvider`.

For the "isFetching" test, I need to capture the state during the fetch. I can use a deferred promise for fetch.

For the "invalidates and refetches" tests, I need to verify that after the mutation succeeds, the query is refetched. I can track how many times fetch was called.

Let me write this out:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useActiveSession, ApiError } from '../src/features/sessions/use-active-session';

// Helper to create a wrapper
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

// ... tests
```

Wait, I need to think about how to mock fetch. I'll use `vi.fn()` and assign to `global.fetch`.

For the "credentials: include on every fetch call" test, I need to make multiple calls and check each one.

Let me think about the "invalidates and refetches" tests more carefully. After `setActive` succeeds, the hook calls `queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY })`. This triggers a refetch of the query. So I need to:
1. Set up fetch to first return a session (initial GET), then return 204 for the PUT, then return the new session for the refetch GET.

Actually, let me reconsider. The `invalidateQueries` will trigger a refetch of the active query. So after the PUT succeeds, the GET will be called again. I can verify by checking that fetch was called with the GET URL a second time, or that the `active` value in the hook updates.

Let me think about test 9 more carefully:
- Initial state: GET /api/sessions/active returns session A
- Call setActive('B')
- PUT /api/sessions/active succeeds (204)
- invalidateQueries triggers refetch
- GET /api/sessions/active now returns session B
- active should be B

For test 10:
- Initial state: GET /api/sessions/active returns session A
- Call closeActive()
- POST /api/sessions/A/close succeeds (204)
- invalidateQueries triggers refetch
- GET /api/sessions/active now returns null
- active should be null

Now for the "isMutating" tests (11, 12), I need to check the state while the mutation is in flight. I can use a deferred promise.

Let me write the complete file now.

Actually, for the "isFetching" test (case 3), I need to observe `isFetching` being true during the initial fetch and then false. I can use a deferred promise and check the state before resolving it.

Let me also think about the "returns active as null (not undefined) when the query has not yet resolved" test (case 16). This is about the initial state before the first fetch completes. When `useQuery` hasn't resolved yet, `data` is `undefined`, but the hook returns `active ?? null` which gives `null`. I need to render the hook and immediately check that `active` is `null` (not `undefined`) before the fetch resolves.

Wait, actually with `renderHook`, the initial render happens synchronously but the query fetch is async. So right after `renderHook`, the data should be in its initial state (undefined), and the hook should return null. Let me verify this by using a deferred fetch that never resolves (or resolves later).

Let me now write the complete test file. I'll be careful about:
- Using `vi.fn()` for fetch mock
- Proper async handling with `waitFor` and `act`
- Testing all 17 cases
- Not adding anything the plan doesn't specify

One thing I need to be careful about: the `closeActive` mutation captures `active` from the closure. So when I set up the test, the initial GET needs to resolve first (to populate `active`), and then I call `closeActive`. The mutation function closure will see the `active` value from the render where it was captured.

Actually, looking at the code again:
```ts
const closeMutation = useMutation({
  mutationFn: async (): Promise<void> => {
    if (active === null) {
      throw new ApiError('no_active_session', 'No active session to close.');
    }
    const res = await fetch(`/api/sessions/${active.id}/close`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw await parseErrorEnvelope(res);
  },
  ...
});
```

The `active` here is from the current render's closure. So if I call `closeActive` after the initial query has resolved, the mutation will have the correct `active` value.

But wait - there's a subtlety. The `useMutation` hook captures the `mutationFn` at render time. So if `active` changes between renders, the mutation function will use the latest value at the time of the next render. But `mutateAsync` will use the `mutationFn` from the current render.

Actually, in React Query v4/v5, the `mutationFn` is re-evaluated on each render, so it will have the latest closure. So as long as the component has re-rendered with the new `active` value, calling `closeActive` will use that value.

For the test where `active` is null and we call `closeActive`, I need to make sure the initial GET resolves with null, then call `closeActive`. The mutation should throw `no_active_session` without making a fetch call.

Let me now write the full test file.

For the "credentials: include on every fetch call" test (case 5), I need to:
1. Do an initial GET
2. Do a setActive PUT
3. Do a closeActive POST (with active session)
4. Check that all fetch calls included `credentials: 'include'`

Actually, I can simplify this. I'll set up a scenario where all three fetch calls happen, then check each call's options.

Wait, but closeActive requires an active session. So I need:
1. Initial GET returns a session
2. setActive PUT succeeds (and triggers refetch)
3. closeActive POST succeeds

Let me structure this test to make all three calls and verify credentials on each.

Actually, a simpler approach: I can just check that every call to the mock fetch has `credentials: 'include'` in its options. I'll set up a flow that triggers all three types of calls.

Let me finalize my approach and write the file.

For the "isMutating" tests, I'll use a deferred promise:

```ts
let resolveSetActive: (res: Response) => void;
const setActivePromise = new Promise<Response>((r) => { resolveSetActive = r; });

// First call (GET) resolves immediately
// Second call (PUT) returns the deferred promise
mockFetch.mockImplementation((url: string, _opts?: RequestInit) => {
  if (url === '/api/sessions/active' && !_opts?.method) {
    return Promise.resolve(makeResponse(200, null));
  }
  if (url === '/api/sessions/active' && _opts?.method === 'PUT') {
    return setActivePromise;
  }
  return Promise.resolve(makeResponse(204, null));
});

const { result } = renderHook(() => useActiveSession(), { wrapper });

// Wait for initial query to settle
await waitFor(() => expect(result.current.isFetching).toBe(false));

// Now call setActive
act(() => {
  void result.current.setActive('some-id');
});

// isMutating should be true
expect(result.current.isMutating).toBe(true);

// Resolve the mutation
act(() => {
  resolveSetActive(makeResponse(204, null));
});

await waitFor(() => expect(result.current.isMutating).toBe(false));
```

Hmm, but there's a complication. When `setActive` succeeds, it invalidates the query, which triggers a refetch. So I need to handle that additional GET call too.

Let me think about this more carefully...

Actually, for the `isMutating` test, I just need to check that it's true during the mutation and false after. The refetch happening in the background doesn't affect `isMutating` (it affects `isFetching`). So I can just:
1. Let initial query settle
2. Start the mutation (with a deferred promise)
3. Check `isMutating` is true
4. Resolve the mutation
5. Wait for `isMutating` to be false

The refetch will happen but that's fine - it just means another GET call will be made. I'll make sure my mock handles that.

Let me also think about the "resolves setActive when server responds 204" test (case 17). The `setActiveMutation.mutationFn` does:
```ts
const res = await fetch('/api/sessions/active', { method: 'PUT', ... });
if (!res.ok) throw await parseErrorEnvelope(res);
```

204 is OK (res.ok is true for 200-299), so it won't throw. And it doesn't call `res.json()` on success. So it resolves fine.

Now let me write the complete file. I'll aim for clarity and completeness.

One more consideration: for the "invalidates and refetches" tests, I need to verify that the refetch actually happened. I can do this by:
- Counting the number of GET calls to `/api/sessions/active`
- Or checking that `result.current.active` updates to the new value

I'll use both approaches where appropriate.

Let me also think about the `parseErrorEnvelope` tests (cases 13, 14, 15). These test the error parsing logic. I can trigger them by:
- Case 13: Return a 400 with a well-formed error envelope, call setActive, check the ApiError fields
- Case 14: Return a 500 with non-JSON body, call setActive, check the ApiError has code "unknown_error"
- Case 15: Return a 400 with `{ error: "some string" }`, call setActive, check it doesn't throw and has code "unknown_error"

Wait, for case 15, looking at the parser:
```ts
if (
  typeof body === 'object' &&
  body !== null &&
  'error' in body &&
  typeof (body as Record<string, unknown>).error === 'object' &&
  (body as Record<string, unknown>).error !== null
) {
```

If `body.error` is a string, `typeof body.error === 'object'` is false, so the inner block is skipped. The defaults remain: code = 'unknown_error', message = res.statusText, details = {}.

So for case 15, the result should be an ApiError with code 'unknown_error'.

Let me now write the complete file.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useActiveSession, ApiError } from '../src/features/sessions/use-active-session.js';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const headerMap = new Map<string, string>([['content-type', 'application/json'], ...Object.entries(headers ?? {})]);
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: headerMap,
  });
}

function makeNullResponse(status: number): Response {
  return new Response('null', { status, headers: { 'content-type': 'application/json' } });
}

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useActiveSession', () => {
  it('returns null when GET /sessions/active resolves 200 with body null', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, null),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.active).toBeNull();
  });

  it('returns the full ActiveSession object (id, name, status, startedAt) when GET /sessions/active resolves 200 with a session', async () => {
    const session = {
      id: 'sess-1',
      name: 'Session One',
      status: 'open' as const,
      startedAt: '2025-01-01T10:00:00.000Z',
    };
    mockFetch.mockResolvedValue(makeResponse(200, session));

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.active).toEqual(session);
  });

  it('exposes isFetching true during the initial GET and false once it settles', async () => {
    let resolveFetch: (res: Response) => void;
    const fetchPromise = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    mockFetch.mockReturnValue(fetchPromise);

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    // isFetching should be true while the initial query is in flight
    expect(result.current.isFetching).toBe(true);

    act(() => {
      resolveFetch!(makeResponse(200, null));
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });

  it('sends PUT to /api/sessions/active with Content-Type application/json and body { "sessionId": "<id>" }', async () => {
    // Initial GET resolves with null
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(makeResponse(204, null));
      }
      // refetch after invalidate
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    await act(async () => {
      await result.current.setActive('my-session-id');
    });

    const putCall = mockFetch.mock.calls.find((call) => {
      const opts = call[1] as RequestInit | undefined;
      return opts?.method === 'PUT';
    });
    expect(putCall).toBeDefined();
    expect(putCall![0]).toBe('/api/sessions/active');
    const opts = putCall![1] as RequestInit;
    expect(opts.method).toBe('PUT');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body as string)).toEqual({ sessionId: 'my-session-id' });
  });

  it('includes credentials: "include" on every fetch call', async () => {
    const session = { id: 'sess-1', name: 'S', status: 'open' as const, startedAt: '2025-01-01T00:00:00.000Z' };
    let callCount = 0;
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      callCount++;
      if (opts?.method === 'PUT') {
        return Promise.resolve(makeResponse(204, null));
      }
      if (opts?.method === 'POST') {
        return Promise.resolve(makeResponse(204, null));
      }
      // GET calls: first returns session, subsequent return null (for refetch after close)
      const getCount = mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'PUT' && (c[1] as RequestInit | undefined)?.method !== 'POST').length;
      if (getCount <= 2) {
        return Promise.resolve(makeResponse(200, session));
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    await act(async () => {
      await result.current.setActive('sess-2');
    });
    await waitFor(() => expect(result.current.active?.id).toBe('sess-2'));
    // Wait for refetch to settle before closing
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    await act(async () => {
      await result.current.closeActive();
    });

    // Every call should have credentials: 'include'
    for (const call of mockFetch.mock.calls) {
      const opts = call[1] as RequestInit;
      expect(opts.credentials).toBe('include');
    }
    // We should have had at least 3 distinct types of calls: GET, PUT, POST
    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? 'GET');
    expect(methods).toContain('PUT');
    expect(methods).toContain('POST');
    expect(methods).toContain('GET');
  });

  it('rejects setActive with ApiError whose code is "session_not_found" when the server responds 404', async () => {
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(
          makeResponse(404, { error: { code: 'session_not_found', message: 'Session not found', details: {} } }),
        );
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.setActive('bad-id');
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('session_not_found');
  });

  it('rejects closeActive with ApiError whose code is "session_already_closed" when the server responds 409', async () => {
    const session = { id: 'sess-1', name: 'S', status: 'open' as const, startedAt: '2025-01-01T00:00:00.000Z' };
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return Promise.resolve(
          makeResponse(409, { error: { code: 'session_already_closed', message: 'Already closed', details: {} } }),
        );
      }
      return Promise.resolve(makeResponse(200, session));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.active?.id).toBe('sess-1');

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.closeActive();
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('session_already_closed');
  });

  it('rejects closeActive with ApiError code "no_active_session" and does not issue a fetch when active is null', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, null));

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    const fetchCallsBeforeClose = mockFetch.mock.calls.length;

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.closeActive();
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('no_active_session');
    // No additional fetch was issued
    expect(mockFetch.mock.calls.length).toBe(fetchCallsBeforeClose);
  });

  it('invalidates and refetches the active-session query after successful setActive so active updates to the new session', async () => {
    const oldSession = { id: 'old', name: 'Old', status: 'open' as const, startedAt: '2025-01-01T00:00:00.000Z' };
    const newSession = { id: 'new', name: 'New', status: 'open' as const, startedAt: '2025-01-02T00:00:00.000Z' };
    let getCallCount = 0;
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(makeResponse(204, null));
      }
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve(makeResponse(200, oldSession));
      }
      // Refetch returns the new session
      return Promise.resolve(makeResponse(200, newSession));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.active?.id).toBe('old');

    await act(async () => {
      await result.current.setActive('new');
    });

    await waitFor(() => expect(result.current.active?.id).toBe('new'));
    // The refetch should have been a second GET call
    expect(getCallCount).toBeGreaterThanOrEqual(2);
  });

  it('invalidates and refetches after successful closeActive so active becomes null', async () => {
    const session = { id: 'sess-1', name: 'S', status: 'open' as const, startedAt: '2025-01-01T00:00:00.000Z' };
    let getCallCount = 0;
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return Promise.resolve(makeResponse(204, null));
      }
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve(makeResponse(200, session));
      }
      // Refetch after close returns null
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.active?.id).toBe('sess-1');

    await act(async () => {
      await result.current.closeActive();
    });

    await waitFor(() => expect(result.current.active).toBeNull());
    // The refetch should have been a second GET call
    expect(getCallCount).toBeGreaterThanOrEqual(2);
  });

  it('sets isMutating to true while setActive is in flight and false once the promise settles (success or error)', async () => {
    let resolvePut: (res: Response) => void;
    const putPromise = new Promise<Response>((r) => {
      resolvePut = r;
    });
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return putPromise;
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let settle: () => void;
    const settled = new Promise<void>((r) => { settle = r; });

    act(() => {
      const p = result.current.setActive('some-id').catch(() => {});
      p.then(settle);
    });

    // Wait for the mutation to be registered as in-flight
    await waitFor(() => expect(result.current.isMutating).toBe(true));

    act(() => {
      resolvePut!(makeResponse(204, null));
    });

    await waitFor(() => expect(result.current.isMutating).toBe(false));
  });

  it('sets isMutating to true while closeActive is in flight and false once settled', async () => {
    const session = { id: 'sess-1', name: 'S', status: 'open' as const, startedAt: '2025-01-01T00:00:00.000Z' };
    let resolvePost: (res: Response) => void;
    const postPromise = new Promise<Response>((r) => {
      resolvePost = r;
    });
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return postPromise;
      }
      return Promise.resolve(makeResponse(200, session));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.active?.id).toBe('sess-1');

    act(() => {
      result.current.closeActive().catch(() => {});
    });

    await waitFor(() => expect(result.current.isMutating).toBe(true));

    act(() => {
      resolvePost!(makeResponse(204, null));
    });

    await waitFor(() => expect(result.current.isMutating).toBe(false));
  });

  it('parses code, message, and details from a well-formed { error: { code, message, details } } envelope', async () => {
    const envelope = {
      error: {
        code: 'validation_failed',
        message: 'Name is required',
        details: { field: 'name' },
      },
    };
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(makeResponse(400, envelope));
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.setActive('x');
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.code).toBe('validation_failed');
    expect(err.message).toBe('Name is required');
    expect(err.details).toEqual({ field: 'name' });
  });

  it('produces a fallback ApiError with code "unknown_error" when the error response body is not valid JSON', async () => {
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } }));
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.setActive('x');
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('unknown_error');
  });

  it('handles an error envelope where the top-level "error" field is a string rather than an object without throwing', async () => {
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(makeResponse(400, { error: 'something went wrong' }));
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.setActive('x');
      } catch (e) {
        caught = e;
      }
    });

    // Should not have thrown a TypeError; should produce an ApiError with fallback code
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('unknown_error');
  });

  it('returns active as null (not undefined) when the query has not yet resolved and data is in its initial state', async () => {
    let resolveFetch: (res: Response) => void;
    const fetchPromise = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    mockFetch.mockReturnValue(fetchPromise);

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    // Before the fetch resolves, active should be null (not undefined)
    expect(result.current.active).toBeNull();
    expect(result.current.active).not.toBeUndefined();

    // Cleanup: resolve to avoid hanging
    act(() => {
      resolveFetch!(makeResponse(200, null));
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });

  it('resolves setActive (does not reject) when the server responds 204 No Content', async () => {
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(makeResponse(200, null));
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useActiveSession(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    let rejected = false;
    await act(async () => {
      try {
        await result.current.setActive('valid-id');
      } catch {
        rejected = true;
      }
    });

    expect(rejected).toBe(false);
  });
});
```
