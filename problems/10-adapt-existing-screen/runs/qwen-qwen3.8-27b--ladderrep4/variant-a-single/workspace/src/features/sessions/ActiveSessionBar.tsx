import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar, rendered by AppLayout so it is on every
 * authenticated screen and nowhere else.
 *
 * The server is the source of truth (`GET /sessions/active`): a full page
 * refresh brings the bar back from the API, and logout — which clears the
 * query cache and the server's active session — empties it. Nothing is
 * mirrored into client storage, where it would go stale in exactly the
 * situation this bar exists to handle.
 *
 * Pending and error are rendered as their own states: a failed fetch is not
 * "no active session", and the operator should be able to tell them apart.
 */
export function ActiveSessionBar() {
  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(session));

  if (isLoading) return <p className="active-session-bar">Loading active session…</p>;
  if (isError) return <p className="active-session-bar">Couldn't load the active session.</p>;
  if (!session) return null;

  return (
    <section className="active-session-bar" aria-label="Active session">
      <span>{session.name}</span>
      <Badge tone={session.status}>{session.status}</Badge>
      <span>Active for {formatElapsedSince(session.startedAt, now)}</span>

      <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={session.status === 'closed' || closeSession.isPending}
        onClick={() => setConfirmClose(true)}
      >
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

/** Ticks once a second so the elapsed time advances without any interaction. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/** Human-readable elapsed time since `startedAt`, in whole seconds. */
function formatElapsedSince(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}
