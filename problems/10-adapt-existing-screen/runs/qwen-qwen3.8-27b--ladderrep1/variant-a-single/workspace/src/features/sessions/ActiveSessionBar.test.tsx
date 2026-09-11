import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('shows the session opened from the list with its status and elapsed time', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/^\d+h \d{2}m \d{2}s$/)).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Resume' })).toHaveAttribute(
      'href',
      '/sessions/s-001',
    );
  });

  it('ticks the elapsed time while a session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        /\d+h \d{2}m \d{2}s/,
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    const before = bar.textContent;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bar.textContent).not.toBe(before);
  });

  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 2',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('link', { name: 'Resume' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Inspection 2' })).toBeInTheDocument(),
    );
  });

  it('restores the active session from the API on a fresh load, on any screen', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );
  });

  it('shows no bar when there is no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
  });

  it('shows a distinct error state when the active session cannot be loaded', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'internal_error' }, { status: 500 }),
      ),
    );
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() => expect(bar).toHaveTextContent('Could not load the active session.'));
    expect(within(bar).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('closes the active session from the bar behind a confirm and empties itself', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 4',
      ),
    );
    const bar = screen.getByRole('region', { name: 'Active session' });

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const second = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(second).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(sessions.find((s) => s.id === 's-004')?.status).toBe('closed');
  });

  it('asks before replacing the active session when its notes are unsaved', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions/s-001');

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 1',
      ),
    );

    await userEvent.type(await screen.findByLabelText('Notes'), ' (follow up)');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Inspection 7' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 7' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Active session' })).toHaveTextContent(
        'Inspection 7',
      ),
    );
  });

  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = null;
    renderApp('/login');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
