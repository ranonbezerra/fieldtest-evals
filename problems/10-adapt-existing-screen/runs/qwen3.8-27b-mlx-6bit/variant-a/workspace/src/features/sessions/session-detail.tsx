import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Session } from '../../api/types';
import { useActiveSession } from './use-active-session';
import { useDirty } from './dirty-context';

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { active, setActive, isMutating } = useActiveSession();
  const { isDirty, setDirty } = useDirty();

  const [notes, setNotes] = useState('');
  const activatedRef = useRef(false);

  const { data: session, isFetching } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.getSession(id!),
    enabled: !!id,
  });

  // Sync local notes from the loaded session
  useEffect(() => {
    if (session) {
      setNotes(session.notes ?? '');
    }
  }, [session]);

  // Activate this session on mount (covers list-click and deep-link uniformly)
  useEffect(() => {
    if (!id || activatedRef.current) return;

    if (active && active.id !== id && isDirty) {
      const ok = window.confirm('You have unsaved notes. Discard them?');
      if (!ok) {
        navigate(-1);
        return;
      }
      setDirty(false);
    }

    activatedRef.current = true;
    if (active?.id !== id) {
      void setActive(id);
    }
  }, [id, active, isDirty, navigate, setDirty, setActive]);

  // Warn on browser refresh/close when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleNotesChange = useCallback(
    (value: string) => {
      setNotes(value);
      setDirty(true);
    },
    [setDirty],
  );

  const saveMutation = useMutation({
    mutationFn: () => api.updateSession(id!, { notes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', id] });
      setDirty(false);
    },
  });

  if (isFetching) return <div>Loading…</div>;
  if (!session) return <div>Session not found.</div>;

  // Gate editable form until activation mutation completes (ordering rule)
  if (isMutating && active?.id !== id) {
    return <div>Switching session…</div>;
  }

  return (
    <div>
      <h1>{session.name}</h1>
      <p>Status: {session.status}</p>
      <label>
        Notes
        <textarea
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
        />
      </label>
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? 'Saving…' : 'Save notes'}
      </button>
      {saveMutation.isError && <p>Failed to save.</p>}
    </div>
  );
}
