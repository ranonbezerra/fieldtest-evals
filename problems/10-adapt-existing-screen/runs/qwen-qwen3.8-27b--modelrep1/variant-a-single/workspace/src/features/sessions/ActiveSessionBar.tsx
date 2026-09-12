import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from './queries';

/**
 * The persistent active-session bar. Mounted in AppLayout, so it appears on
 * every authenticated screen. What it shows is whatever the server reports as
 * the operator's active session (GET /sessions/active) — that is the source of
 * truth, so a full page refresh restores the bar from the API, not from any
 * client-side memory. Opening a session (its detail fetch) is what makes the
 * server mark it active; closing it clears the pointer.
 */
export function ActiveSessionBar() {
  const { data: session } = useActiveSession();
  const closeSession = useCloseSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmClose, setConfirmClose] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The elapsed readout ticks once a second, only while a session is on the bar.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  if (!session) return null;

  const here = location.pathname === `/sessions/${session.id}`;
  const elapsed = formatElapsed(now - new Date(session.startedAt).getTime());

  return (
    <section aria-label="Active session" className="active-session">
      <strong>{session.name}</strong>
      <Badge tone={session.status}>{session.status}</Badge>
      <span className="active-session__elapsed">{elapsed}</span>

      <Button disabled={here} onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </Button>
      <Button
        variant="danger"
        disabled={closeSession.isPending}
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

/** "02:03:04", or "1d 02:03:04" once a day in. The bar's ticking readout. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
