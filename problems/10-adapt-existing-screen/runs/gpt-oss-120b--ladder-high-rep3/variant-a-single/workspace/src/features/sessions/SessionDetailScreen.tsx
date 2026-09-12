import { useParams, useNavigate } from 'react-router-dom';
import { useSession, useUpdateSessionNotes, useCloseSession } from './queries';
import { useEffect, useState } from 'react';

export default function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Guard against missing id (should not happen for a valid route)
  if (!id) {
    return <div>Invalid session ID</div>;
  }

  const { data: session } = useSession(id);
  const updateNotes = useUpdateSessionNotes(id);
  const closeSession = useCloseSession();

  const [notes, setNotes] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);

  // Initialise notes when session loads
  useEffect(() => {
    if (session) {
      setNotes(session.notes ?? '');
      setIsDirty(false);
    }
  }, [session]);

  // Guard against null/undefined session
  if (!session) {
    return <div>Loading…</div>;
  }

  const handleSave = async () => {
    await updateNotes.mutateAsync(notes);
    setIsDirty(false);
  };

  const handleClose = async () => {
    if (window.confirm('Close this session?')) {
      await closeSession.mutateAsync(session.id);
      navigate('/sessions');
    }
  };

  return (
    <div>
      <h1>{session.name}</h1>
      <p>Status: {session.status}</p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setIsDirty(true);
        }}
      />
      <button onClick={handleSave} disabled={!isDirty}>
        Save Notes
      </button>
      <button onClick={handleClose}>Close Session</button>
    </div>
  );
}
