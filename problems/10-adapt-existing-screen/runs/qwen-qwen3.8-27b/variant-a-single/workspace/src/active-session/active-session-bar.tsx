import { useNavigate } from 'react-router-dom';
import type { Session } from '../api/types';
import { useActiveSession } from './active-session-store';
import { useNow } from './use-now';

function formatElapsed(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${minutes}m ${pad(seconds)}s`;
}

/**
 * Persistent bar shown on every authenticated screen. Not rendered while no
 * session is active (i.e. "the bar empties").
 */
export function ActiveSessionBar() {
  const { session } = useActiveSession();
  if (session === null) {
    return null;
  }
  return <ActiveSessionBarContent session={session} />;
}

function ActiveSessionBarContent({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { close, closeError } = useActiveSession();
  // The clock ticks only while the session is open.
  const now = useNow(session.status === 'open' ? 1000 : null);
  const elapsedMs = now - Date.parse(session.started_at);

  return (
    <div className="active-session-bar" role="region" aria-label="Active session">
      <span className="active-session-bar__label">Active</span>
      <strong className="active-session-bar__name">{session.name}</strong>
      <span className="active-session-bar__status" data-status={session.status}>
        {session.status}
      </span>
      <span className="active-session-bar__elapsed">{formatElapsed(elapsedMs)}</span>
      <button type="button" onClick={() => navigate(`/sessions/${session.id}`)}>
        Resume
      </button>
      <button type="button" onClick={() => void close()}>
        Close session
      </button>
      {closeError !== null ? (
        <span className="active-session-bar__error" role="alert">
          {closeError}
        </span>
      ) : null}
    </div>
  );
}
