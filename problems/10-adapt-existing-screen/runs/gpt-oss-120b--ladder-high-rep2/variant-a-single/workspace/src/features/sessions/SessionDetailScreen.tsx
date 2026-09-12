import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession, useSession, useUpdateSessionNotes } from './queries';
import { useQueryClient } from '@tanstack/react-query';
import { sessionKeys } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Invalidate the active‑session query when a session is loaded.
  // This forces the bar to refetch the current active session.
  useEffect(() => {
    if (session) {
      queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
    }
  }, [session, queryClient]);

  // The dirty flag. Every screen that edits uses this shape: local draft vs the
  // cached server value, and a router blocker rather than a beforeunload hack.
  const dirty = session !== undefined && notes !== session.notes;

  const blocker = useBlocker(dirty);

  if (isLoading) return <p>Loading…</p>;
  if (!session) return <p>Session not found.</p>;

  return (
    <section>
      <h1>{session.name}</h1>
      <Badge tone={session.status}>{session.status}</Badge>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="actions">
        <Button
          variant="primary"
          disabled={!dirty || updateNotes.isPending}
          onClick={() => updateNotes.mutate(notes)}
        >
          Save notes
        </Button>
        <Button
          variant="danger"
          disabled={session.status === 'closed'}
          onClick={() => setConfirmClose(true)}
        >
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
          closeSession.mutate(session.id);
        }}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave with unsaved notes?"
        body="Your changes to the notes have not been saved."
        confirmLabel="Leave"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </section>
  );
}
