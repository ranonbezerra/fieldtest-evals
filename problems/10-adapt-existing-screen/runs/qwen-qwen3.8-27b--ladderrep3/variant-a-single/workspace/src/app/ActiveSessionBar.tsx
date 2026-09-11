import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

/** Ticks once a second; drives the bar's elapsed-time display. */
function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatElapsed(startedAt: string, now: Date): string {
  const start = new Date(startedAt).getTime();
  const ms = Math.max(0, now.getTime() - start);
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * The operator's "what am I working on" thread. Visible on every authenticated
 * screen; the server is the source of truth (see `useActiveSession`).
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useNow();

  if (isLoading) return null;
  if (isError) {
    return (
      <div className="active-session-bar" role="status">
        <span className="active-session-bar__label">Active session</span>
        <span className="active-session-bar__error">Couldn't load active session.</span>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="active-session-bar" role="status">
        <span className="active-session-bar__label">Active session</span>
        <span className="active-session-bar__empty">No active session.</span>
      </div>
    );
  }

  const isClosed = session.status === 'closed';
  const closing = closeSession.isPending;

  return (
    <div className="active-session-bar" role="region" aria-label="Active session">
      <span className="active-session-bar__label">Active session</span>
      <span className="active-session-bar__name">{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-session-bar__elapsed">
        Elapsed {formatElapsed(session.startedAt, now)}
        {isClosed ? ' (closed)' : ''}
      </span>
      <Button
        variant="primary"
        onClick={() => navigate(`/sessions/${session.id}`)}
      >
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={isClosed || closing}
        onClick={() => setConfirmClose(true)}
      >
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
          closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
