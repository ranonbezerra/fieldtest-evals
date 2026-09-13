import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api } from '../../api/client';
import { useCloseSession, sessionKeys } from './queries';

/**
 * Persistent bar showing the currently active session (if any). It appears on
 * every authenticated screen, displays key fields, ticks elapsed time, and
 * offers resume / close actions.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError, refetch } = useQuery({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
  });

  const navigate = useNavigate();
  const closeSession = useCloseSession();

  const [confirmClose, setConfirmClose] = useState(false);
  const [elapsed, setElapsed] = useState<string>('');

  // Compute and tick elapsed time while the session is active.
  useEffect(() => {
    if (!session) {
      setElapsed('');
      return;
    }

    const start = new Date(session.startedAt);
    const update = () => {
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      const totalSec = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      setElapsed(
        `${hours.toString().padStart(2, '0')}:${minutes
          .toString()
          .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      );
    };
    update(); // initialise immediately
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (isLoading) return null;

  if (isError) {
    return (
      <div data-testid="active-session-bar-error" className="active-session-bar error">
        <p>Failed to load active session.</p>
        <Button onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }

  if (!session) return null;

  const handleClose = () => {
    closeSession.mutate(session.id);
    setConfirmClose(false);
  };

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsed}</span>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)} disabled={session.status === 'closed'}>
        Close session
      </Button>

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
