import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY } from '../src/auth/auth';
import { makeSession, renderApp } from './harness';

describe('authentication', () => {
  it('logout clears the credential, the query cache and the active session state', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    await screen.findByRole('region', { name: /active session/i });
    expect(view.queryClient.getQueryData(['active-session'])).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Log in' });
    expect(view.router.state.location.pathname).toBe('/login');
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(view.queryClient.getQueryData(['active-session'])).toBeUndefined();
    expect(screen.queryByRole('region', { name: /active session/i })).toBeNull();
  });

  it('shows an error and stays on the login screen when the credentials are rejected', async () => {
    const view = renderApp({ authenticated: false, initialEntries: ['/login'] });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'op@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(view.router.state.location.pathname).toBe('/login');
  });

  it('a fresh login restores the active session from the API', async () => {
    const view = renderApp({
      authenticated: false,
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
      initialEntries: ['/login'],
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'op@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/sessions'));
    const bar = await screen.findByRole('region', { name: /active session/i });
    expect(within(bar).getByText('Furnace 7')).toBeTruthy();
  });
});
