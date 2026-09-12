import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useActiveSession, useCloseSession } from '../features/sessions/queries';

/** "1d 4h 05m 09s" — always shows seconds, so the bar visibly ticks. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3_600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`, `${pad(minutes)}m`, `${pad(seconds)}s`);
  return parts.join(' ');
}

/** The current time, refreshed every second while `enabled`. */
function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

/**
 * The persistent active-session bar. It lives in the authenticated shell, so
 * it shows on every screen. The session itself always comes from the server
 * (GET /sessions/active); the bar keeps no persistence of its own, which is
 * what makes it survive a full page reload.
 */
export function ActiveSessionBar() {
  const { data: active } = useActiveSession();
  const close = useCloseSession();
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const now = useTickingNow(Boolean(active && !active.closedAt));

  if (!active) return null;

  const end = active.closedAt ? new Date(active.closedAt).getTime() : now;
  const elapsed = formatElapsed(end - new Date(active.startedAt).getTime());

  return (
    <div role="region" aria-label="Active session" className="active-session-bar">
      <span className="active-session-bar__name">{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span role="timer" className="active-session-bar__elapsed">
        {elapsed}
      </span>
      <Button onClick={() => navigate(`/sessions/${active.id}`)}>Resume</Button>
      <Button
        variant="danger"
        disabled={active.status === 'closed' || close.isPending}
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
          close.mutate(active.id);
        }}
      />
    </div>
  );
}
