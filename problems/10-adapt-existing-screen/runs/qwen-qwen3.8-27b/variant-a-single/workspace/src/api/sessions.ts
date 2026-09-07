import { apiFetch } from './client';
import type { PagedSessions, Session, SessionListParams } from './types';

// ASSUMPTION: the variant names `GET /sessions/active` and "the existing close
// endpoint" but leaves the remaining routes and the list query params
// unspecified; the shapes below follow the platform conventions (kebab-case
// plural paths, snake_case query params, JSON bodies).

export async function listSessions(params: SessionListParams): Promise<PagedSessions> {
  const query = new URLSearchParams();
  if (params.status !== 'all') {
    query.set('status', params.status);
  }
  query.set('page', String(params.page));
  query.set('page_size', String(params.pageSize));
  return apiFetch<PagedSessions>(`/sessions?${query.toString()}`);
}

export async function getSession(id: string): Promise<Session> {
  return apiFetch<Session>(`/sessions/${id}`);
}

// Source of truth for the active session; the API answers 204 when none.
export async function getActiveSession(): Promise<Session | null> {
  const active = await apiFetch<Session | undefined>('/sessions/active');
  return active ?? null;
}

export async function activateSession(id: string): Promise<Session> {
  return apiFetch<Session>(`/sessions/${id}/activate`, { method: 'POST' });
}

export async function closeSession(id: string): Promise<Session> {
  return apiFetch<Session>(`/sessions/${id}/close`, { method: 'POST' });
}

export async function saveSessionNotes(id: string, notes: string): Promise<Session> {
  return apiFetch<Session>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}
