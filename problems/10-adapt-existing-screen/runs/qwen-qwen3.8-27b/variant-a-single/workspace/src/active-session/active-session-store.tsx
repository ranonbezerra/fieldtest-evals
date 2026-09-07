import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../api/client';
import { activateSession, closeSession, getActiveSession } from '../api/sessions';
import type { Session } from '../api/types';
import { useAuth } from '../auth/auth';

// Kept off the ['sessions', ...] prefix on purpose so that list and detail
// invalidations never touch the active-session cache.
export const ACTIVE_SESSION_KEY = ['active-session'] as const;

interface ActiveSessionContextValue {
  /** The active session as reported by the API, or null when none is active. */
  session: Session | null;
  /** The notes draft for the active session. Client state only. */
  draft: string;
  /** True when the draft differs from the server-side notes. */
  dirty: boolean;
  closeError: string | null;
  activateError: string | null;
  /**
   * Make `id` the active session. Only one session is active at a time;
   * opening another replaces the current one, with a confirm when the
   * current session has unsaved notes. Resolves to false when the operator
   * cancels or the request fails.
   */
  activate: (id: string) => Promise<boolean>;
  /** Close the active session through the API after a confirm. */
  close: () => Promise<void>;
  setDraft: (notes: string) => void;
}

const ActiveSessionContext = createContext<ActiveSessionContextValue | null>(null);

export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  // Source of truth: the API. After a full page refresh we ask the server
  // again instead of trusting anything persisted on the client.
  const { data } = useQuery({
    queryKey: ACTIVE_SESSION_KEY,
    queryFn: getActiveSession,
    enabled: Boolean(token),
  });
  const session = data ?? null;

  // The only client-side state: the notes draft for the active session.
  const [draft, setDraftState] = useState('');
  const [activateError, setActivateError] = useState<string | null>(null);

  const activeId = session?.id;
  useEffect(() => {
    // Reset the draft only when the identity of the active session changes,
    // so that refetches (same id) never clobber an in-flight draft.
    setDraftState(session?.notes ?? '');
  }, [activeId]);

  // Logout must leave no client state behind.
  useEffect(() => {
    if (!token) {
      setDraftState('');
    }
  }, [token]);

  const dirty = session !== null && draft !== session.notes;

  const setDraft = useCallback((notes: string) => {
    setDraftState(notes);
  }, []);

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateSession(id),
    onSuccess: (activated) => {
      queryClient.setQueryData(ACTIVE_SESSION_KEY, activated);
    },
    onError: (err) => {
      setActivateError(errorMessage(err));
    },
  });

  const activate = useCallback(
    async (id: string): Promise<boolean> => {
      if (session?.id === id) {
        return true; // already active: nothing to do
      }
      if (session !== null && dirty) {
        const confirmed = window.confirm(
          `Replace the active session "${session.name}"? Its unsaved notes will be discarded.`,
        );
        if (!confirmed) {
          return false;
        }
      }
      setActivateError(null);
      try {
        await activateMutation.mutateAsync(id);
        return true;
      } catch {
        return false; // surfaced through activateError
      }
    },
    [session, dirty, activateMutation],
  );

  const closeMutation = useMutation({
    mutationFn: () => {
      if (session === null) {
        throw new Error('No active session to close');
      }
      return closeSession(session.id);
    },
    onSuccess: () => {
      // The bar empties once the server confirms the close; the other
      // session caches pick up the new status on their next fetch.
      queryClient.setQueryData(ACTIVE_SESSION_KEY, null);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const closeError = closeMutation.error !== null ? errorMessage(closeMutation.error) : null;

  const close = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const message = dirty
      ? `Close session "${session.name}"? Its unsaved notes will be discarded.`
      : `Close session "${session.name}"?`;
    if (!window.confirm(message)) {
      return;
    }
    try {
      await closeMutation.mutateAsync();
    } catch {
      // The error is surfaced as closeError; the session stays active and
      // the draft is kept so the operator can retry.
    }
  }, [session, dirty, closeMutation]);

  const value = useMemo<ActiveSessionContextValue>(
    () => ({
      session,
      draft,
      dirty,
      closeError,
      activateError,
      activate,
      close,
      setDraft,
    }),
    [session, draft, dirty, closeError, activateError, activate, close, setDraft],
  );

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

export function useActiveSession(): ActiveSessionContextValue {
  const ctx = useContext(ActiveSessionContext);
  if (ctx === null) {
    throw new Error('useActiveSession must be used inside <ActiveSessionProvider>');
  }
  return ctx;
}
