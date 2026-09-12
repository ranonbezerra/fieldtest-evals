import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { sessionKeys, useCloseSession } from '../features/sessions/queries';
import type { Session } from '../api/types';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Persistent bar that shows the currently‑active session (if any).
 * - Fetches the source‑of‑truth via GET /sessions/active.
 * - Displays name, status badge, ticking elapsed time.
 * - Offers “Resume” (navigate to detail) and “Close session” (confirm → API).
 * - Handles loading and error states distinctly from “no active session”.
 */
export function ActiveSessionBar() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const {
    data: session,
    isLoading,
    isError,
    error,
  } = useQuery<Session | null>({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
    // Keep previous data while refetching to avoid flicker.
    keepPreviousData: true,
  });

  const closeMutation = useCloseSession();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [elapsed, setElapsed] = useState('');

  // Tick elapsed time while a session is active.
  useEffect(() => {
    if (!session) {
      setElapsed('');
      return;
    }
    const start = new Date(session.startedAt).getTime();

    const update = () => {
      const now = Date.now();
      setElapsed(formatDuration(now - start));
    };
    update(); // initialise immediately
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (isLoading) {
    return <p className="active-session-loading">Loading active session…</p>;
  }

  if (isError) {
    // Show error distinct from “no active session”.
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div className="active-session-error" role="alert">
        <span>Failed to load active session.</span>
        <pre>{msg}</pre>
      </div>
    );
  }

  if (!session) {
    // No active session – render nothing.
    return null;
  }

  const handleResume = () => {
    navigate(`/sessions/${session.id}`);
  };

  const handleClose = () => {
    setConfirmOpen(true);
  };

  const confirmClose = () => {
    setConfirmOpen(false);
    closeMutation.mutate(session.id, {
      onSuccess: () => {
        // Invalidate the active‑session query so it resolves to null.
        qc.setQueryData(sessionKeys.active(), null);
      },
    });
  };

  return (
    <section className="active-session-bar" aria-label="Active session">
      <div className="active-session-info">
        <strong>{session.name}</strong>{' '}
        <Badge tone={session.status}>{session.status}</Badge>{' '}
        <span className="elapsed-time">{elapsed}</span>
      </div>
      <div className="active-session-actions">
        <Button variant="primary" onClick={handleResume}>
          Resume
        </Button>
        <Button variant="danger" onClick={handleClose}>
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmClose}
      />
    </section>
  );
}
