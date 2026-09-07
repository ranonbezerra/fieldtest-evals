# repair2-LoginScreen.tsx

## reasoning

```
Let me analyze the compiler errors to see which ones relate to `src/app/LoginScreen.tsx`.

Looking through all the error messages:

1. `d member named 'useOrder'. Did you mean 'useOrders'?` - This is truncated, likely from a file that imports `useOrder` but should
```

## reply

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../features/auth/queries';
import type { LoginPayload } from '../api/types';

export function LoginScreen() {
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: LoginPayload = { identifier, password };
    loginMutation.mutate(payload, {
      onSuccess: () => {
        navigate('/sessions');
      },
    });
  };

  return (
    <div className="login-screen">
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Identifier
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {loginMutation.isError && (
        <p role="alert">
          {loginMutation.error?.message ?? 'Login failed.'}
        </p>
      )}
    </div>
  );
}
```
