import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionsList } from './queries';
import type { Session } from '../../api/types';

export function SessionsListScreen() {
  const navigate = useNavigate();
  const { data } = useSessionsList();
  const queryClient = useQueryClient();

  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/sessions/${id}/close`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to close session');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', 'active'] });
    },
  });

  const handleOpen = (session: Session) => {
    navigate(`/sessions/${session.id}`);
  };

  const handleClose = (session: Session) => {
    if (confirm(`Close session "${session.name}"?`)) {
      closeMutation.mutate(session.id);
    }
  };

  if (!data) {
    return <div>Loading…</div>;
  }

  return (
    <div>
      <h1>Sessions</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Started</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((session) => (
            <tr key={session.id}>
              <td>{session.name}</td>
              <td>{session.status}</td>
              <td>{session.startedAt}</td>
              <td>
                <button onClick={() => handleOpen(session)}>Open</button>
                <button onClick={() => handleClose(session)}>Close</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
