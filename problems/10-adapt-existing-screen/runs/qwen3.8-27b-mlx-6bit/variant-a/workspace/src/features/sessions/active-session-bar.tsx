import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveSession } from './use-active-session';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ActiveSessionBar(): React.ReactElement | null {
  const { active, closeActive, isMutating } = useActiveSession();
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const update = (): void => {
      setElapsed(Date.now() - new Date(active.startedAt).getTime());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [active?.id, active?.startedAt]);

  const handleResume = useCallback((): void => {
    if (active) navigate(`/sessions/${active.id}`);
  }, [active, navigate]);

  const handleClose = useCallback((): void => {
    if (!active) return;
    if (window.confirm('Close this session?')) {
      void closeActive();
    }
  }, [active, closeActive]);

  if (!active) return null;

  return (
    <div data-testid="active-session-bar" role="banner" aria-label="Active session">
      <span data-testid="active-session-name">{active.name}</span>
      <span
        data-testid="active-session-status"
        className={`status-badge status-${active.status}`}
      >
        {active.status}
      </span>
      <span data-testid="active-session-elapsed">{formatElapsed(elapsed)}</span>
      <button type="button" onClick={handleResume} disabled={isMutating}>
        Resume
      </button>
      <button type="button" onClick={handleClose} disabled={isMutating}>
        Close session
      </button>
    </div>
  );
}
