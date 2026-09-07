import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { ACTIVE_SESSION_KEY, useActiveSession } from '../active-session/active-session-store';
import { errorMessage } from '../api/client';
import { getSession, saveSessionNotes } from '../api/sessions';
import type { Session } from '../api/types';

export function SessionDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { session: active, draft, setDraft, dirty } = useActiveSession();

  const { data: session, isPending, error } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => getSession(id),
    enabled: id.length > 0,
  });

  // The notes editor is backed by the shared draft only for the active
  // session, so its dirty flag is visible to the active-session rules.
  const isActive = session !== undefined && active !== null && active.id === session.id;

  // Route-change warning driven by the dirty flag (existing behaviour).
  const blocker = useBlocker(isActive && dirty);

  const saveMutation = useMutation({
    mutationFn: () => saveSessionNotes(id, draft),
    onSuccess: (updated) => {
      queryClient.setQueryData(['sessions', id], updated);
      queryClient.setQueryData(ACTIVE_SESSION_KEY, (old: Session | null) =>
        old !== null && old.id === updated.id ? updated : old,
      );
    },
  });

  if (error) {
    return <p role="alert">Could not load this session: {errorMessage(error)}</p>;
  }
  if (isPending || session === undefined) {
    return <p>Loading…</p>;
  }

  return (
    <div className="session-detail">
      <Link to="/sessions" className="session-detail__back">
        Back to sessions
      </Link>
      <h1>{session.name}</h1>
      <dl className="session-detail__meta">
        <div>
          <dt>Status</dt>
          <dd>{session.status}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{new Date(session.started_at).toLocaleString()}</dd>
        </div>
      </dl>

      {isActive ? (
        <section className="session-detail__notes">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            rows={6}
            value={draft}
            disabled={session.status === 'closed'}
            onChange={(e) => setDraft(e.target.value)}
          />
          {session.status === 'open' ? (
            <div className="session-detail__actions">
              <button
                type="button"
                disabled={saveMutation.isPending || !dirty}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save notes'}
              </button>
              {dirty ? (
                <span data-testid="dirty-flag" className="session-detail__dirty">
                  Unsaved changes
                </span>
              ) : null}
            </div>
          ) : (
            <p className="session-detail__hint">This session is closed; its notes are read-only.</p>
          )}
          {saveMutation.error !== null ? (
            <p role="alert" className="session-detail__error">
              {errorMessage(saveMutation.error)}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="session-detail__notes">
          <h2>Notes</h2>
          <p className="session-detail__hint">
            This is not your active session. Open it from the sessions list to work on it.
          </p>
          <pre className="session-detail__notes-readonly">{session.notes || '—'}</pre>
        </section>
      )}

      {blocker.state === 'blocked' ? (
        <div
          className="leave-dialog"
          role="alertdialog"
          aria-label="Unsaved notes"
          data-testid="leave-dialog"
        >
          <p>“{active?.name}” has notes that are not saved yet.</p>
          <p className="leave-dialog__hint">
            They stay available on this session until you save or close it.
          </p>
          <div>
            <button type="button" onClick={() => blocker.proceed?.()}>
              Leave
            </button>
            <button type="button" onClick={() => blocker.reset?.()}>
              Stay
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
