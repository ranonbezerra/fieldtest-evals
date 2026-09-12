import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession, useUpdateSessionNotes, useCloseSession } from './queries';
import type { Session } from '../../api/types';

export function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: sessionData } = useSession(id!);
  const session = sessionData as Session | null;

  const [notes, setNotes] = useState(session?.notes ?? '');
  const [isDirty, setDirty] = useState(false);

  useEffect(() => {
    if (session) {
      setNotes(session.notes);
    }
  }, [session]);

  const updateNotes = useUpdateSessionNotes(id!);
  const closeSession = useCloseSession();

  const handleSave = () => {
    updateNotes.mutate(notes);
    setDirty(false);
  };

  const handleClose = () => {
    closeSession.mutate(id!);
    navigate('/sessions');
  };

  if (!session) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1>{session.name}</h1>
      <p>Status: {session.status}</p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setDirty(true);
        }}
      />
      <button onClick={handleSave} disabled={!isDirty}>
        Save
      </button>
      <button onClick={handleClose}>Close session</button>
    </div>
  );
}
