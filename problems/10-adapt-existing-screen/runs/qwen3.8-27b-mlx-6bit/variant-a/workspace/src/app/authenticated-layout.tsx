import { Outlet } from 'react-router-dom';
import { ActiveSessionBar } from '../features/sessions/active-session-bar';
import { DirtyProvider } from '../features/sessions/dirty-context';

export function AuthenticatedLayout(): React.ReactElement {
  return (
    <DirtyProvider>
      <ActiveSessionBar />
      <Outlet />
    </DirtyProvider>
  );
}
