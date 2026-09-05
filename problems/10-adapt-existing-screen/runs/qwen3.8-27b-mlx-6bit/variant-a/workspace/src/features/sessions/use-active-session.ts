import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';

export { ApiError };

export interface ActiveSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  startedAt: string;
}

export interface UseActiveSessionResult {
  active: ActiveSession | null;
  isFetching: boolean;
  setActive: (sessionId: string) => Promise<void>;
  closeActive: () => Promise<void>;
  isMutating: boolean;
}

const activeSessionKey = ['sessions', 'active'] as const;

export function useActiveSession(): UseActiveSessionResult {
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: activeSessionKey,
    queryFn: async (): Promise<ActiveSession | null> => {
      const session = await api.getActiveSession();
      return (session as ActiveSession) ?? null;
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      const res = await fetch(`/api/sessions/active`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new ApiError(res.status, body.code ?? 'unknown');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activeSessionKey });
    },
  });

  const closeActiveMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!data) return;
      await api.closeSession(data.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: activeSessionKey });
    },
  });

  return {
    active: data ?? null,
    isFetching,
    setActive: (sessionId: string) => setActiveMutation.mutateAsync(sessionId),
    closeActive: () => closeActiveMutation.mutateAsync(),
    isMutating: setActiveMutation.isPending || closeActiveMutation.isPending,
  };
}
