import { Navigate, type RouteObject } from 'react-router-dom';
import { ProtectedLayout } from './app-layout';
import { LoginPage } from './pages/login-page';
import { SessionDetailPage } from './pages/session-detail-page';
import { SessionListPage } from './pages/session-list-page';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="/sessions" replace /> },
      { path: 'sessions', element: <SessionListPage /> },
      { path: 'sessions/:id', element: <SessionDetailPage /> },
    ],
  },
];
