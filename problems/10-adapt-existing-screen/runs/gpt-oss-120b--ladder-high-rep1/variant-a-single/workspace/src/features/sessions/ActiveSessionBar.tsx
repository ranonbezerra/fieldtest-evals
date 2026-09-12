import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession, sessionKeys } from './queries';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Formats a millisecond difference as HH:MM:SS.
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}`;
}

/**
 * Returns a ticking string representing the elapsed time since `startedAt`.
 */
function useElapsed(startedAt: string): string {
  const [elapsed, setElapsed] = useState(() => formatElapsed(Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsed(Date.now() - new Date(startedAt).getTime()));
    }, 1_000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return elapsed;
}

/**
 * Persistent bar that shows the active session (if any) on every authenticated screen.
 * Handles loading / error states distinctly from “no active session”.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  if (isLoading) return <p>Loading active session…</p>;
  if (isError) return <p>Failed to load active session.</p>;
  if (!session) return null;

  const elapsed = useElapsed(session.startedAt);
  const isClosing = closeSession.isPending;

  const handleClose = () => {
    setConfirmClose(false);
    closeSession.mutate(session.id, {
      onSuccess: () => {
        // Refetch active‑session; the server will now return null.
        qc.invalidateQueries({ queryKey: sessionKeys.active() });
      },
    });
  };

  return (
    <div className="active-session-bar">
      <div className="active-session-info">
        <span>{session.name}</span>
        <Badge tone={session.status}>{session.status}</Badge>
        <span>{elapsed}</span>
      </div>
      <div className="active-session-actions">
        <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
          Resume
        </Button>
        <Button variant="danger" disabled={isClosing} onClick={() => setConfirmClose(true)}>
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={handleClose}
      />
    </div>
  );
}
