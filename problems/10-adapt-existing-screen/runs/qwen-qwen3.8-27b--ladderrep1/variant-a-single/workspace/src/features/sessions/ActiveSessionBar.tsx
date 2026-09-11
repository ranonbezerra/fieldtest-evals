import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

const TICK_MS = 1000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${ss}` : `${m}m ${ss}`;
}

/**
 * A wall clock that advances once a second so the elapsed time ticks. The
 * interval only runs while a session is open; it stops with the bar.
 */
function useTickingNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  return now;
}

/**
 * The persistent bar for whichever session the server has marked active.
 * `GET /sessions/active` is the source of truth: nothing here is mirrored into
 * localStorage or any store that would outlive the query cache. A pending or
 * failed fetch is shown as itself, never as "no active session" — those are
 * different states, and the operator can tell them apart.
 */
export function ActiveSessionBar() {
  const { data: session, isPending, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const [confirmClose, setConfirmClose] = useState(false);

  const now = useTickingNow(session ? session.closedAt === null : false);

  if (isPending) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Checking the active session…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="active-bar" role="region" aria-label="Active session">
        Could not load the active session.
      </div>
    );
  }

  if (!session) return null;

  const end = session.closedAt !== null ? new Date(session.closedAt).getTime() : now;
  const elapsed = end - new Date(session.startedAt).getTime();

  return (
    <>
      <div className="active-bar" role="region" aria-label="Active session">
        <span className="active-bar__name">{session.name}</span>
        <Badge tone={session.status}>{session.status}</Badge>
        <span className="active-bar__elapsed">{formatElapsed(elapsed)}</span>

        <div className="active-bar__actions">
          <Link to={`/sessions/${session.id}`}>Resume</Link>
          <Button
            variant="danger"
            disabled={closeSession.isPending}
            onClick={() => setConfirmClose(true)}
          >
            Close session
          </Button>
        </div>
      </div>

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
    </>
  );
}
