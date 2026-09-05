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
