import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp, renderWithProviders } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function activeBar() {
  return screen.getByRole('region', { name: 'Active session' });
}

describe('ActiveSessionBar', () => {
  it('shows the active session on another screen, and resume goes to its detail', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });
  });

  it('ticks the elapsed time on its own', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderWithProviders(<ActiveSessionBar />);

    const readElapsed = () => screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
    const before = await waitFor(() => {
      const text = readElapsed();
      expect(text).not.toBe('');
      return text;
    });

    await new Promise((r) => setTimeout(r, 2_200));
    expect(readElapsed()).not.toBe(before);
  });

  it('closes the active session behind a confirm and empties the bar on success', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    const row = sessions.find((s) => s.id === 's-004')!;
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    // Cancel first: nothing changes.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(activeBar()).toBeInTheDocument();

    // Confirm: the endpoint is called and the bar empties.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(row.status).toBe('closed');
    expect(row.closedAt).not.toBeNull();

    row.status = 'open';
    row.closedAt = null;
  });

  it('confirms before a session with unsaved notes is replaced by another', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await screen.findByRole('region', { name: 'Active session' });

    // Dirty it: the detail screen's own flag, no second source of truth.
    await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');

    // Leaving the detail is the only way to open another session: the dirty
    // flag must gate it.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await screen.findByText('Leave with unsaved notes?');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    // Leaving did not end the session: it is still the active one.
    expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();

    // Opening another session replaces it (no second confirm: the notes were
    // consciously discarded above).
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('replaces the active session without a confirm when nothing is unsaved', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('brings the bar back from GET /sessions/active after a full reload', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    const beforeReload = renderApp('/sessions');

    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
    await screen.findByRole('region', { name: 'Active session' });
    beforeReload.unmount();

    // A fresh client: a new query cache, the same server. The bar must come
    // back from the API, not from anything the first client kept.
    renderApp('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('makes a deep-linked detail session active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('shows a pending state while the active session is still loading', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
    renderApp('/sessions');

    await screen.findByText('Loading active session…');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a failed fetch as an error, not as "no active session"', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText('Couldn\'t load the active session.');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('is absent on the login screen', async () => {
    state.user = null;
    renderApp('/login');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
  });

  it('is cleared by logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
