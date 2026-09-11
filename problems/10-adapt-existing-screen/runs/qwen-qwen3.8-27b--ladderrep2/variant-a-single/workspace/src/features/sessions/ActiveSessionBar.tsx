import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(startedAt: string, now: Date): string {
  let total = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(total / 3600);
  total %= 3600;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`;
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. It lives in AppLayout so it appears on
 * every authenticated screen and nowhere else. The row comes from the server
 * (`GET /sessions/active` via useActiveSession), so a full page refresh
 * restores it and nothing client-only is trusted for this fact.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError, refetch } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useNow(Boolean(session));

  if (isLoading) {
    return (
      <div className="active-bar" data-state="pending" role="status">
        Loading active session…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="active-bar" data-state="error" role="alert">
        Could not load your active session.
        <Button onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }
  if (!session) return null;

  return (
    <section className="active-bar" aria-label="Active session">
      <span>Active session</span>
      <strong>{session.name}</strong>
      <Badge tone={session.status}>{session.status}</Badge>
      <time>{formatElapsed(session.startedAt, now)}</time>
      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
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
    </section>
  );
}
