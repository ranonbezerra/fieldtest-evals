import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { setActiveSessionDirty } from './activeSession';
import { useActiveSession, useCloseSession } from './queries';

function useElapsedTime(startedAt: string) {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  const diff = Math.floor((tick.getTime() - new Date(startedAt).getTime()) / 1000);
  const minutes = Math.floor(diff / 60);
  const seconds = String(diff % 60).padStart(2, '0');
  return `${minutes}m ${seconds}s`;
}

export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!session) {
      setActiveSessionDirty(false);
    }
  }, [session]);

  if (isError) {
    return (
      <div className="active-session-bar active-session-bar--error" role="alert">
        Could not load the active session.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="active-session-bar active-session-bar--loading">
        Loading active session…
      </div>
    );
  }

  if (!session) return null;

  const elapsed = useElapsedTime(session.startedAt);

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsed}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
        Close session
      </Button>
      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
