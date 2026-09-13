import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { OrderDetailScreen } from '../features/orders/OrderDetailScreen';
import { OrdersListScreen } from '../features/orders/OrdersListScreen';
import { SessionDetailScreen } from '../features/sessions/SessionDetailScreen';
import { SessionsListScreen } from '../features/sessions/SessionsListScreen';
import { AppLayout } from './AppLayout';
import { LoginScreen } from './LoginScreen';

/**
 * Every authenticated route sits under RequireAuth, inside AppLayout.
 * Deep links work because the guard waits for `me()` instead of assuming.
 */
export const routes = [
  { path: '/login', element: <LoginScreen /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <SessionsListScreen /> },
          { path: '/sessions', element: <SessionsListScreen /> },
          { path: '/sessions/:id', element: <SessionDetailScreen /> },
          { path: '/orders', element: <OrdersListScreen /> },
          { path: '/orders/:id', element: <OrderDetailScreen /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
