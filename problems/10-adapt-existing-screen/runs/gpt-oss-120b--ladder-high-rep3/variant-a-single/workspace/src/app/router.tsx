import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SessionListScreen from '../features/sessions/SessionListScreen';
import SessionDetailScreen from '../features/sessions/SessionDetailScreen';
import { useAuth } from '../features/auth/authHooks';

export default function AppRouter() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sessions" element={<SessionListScreen />} />
        <Route path="/sessions/:id" element={<SessionDetailScreen />} />
        {/* other routes */}
      </Routes>
    </BrowserRouter>
  );
}
