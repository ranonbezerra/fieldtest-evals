import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeSession, renderApp } from './harness';

describe('active session rules', () => {
  it('makes a session active when it is opened from the list', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's2', name: 'Boiler 2' })],
      activeId: null,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Boiler 2' }));
    const bar = await screen.findByRole('region', { name: /active session/i });
    expect(within(bar).getByText('Boiler 2')).toBeTruthy();
    expect(view.fake.state.activeId).toBe('s2');
    expect(view.router.state.location.pathname).toBe('/sessions/s2');
  });

  it('replaces the active session without confirmation when there are no unsaved notes', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' }), makeSession({ id: 's2', name: 'Boiler 2' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    await screen.findByRole('region', { name: /active session/i });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Boiler 2' }));
    expect(await screen.findByRole('heading', { name: 'Boiler 2' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(view.fake.state.activeId).toBe('s2');
    expect(view.router.state.location.pathname).toBe('/sessions/s2');
  });

  it('confirms before replacing an active session that has unsaved notes', async () => {
    const view = renderApp({
      sessions: [
        makeSession({ id: 's1', name: 'Furnace 7', notes: 'initial' }),
        makeSession({ id: 's2', name: 'Boiler 2' }),
      ],
      activeId: 's1',
      initialEntries: ['/sessions/s1'],
    });
    const user = userEvent.setup();
    const notes = await screen.findByLabelText('Notes');
    await user.type(notes, 'more');
    expect(screen.getByTestId('dirty-flag')).toBeTruthy();

    // Leave the detail screen first; the route-change warning appears and
    // "Leave" keeps the draft.
    await user.click(screen.getByRole('link', { name: 'Back to sessions' }));
    const dialog = await screen.findByTestId('leave-dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect(view.router.state.location.pathname).toBe('/sessions');

    // Declining the replace confirm keeps the current session and the draft.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Boiler 2' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Furnace 7'));
    expect(view.fake.state.activeId).toBe('s1');
    expect(view.router.state.location.pathname).toBe('/sessions');
    const bar = await screen.findByRole('region', { name: /active session/i });
    expect(within(bar).getByText('Furnace 7')).toBeTruthy();

    // Accepting replaces the session and discards the old draft.
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Boiler 2' }));
    expect(await screen.findByLabelText('Notes')).toHaveValue('');
    expect(view.fake.state.activeId).toBe('s2');
    expect(view.router.state.location.pathname).toBe('/sessions/s2');
    const barOnDetail = await screen.findByRole('region', { name: /active session/i });
    expect(within(barOnDetail).getByText('Boiler 2')).toBeTruthy();
  });

  it('does not re-activate a session that is already active', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' }), makeSession({ id: 's2', name: 'Boiler 2' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    await screen.findByRole('region', { name: /active session/i });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Furnace 7' }));
    expect(await screen.findByRole('heading', { name: 'Furnace 7' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(view.fake.requests.filter((r) => r.url === '/sessions/s1/activate')).toHaveLength(0);
    expect(view.router.state.location.pathname).toBe('/sessions/s1');
  });

  it('shows an error on the list when activation fails', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' }), makeSession({ id: 's2', name: 'Boiler 2' })],
      activeId: null,
    });
    const user = userEvent.setup();
    view.fake.failNext(
      (method, url) => method === 'POST' && url === '/sessions/s2/activate',
      409,
      'activation_conflict',
    );
    await user.click(await screen.findByRole('button', { name: 'Boiler 2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/activation_conflict/);
    expect(view.router.state.location.pathname).toBe('/sessions');
    expect(view.fake.state.activeId).toBeNull();
  });

  it('deep-linking to a detail URL does not change the active session', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' }), makeSession({ id: 's2', name: 'Boiler 2' })],
      activeId: 's1',
      initialEntries: ['/sessions/s2'],
    });
    expect(await screen.findByRole('heading', { name: 'Boiler 2' })).toBeTruthy();
    expect(view.fake.state.activeId).toBe('s1');
    expect(view.fake.requests.filter((r) => r.url === '/sessions/s2/activate')).toHaveLength(0);
    expect(screen.getByText(/not your active session/i)).toBeTruthy();
    const bar = await screen.findByRole('region', { name: /active session/i });
    expect(within(bar).getByText('Furnace 7')).toBeTruthy();
  });
});
