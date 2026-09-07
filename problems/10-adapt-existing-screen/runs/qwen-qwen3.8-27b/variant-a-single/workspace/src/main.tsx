import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/auth';
import { ActiveSessionProvider } from './active-session/active-session-store';
import { routes } from './routes';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActiveSessionProvider>
          <RouterProvider router={router} />
        </ActiveSessionProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
