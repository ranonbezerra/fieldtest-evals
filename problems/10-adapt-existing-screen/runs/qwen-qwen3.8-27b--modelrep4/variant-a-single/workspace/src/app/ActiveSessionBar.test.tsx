import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../mocks/db';
import { renderApp } from '../test/render';

const getBar = () => screen.getByRole('region', { name: 'Active session' });
const queryBar = () => screen.queryByRole('region', { name: 'Active session' });

describe('ActiveSessionBar', () => {
  afterEach(() => {
    vi.useRealTimers();
    state.user = null;
    state.activeSessionId = null;
    sessions[0] = { ...sessions[0], status: 'open', closedAt: null };
  });

  it('shows the server active session on a fresh load, so it survives a reload', async () => {
    // A fresh renderApp is a new router and query client — the same starting
    // point as a full page reload. The bar must come back from
    // GET /sessions/active, not from any client-side persistence.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());

    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(getBar()).getByText('open')).toBeInTheDocument();
    expect(within(getBar()).getByRole('timer')).toBeInTheDocument();
  });

  it('makes a session active when opened, keeps it across screens, and replaces it', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 2')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());

    // The bar follows the operator to other screens.
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument();

    // Opening another session replaces the active one.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
  });

  it('does not make a closed session active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 3')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 3'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 3' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('asks about unsaved notes before the active session is replaced', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Notes'), 'x');

    // Leaving with a dirty draft is confirmed by the detail screen's existing
    // blocker; the replacement only happens after that confirmation.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();
    expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() => expect(within(getBar()).getByText('Inspection 2')).toBeInTheDocument());
  });

  it('confirms before closing from the bar and empties on success', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    await waitFor(() => expect(getBar()).toBeInTheDocument());

    // Asking, then cancelling, changes nothing.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(queryBar()).toBeInTheDocument();

    // Confirming goes through the existing close endpoint and empties the bar.
    await userEvent.click(within(getBar()).getByRole('button', { name: 'Close session' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Close this session?' })).getByRole('button', {
        name: 'Close session',
      }),
    );
    await waitFor(() => expect(queryBar()).not.toBeInTheDocument());

    // The close is real: the list now reports the session closed.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /Inspection 1/ })).toBeInTheDocument());
    expect(within(screen.getByRole('row', { name: /Inspection 1/ })).getByText('closed')).toBeInTheDocument();
  });

  it('deep links straight to a detail and marks it active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/sessions/s-004');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
    await waitFor(() => expect(within(getBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('clears the bar on logout', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/sessions');

    await waitFor(() => expect(within(getBar()).getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('ticks the elapsed time from the server startedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 3, 2, 9, 3, 3))); // 1d 1h 3m 3s after s-001 started
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';

    renderApp('/orders');

    await vi.waitFor(() => expect(within(getBar()).getByRole('timer')).toBeInTheDocument());
    expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 03s');

    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('1d 1h 03m 04s'));
  });

  it('stays hidden when the server has no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };

    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('ORD-2024-0001')).toBeInTheDocument());
    expect(queryBar()).not.toBeInTheDocument();
  });
});
