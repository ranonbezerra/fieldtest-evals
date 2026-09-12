import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Tooltip } from '../../components/ui/Tooltip';
import { useActiveSession, useCloseSession } from './queries';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [ticking]);
  return now;
}

/**
 * The persistent active-session bar, rendered by AppLayout so it appears on
 * every authenticated screen. `GET /sessions/active` is the source of truth,
 * so a full page refresh restores it; opening and closing a session keep the
 * cache in sync (see queries.ts).
 */
export function ActiveSessionBar() {
  const { data: session } = useActiveSession();
  const navigate = useNavigate();
  const location = useLocation();
  const closeSession = useCloseSession();
  // Which session the confirm dialog refers to, so a stale dialog can never
  // end up closing whatever session becomes active next.
  const [confirmCloseFor, setConfirmCloseFor] = useState<string | null>(null);
  const now = useNow(Boolean(session));

  if (!session) return null;

  const detailPath = `/sessions/${session.id}`;
  const alreadyHere = location.pathname === detailPath;
  // ASSUMPTION: the model records startedAt but no pause timestamps, so the
  // elapsed time is wall-clock since the start, counting paused stretches too.
  const elapsed = formatElapsed(now - Date.parse(session.startedAt));

  const resume = (
    <Button disabled={alreadyHere} onClick={() => navigate(detailPath)}>
      Resume
    </Button>
  );

  return (
    <div className="active-bar" role="region" aria-label="Active session">
      <span className="active-bar__name">{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-bar__elapsed">{elapsed}</span>

      {alreadyHere ? (
        resume
      ) : (
        <Tooltip label="You are already in this session.">{resume}</Tooltip>
      )}
      <Button variant="danger" disabled={closeSession.isPending} onClick={() => setConfirmCloseFor(session.id)}>
        Close session
      </Button>

      <ConfirmDialog
        open={confirmCloseFor === session.id}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmCloseFor(null)}
        onConfirm={() => {
          setConfirmCloseFor(null);
          closeSession.mutate(session.id);
        }}
      />
    </div>
  );
}
