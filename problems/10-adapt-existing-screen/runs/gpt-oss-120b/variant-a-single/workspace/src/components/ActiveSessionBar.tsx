import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

export function ActiveSessionBar() {
  const { data: session, isLoading } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [elapsed, setElapsed] = useState('');

  // Update elapsed time every second while a session is active.
  useEffect(() => {
    if (!session) {
      setElapsed('');
      return;
    }
    const start = new Date(session.startedAt);
    const update = () => {
      const now = new Date();
      const diff = now.getTime() - start.getTime();
      const seconds = Math.floor(diff / 1000) % 60;
      const minutes = Math.floor(diff / (1000 * 60)) % 60;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      setElapsed(`${hours}h ${minutes}m ${seconds}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (isLoading || !session) return null;

  return (
    <div className="active-session-bar">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>{elapsed}</span>
      <Button onClick={() => navigate(`/sessions/${session.id}`)}>Resume</Button>
      <Button variant="danger" onClick={() => setConfirmOpen(true)}>
        Close session
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
