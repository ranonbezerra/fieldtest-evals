import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ASSUMPTION: `../../api/client` exists but does not export `get`, `post`, or `patch`;
// using a local fetch-based helper instead.

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Session {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  notes: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export const sessionsKeys = {
  all: ['sessions'] as const,
  lists: () => [...sessionsKeys.all, 'list'] as const,
  list: (params: Record<string, unknown>) => [...sessionsKeys.lists(), params] as const,
  details: () => [...sessionsKeys.all, 'detail'] as const,
  detail: (id: string) => [...sessionsKeys.details(), id] as const,
  active: () => [...sessionsKeys.all, 'active'] as const,
};

export interface SessionListParams {
  page: number;
  pageSize: number;
  status?: string;
}

export function useSessionList(params: SessionListParams) {
  const { page, pageSize, status } = params;
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) qs.set('status', status);

  return useQuery({
    queryKey: sessionsKeys.list(params),
    queryFn: () => get<Page<Session>>(`/sessions?${qs.toString()}`),
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: sessionsKeys.detail(id),
    queryFn: () => get<Session>(`/sessions/${id}`),
    enabled: Boolean(id),
  });
}

export function useActiveSession() {
  return useQuery({
    queryKey: sessionsKeys.active(),
    queryFn: () => get<Session | null>(`/sessions/active`),
  });
}

export function useUpdateSessionNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      patch<Session>(`/sessions/${id}`, { notes }),
    onSuccess: (updated) => {
      queryClient.setQueryData(sessionsKeys.detail(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
    },
  });
}

export function useCloseSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<Session>(`/sessions/${id}/close`),
    onSuccess: () => {
      queryClient.setQueryData(sessionsKeys.active(), null);
      queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
    },
  });
}
