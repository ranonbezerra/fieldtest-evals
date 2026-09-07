import type { Session } from '../src/api/types';

export interface FakeRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface FakeApiState {
  sessions: Session[];
  activeId: string | null;
}

export interface FakeApi {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>;
  state: FakeApiState;
  requests: FakeRequest[];
  /** Make matching requests answer with an error-envelope response. */
  failNext: (matches: (method: string, url: string) => boolean, status?: number, code?: string) => void;
}

/**
 * In-memory stand-in for the back-office API. It speaks the same wire shapes
 * (kebab-case paths, error envelope, 204 for "no active session") so the real
 * client code under test is exercised end to end.
 */
export function createFakeApi(options: { sessions?: Session[]; activeId?: string | null } = {}): FakeApi {
  const state: FakeApiState = {
    sessions: options.sessions ?? [],
    activeId: options.activeId ?? null,
  };
  const requests: FakeRequest[] = [];
  let failure: { matches: (method: string, url: string) => boolean; status: number; code: string } | null = null;

  function json(status: number, body: unknown): unknown {
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    };
  }

  function noContent(): unknown {
    return { status: 204, ok: true, json: async () => { throw new Error('no body'); } };
  }

  function envelope(status: number, code: string, message: string): unknown {
    return json(status, { error: { code, message, details: {} } });
  }

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<unknown> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(String(input), 'http://fake.local');
    const body = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url: `${url.pathname}${url.search}`, body });

    if (failure !== null && failure.matches(method, url.pathname)) {
      return envelope(failure.status, failure.code, `${failure.code}: simulated failure`);
    }

    if (url.pathname === '/auth/login' && method === 'POST') {
      const credentials = body as { email?: string; password?: string };
      if (!credentials.email || !credentials.password || credentials.password === 'wrong-password') {
        return envelope(401, 'invalid_credentials', 'Invalid email or password');
      }
      return json(200, { token: 'fake-token', user: { id: 'op-1', name: 'Op' } });
    }

    if (url.pathname === '/sessions/active' && method === 'GET') {
      const active = state.sessions.find((s) => s.id === state.activeId);
      return active ? json(200, { ...active }) : noContent();
    }

    if (url.pathname === '/sessions' && method === 'GET') {
      const statusFilter = url.searchParams.get('status');
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('page_size') ?? '10');
      const filtered = statusFilter
        ? state.sessions.filter((s) => s.status === statusFilter)
        : [...state.sessions];
      const start = (page - 1) * pageSize;
      return json(200, { items: filtered.slice(start, start + pageSize), total: filtered.length });
    }

    const item = url.pathname.match(/^\/sessions\/([^/]+)(?:\/(activate|close))?$/);
    if (item) {
      const sessionId = item[1];
      const sub = item[2];
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        return envelope(404, 'resource_not_found', `Session ${sessionId} not found`);
      }
      if (sub === 'activate' && method === 'POST') {
        state.activeId = sessionId;
        return json(200, { ...session });
      }
      if (sub === 'close' && method === 'POST') {
        if (session.status === 'closed') {
          return envelope(409, 'session_already_closed', 'Session is already closed');
        }
        session.status = 'closed';
        // Closing the active session empties the active slot server-side, so
        // the bar stays empty after a later refresh too.
        if (state.activeId === sessionId) {
          state.activeId = null;
        }
        return json(200, { ...session });
      }
      if (method === 'GET') {
        return json(200, { ...session });
      }
      if (method === 'PATCH') {
        const patch = body as { notes?: string };
        if (typeof patch.notes === 'string') {
          session.notes = patch.notes;
        }
        return json(200, { ...session });
      }
    }

    return envelope(404, 'route_not_found', `No route for ${method} ${url.pathname}`);
  };

  return {
    fetch: fetchImpl,
    state,
    requests,
    failNext: (matches, status = 500, code = 'internal_error') => {
      failure = { matches, status, code };
    },
  };
}
