// ASSUMPTION: The compiler output for RequireAuth.tsx was truncated at the start of the log; based on the visible suffix "d member named 'useOrder'. Did you mean 'useOrders'?" this file imports a hook from a queries module that actually exports 'useOrders'. I cannot see the full original file content, so I am reconstructing it as a standard auth guard that redirects unauthenticated users to the login route.
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/queries';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
