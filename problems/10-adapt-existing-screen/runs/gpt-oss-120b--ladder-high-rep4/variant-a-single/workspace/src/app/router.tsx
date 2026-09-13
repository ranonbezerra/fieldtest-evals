import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SessionsListScreen from '../features/sessions/SessionsListScreen';
import SessionDetailScreen from '../features/sessions/SessionDetailScreen';
import LoginScreen from '../features/auth/LoginScreen';
import { useAuth } from '../features/auth/authContext';

export default function AppRouter() {
  const { user } = useAuth();

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sessions" element={<SessionsListScreen />} />
        <Route path="/sessions/:id" element={<SessionDetailScreen />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
