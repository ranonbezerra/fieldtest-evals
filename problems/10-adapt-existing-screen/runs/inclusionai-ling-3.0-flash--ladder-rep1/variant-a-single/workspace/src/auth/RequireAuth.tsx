import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';

/**
 * Route guard. It renders nothing while the session is being resolved, so a
 * deep link is not bounced to /login before `me()` has answered.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}
