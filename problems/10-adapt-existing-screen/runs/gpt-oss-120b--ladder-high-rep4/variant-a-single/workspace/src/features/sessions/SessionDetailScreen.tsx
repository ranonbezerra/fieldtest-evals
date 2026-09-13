import { useParams, useNavigate } from 'react-router-dom';
import { useSession, useUpdateSessionNotes, useCloseSession } from './queries';

export default function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: session } = useSession(id as string);
  const updateNotes = useUpdateSessionNotes(id as string);
  const closeSession = useCloseSession();

  // Guard against the session still loading or being null.
  if (!session) {
    return <div>Loading…</div>;
  }

  const [notes, setNotes] = useState<string>(session.notes ?? '');
  const [dirty, setDirty] = useState<boolean>(false);

  useEffect(() => {
    setNotes(session.notes ?? '');
  }, [session.notes]);

  const handleSave = () => {
    updateNotes.mutate(notes);
    setDirty(false);
  };

  const handleClose = async () => {
    await closeSession.mutateAsync(session.id);
    navigate('/sessions');
  };

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
      <button onClick={handleSave} disabled={!dirty}>
        Save
      </button>
      <button onClick={handleClose}>Close Session</button>
    </div>
  );
}
