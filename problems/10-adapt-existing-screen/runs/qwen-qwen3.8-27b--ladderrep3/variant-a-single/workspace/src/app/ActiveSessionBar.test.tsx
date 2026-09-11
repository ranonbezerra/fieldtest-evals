import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { state } from '../mocks/db';
import { server } from '../mocks/server';
import { renderApp } from '../test/render';

function renderAuthed(path = '/sessions', name = 'Ada') {
  state.user = { id: 'u-1', name, roles: ['operator'] };
  return renderApp(path);
}

describe('ActiveSessionBar', () => {
  it('shows the active session key fields on a detail screen and ticks', async () => {
    vi.useFakeTimers();
    try {
      state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
      state.activeSessionId = 's-004';
      renderApp('/sessions/s-004');

      const bar = await screen.findByRole('region', { name: 'Active session' });
      expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
      expect(within(bar).getByText('open')).toBeInTheDocument();
      const first = within(bar).getByText(/^Elapsed \d{2}:\d{2}:\d{2}$/);
      vi.advanceTimersByTime(3000);
      await waitFor(() =>
        expect(within(bar).getByText(/^Elapsed \d{2}:\d{2}:\d{2}$/)).not.toEqual(first),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('is visible on the list screen', async () => {
    state.activeSessionId = 's-004';
    renderAuthed('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('is visible on the orders screen', async () => {
    state.activeSessionId = 's-004';
    renderAuthed('/orders');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('resume navigates to the session detail', async () => {
    state.activeSessionId = 's-004';
    renderAuthed('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 4' });
  });

  it('close session calls the close endpoint behind a confirm and empties the bar', async () => {
    state.activeSessionId = 's-004';
    renderAuthed('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    expect(dialog).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));
    await waitFor(() =>
      expect(screen.getByText('No active session.')).toBeInTheDocument(),
    );
  });

  it('a failed active-session fetch does not render as "no active session"', async () => {
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'boom' }, { status: 500 }),
      ),
    );
    renderAuthed('/sessions');
    await screen.findByText(/Couldn't load active session/);
    expect(screen.queryByText('No active session.')).not.toBeInTheDocument();
  });

  it('is not visible on the login screen', async () => {
    renderApp('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText('No active session.')).not.toBeInTheDocument();
  });

  it('comes back from the server after a full page refresh', async () => {
    state.activeSessionId = 's-004';
    renderAuthed('/sessions/s-004');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('opening a session from the list makes it the active session', async () => {
    renderAuthed('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('No active session.')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Inspection 4'));
    await screen.findByRole('heading', { name: 'Inspection 4' });
    await waitFor(() =>
      expect(within(bar).getByText('Inspection 4')).toBeInTheDocument(),
    );
  });

  it('deep-linking to a detail does not make the session active', async () => {
    renderAuthed('/sessions/s-004');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('No active session.')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Inspection 4' });
  });

  it('opening another session while the current one has unsaved notes confirms first', async () => {
    renderAuthed('/sessions/s-001');
    await screen.findByRole('heading', { name: 'Inspection 1' });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Notes'), 'more notes');

    await screen.findByRole('region', { name: 'Active session' });
    await user.click(screen.getByText('Inspection 5'));

    const dialog = await screen.findByRole('dialog', {
      name: 'Leave with unsaved notes?',
    });
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Inspection 5' });

    const bar = screen.getByRole('region', { name: 'Active session' });
    await waitFor(() =>
      expect(within(bar).getByText('Inspection 5')).toBeInTheDocument(),
    );
  });
});
