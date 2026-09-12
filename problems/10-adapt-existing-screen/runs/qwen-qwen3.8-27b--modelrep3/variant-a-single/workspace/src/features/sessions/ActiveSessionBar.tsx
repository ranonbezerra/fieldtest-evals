import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar. AppLayout mounts it on every
 * authenticated screen. It renders only while the server reports an active
 * session — `GET /sessions/active` is the source of truth, so a page refresh
 * (or a fresh login) restores it without any client-side memory, and closing
 * the session empties the bar.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);

  // ASSUMPTION: the data model has no pause timestamps, so elapsed time is
  // measured from startedAt for open and paused sessions alike, and frozen at
  // closedAt once the session is closed.
  const running = active !== null && active !== undefined && active.closedAt === null;
  const now = useNow(running);

  if (!active) return null;

  const end = active.closedAt !== null ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <strong>{active.name}</strong>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="active-session-elapsed">{elapsed}</span>
      <div className="actions">
        <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
        <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmClose(true)}>
          Close session
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          closeSession.mutate(active.id);
        }}
      />
    </div>
  );
}

/** Re-renders the caller once per second while `running` is true. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
