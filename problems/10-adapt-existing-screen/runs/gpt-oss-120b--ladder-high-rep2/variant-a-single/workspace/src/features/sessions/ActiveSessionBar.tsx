import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { sessionKeys } from './queries';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCloseSession } from './queries';

export function ActiveSessionBar() {
  const { data: active, isLoading, isError } = useQuery<api.AuthUser | null>({
    queryKey: sessionKeys.active(),
    queryFn: api.getActiveSession,
    staleTime: 0,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const closeSession = useCloseSession();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update the “now” timestamp every second to make the elapsed time tick.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  // Refetch the active session whenever the route changes (e.g. after opening another session).
  const location = useLocation();
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
  }, [location.pathname, queryClient]);

  if (isLoading) return <p>Loading active session…</p>;

  if (isError) {
    return (
      <div className="active-session-bar error" data-testid="active-session-bar">
        <p>Error loading active session</p>
      </div>
    );
  }

  if (!active) return null;

  const elapsed = (() => {
    const start = new Date(active.startedAt).getTime();
    const diff = Math.floor((now - start) / 1_000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  })();

  const handleResume = () => {
    navigate(`/sessions/${active.id}`);
  };

  const handleClose = () => {
    setConfirmOpen(true);
  };

  const handleConfirmClose = () => {
    setConfirmOpen(false);
    closeSession.mutate(active.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: sessionKeys.active(), exact: true });
      },
    });
  };

  const handleCancelClose = () => {
    setConfirmOpen(false);
  };

  return (
    <div className="active-session-bar" data-testid="active-session-bar">
      <span>{active.name}</span>
      <Badge tone={active.status}>{active.status}</Badge>
      <span data-testid="elapsed-time">{elapsed}</span>
      <Button variant="primary" onClick={handleResume}>
        Resume
      </Button>
      <Button variant="danger" onClick={handleClose} disabled={closeSession.isPending}>
        Close session
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this session?"
        body="Closing is final. Unsaved notes will be lost."
        confirmLabel="Close session"
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />
    </div>
  );
}
