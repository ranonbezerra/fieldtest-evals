import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { sessionKeys, useCloseSession, useSession, useUpdateSessionNotes } from './queries';

export function SessionDetailScreen() {
  const { id = '' } = useParams();
  const { data: session, isLoading } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();
  const queryClient = useQueryClient();

  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (session) setNotes(session.notes);
  }, [session]);

  // Opening a session marks it active on the server (GET /sessions/:id). Pull
  // that fact back right away so the active-session bar reflects the open
  // instead of waiting for the next scheduled refetch.
  useEffect(() => {
    if (session) void queryClient.refetchQueries({ queryKey: sessionKeys.active() });
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
