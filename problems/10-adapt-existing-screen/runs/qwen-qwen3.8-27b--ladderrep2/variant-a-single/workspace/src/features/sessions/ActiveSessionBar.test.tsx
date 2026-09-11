import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

describe('ActiveSessionBar', () => {
  it('shows the active session on every authenticated screen', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('restores the bar from the API after a deep link to a detail URL', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('ticks the elapsed time', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    const elapsed = within(bar).getByText(/\d+s$/);
    const before = elapsed.textContent;

    await waitFor(
      () => {
        expect(elapsed.textContent).not.toBe(before);
      },
      { timeout: 3000, interval: 100 },
    );
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('confirms before replacing an active session that has unsaved notes', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await screen.findByRole('heading', { name: 'Inspection 1' });

    await userEvent.type(screen.getByLabelText('Notes'), 'Deferred to tomorrow');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await screen.findByText(/Page 1 of 3/);

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('closes the active session behind a confirm and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    });

    const row = screen.getByRole('row', { name: /Inspection 4/ });
    expect(within(row).getByText('closed')).toBeInTheDocument();
  });

  it('clears the bar on logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('does not render the bar on the login screen', async () => {
    state.user = null;
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a pending state, not "no active session", while the fetch is in flight', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    server.use(http.get('/api/sessions/active', () => new Promise<HttpResponse<any>>(() => {})));
    renderApp('/sessions');

    await screen.findByText(/loading active session/i);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it('shows a distinct error state and recovers on retry', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText(/could not load your active session/i);
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();

    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });
});
