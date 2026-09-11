import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/auth-context';

export function LoginScreen() {
  const { user, login } = useAuth();
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };

  if (user) return <Navigate to="/sessions" replace />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void login(name).then(() => navigate(location.state?.from?.pathname ?? '/sessions', { replace: true }));
      }}
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <Button variant="primary" type="submit">
        Sign in
      </Button>
    </form>
  );
}
