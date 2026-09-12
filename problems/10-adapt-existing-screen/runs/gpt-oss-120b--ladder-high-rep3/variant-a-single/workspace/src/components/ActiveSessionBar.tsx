import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useActiveSession, useCloseSession, sessionKeys } from '../features/sessions/queries';
import { useQueryClient } from '@tanstack/react-query';

export function ActiveSessionBar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: session, isLoading, isError } = useActiveSession();
  const closeSession = useCloseSession();

  const [confirmClose, setConfirmClose] = useState(false);
  const [elapsed, setElapsed] = useState('');

  const computeElapsed = useCallback(() => {
    if (!session) {
      setElapsed('');
      return;
    }
    const start = new Date(session.startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    setElapsed(formatted);
  }, [session]);

  useEffect(() => {
    computeElapsed();
    const interval = setInterval(computeElapsed, 1000);
    return () => clearInterval(interval);
  }, [computeElapsed]);

  if (isLoading) return null;
  if (isError) {
    return (
      <div className="active-session-bar error">
        <span>Error loading active session</span>
      </div>
    );
  }

  if (!session) return null;

  const handleResume = () => {
    navigate(`/sessions/${session.id}`);
  };

  const handleClose = () => {
    setConfirmClose(true);
  };

  const handleConfirmClose = () => {
    setConfirmClose(false);
    closeSession.mutate(session.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: sessionKeys.active() });
      },
    });
  };

  return (
    <div className="active-session-bar">
      <Badge tone={session.status}>{session.status}</Badge>{' '}
      <span>{session.name}</span>{' '}
      <span>{elapsed}</span>{' '}
      <Button variant="primary" onClick={handleResume}>
        Resume
      </Button>{' '}
      <Button variant="danger" onClick={handleClose}>
        Close session
      </Button>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={handleConfirmClose}
      />
    </div>
  );
}
