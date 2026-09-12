import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';

const BAR = { name: 'Active session' };

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
  });

  it('shows nothing when there is no active session', async () => {
    renderApp('/sessions');

    await screen.findByText('Inspection 1');
    expect(screen.queryByRole('region', BAR)).not.toBeInTheDocument();
  });

  it('restores the active session from the API, so a page refresh does not lose it', async () => {
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', BAR);
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/\d+s$/)).toBeInTheDocument();
  });

  it('ticks the elapsed time', async () => {
    sessions[1].startedAt = new Date(Date.now() - 65_000).toISOString();
    state.activeSessionId = 's-002';
    renderApp('/orders');

    const bar = await screen.findByRole('region', BAR);
    const elapsed = within(bar).getByText(/\d+s$/);
    const initial = elapsed.textContent;

    await waitFor(() => expect(elapsed.textContent).not.toBe(initial), { timeout: 5_000 });
  });

  it('is visible on every screen, and Resume navigates to the detail', async () => {
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', BAR);
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });

    // On the detail itself, resume is a no-op, so it is disabled there.
    expect(within(screen.getByRole('region', BAR)).getByRole('button', { name: 'Resume' })).toBeDisabled();
  });

  it('replaces the active session when another one is opened from the list', async () => {
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', BAR);
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));

    await waitFor(() => {
      const current = screen.getByRole('region', BAR);
      expect(within(current).getByText('Inspection 2')).toBeInTheDocument();
      expect(within(current).queryByText('Inspection 1')).not.toBeInTheDocument();
    });
  });

  it('keeps the unsaved-notes warning when switching away from a dirty detail', async () => {
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await userEvent.type(screen.getByLabelText('Notes'), 'x');

    // Leaving with unsaved notes still asks first, and cancel stays put.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Leave with unsaved notes?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

    // Leaving for real, then opening another session, replaces the active one.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() => {
      const current = screen.getByRole('region', BAR);
      expect(within(current).getByText('Inspection 2')).toBeInTheDocument();
    });
  });

  it('close from the bar confirms, empties the bar, and patches the list', async () => {
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', BAR);
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const confirm = await screen.findByRole('dialog', { name: 'Close this session?' });
    // Still there until the confirm is actually accepted.
    expect(within(screen.getByRole('region', BAR)).getByText('Inspection 4')).toBeInTheDocument();

    await userEvent.click(within(confirm).getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(screen.queryByRole('region', BAR)).not.toBeInTheDocument());
    expect(within(screen.getByRole('row', { name: /Inspection 4/ })).getByText('closed')).toBeInTheDocument();
  });

  it('logout clears the bar', async () => {
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const bar = await screen.findByRole('region', BAR);
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.queryByRole('region', BAR)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a deep link to a detail makes that session the active one', async () => {
    renderApp('/sessions/s-005');

    const bar = await screen.findByRole('region', BAR);
    expect(within(bar).getByText('Inspection 5')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Resume' })).toBeDisabled();
  });
});
