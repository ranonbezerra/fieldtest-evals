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
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    // Fetching a session is what makes the server mark it active, so opening one
    // always re-validates — even when a fresh copy is already cached.
    refetchOnMount: 'always',
  });
}

/**
 * The server's pointer to the operator's active session. The active-session bar
 * reads this, so a full page refresh restores the bar from the API rather than
 * from any client-side memory.
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
      // Closing the active session clears the server's pointer; mirror it so the
      // bar empties without waiting on a refetch.
      if (qc.getQueryData<Session | null>(sessionKeys.active())?.id === updated.id) {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}

/**
 * Mirror the server's "opening a session makes it active" rule in the cache.
 * Only not-yet-closed sessions can be active. Any in-flight /sessions/active
 * read is stale by definition once a detail fetch has landed, so cancel it
 * before writing.
 */
export function applyActiveSession(
  qc: ReturnType<typeof useQueryClient>,
  session: Session,
): void {
  if (session.status === 'closed') return;
  qc.cancelQueries({ queryKey: sessionKeys.active() });
  qc.setQueryData(sessionKeys.active(), session);
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
