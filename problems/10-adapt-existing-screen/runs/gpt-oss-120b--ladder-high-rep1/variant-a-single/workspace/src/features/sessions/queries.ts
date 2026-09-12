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
  return useQuery<Session[], unknown, Session[], readonly unknown[]>({
    queryKey: sessionKeys.list(q),
    queryFn: () => api.listSessions(q),
  });
}

/**
 * Fetch a single session.
 * On success we also update the active‑session cache, because the server marks
 * the session as active when it is fetched (unless it is closed).
 */
export function useSession(id: string) {
  const qc = useQueryClient();
  return useQuery<Session, unknown, Session, readonly unknown[]>({
    queryKey: sessionKeys.detail(id),
    queryFn: () => api.getSession(id),
    onSuccess: (data: Session) => {
      // The GET /sessions/:id endpoint sets the active session on the server.
      // Mirror that fact client‑side so the active‑session bar updates immediately.
      if (data.status !== 'closed') {
        qc.setQueryData(sessionKeys.active(), data);
      } else {
        qc.setQueryData(sessionKeys.active(), null);
      }
    },
  });
}

/**
 * Fetch the currently active session (or null). Used by the persistent bar.
 */
export function useActiveSession() {
  return useQuery<Session | null, unknown, Session | null, readonly unknown[]>({
    queryKey: sessionKeys.active(),
    queryFn: () => api.getActiveSession(),
  });
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
      // The close endpoint clears the active session on the server.
      // Invalidate the active‑session query so it refetches (returning null).
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
