import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { ActiveSessionBar } from './active-session/active-session-bar';
import { useAuth } from './auth/auth';

/**
 * Shell for every authenticated screen: header navigation, the persistent
 * active session bar and the routed content.
 */
export function ProtectedLayout() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();

  if (token === null) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">Ops Back-Office</span>
        <nav aria-label="Main">
          <Link to="/sessions">Sessions</Link>
        </nav>
        <span className="app__user">{user?.name ?? ''}</span>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          Log out
        </button>
      </header>
      <ActiveSessionBar />
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
