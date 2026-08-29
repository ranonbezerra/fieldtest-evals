import type { AuthUser, Order, Page, Session } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    throw new ApiError(res.status, body.code ?? 'unknown');
  }
  return (await res.json()) as T;
}

export interface SessionQuery {
  status?: string;
  q?: string;
  page: number;
}

export const api = {
  login: (name: string) => request<AuthUser>('/auth/login', { method: 'POST', body: JSON.stringify({ name }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<AuthUser>('/auth/me'),

  listSessions: (q: SessionQuery) => {
    const params = new URLSearchParams({ page: String(q.page) });
    if (q.status) params.set('status', q.status);
    if (q.q) params.set('q', q.q);
    return request<Page<Session>>(`/sessions?${params.toString()}`);
  },
  getSession: (id: string) => request<Session>(`/sessions/${id}`),
  getActiveSession: () => request<Session | null>('/sessions/active'),
  updateSession: (id: string, patch: Pick<Session, 'notes'>) =>
    request<Session>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  closeSession: (id: string) => request<Session>(`/sessions/${id}/close`, { method: 'POST' }),

  listOrders: (q: { status?: string; page: number }) => {
    const params = new URLSearchParams({ page: String(q.page) });
    if (q.status) params.set('status', q.status);
    return request<Page<Order>>(`/orders?${params.toString()}`);
  },
  getOrder: (id: string) => request<Order>(`/orders/${id}`),
  approveOrder: (id: string) => request<Order>(`/orders/${id}/approve`, { method: 'POST' }),
  rejectOrder: (id: string) => request<Order>(`/orders/${id}/reject`, { method: 'POST' }),
};
