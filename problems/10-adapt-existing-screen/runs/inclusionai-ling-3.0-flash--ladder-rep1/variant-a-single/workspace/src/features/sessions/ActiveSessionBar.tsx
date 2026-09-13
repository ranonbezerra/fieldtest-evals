import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession } from './queries';
import { useCloseSession } from './queries';

/**
 * Persistent active-session bar shown on every authenticated screen.
 * Reads from GET /sessions/active — the server is the source of truth.
 * Displays nothing when no session is active; a failed fetch is surfaced as
 * its own state so the operator never mistakes it for "no session."
 */
function elapsedLabel(startedAt: string, now: number): string {
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Loading active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="active-session-bar" className="active-session-bar">
        Could not load the active session.
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div data-testid="active-session-bar" className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsedLabel(session.startedAt, now)}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" onClick={() => setConfirmClose(true)}>
        Close session
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          void closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
