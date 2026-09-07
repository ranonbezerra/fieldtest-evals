import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeSession, renderApp } from './harness';

describe('session detail', () => {
  it('warns on route change when notes are unsaved and keeps the draft', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7', notes: 'initial notes' })],
      activeId: 's1',
      initialEntries: ['/sessions/s1'],
    });
    const user = userEvent.setup();
    const notes = await screen.findByLabelText('Notes');
    expect(notes).toHaveValue('initial notes');
    await user.type(notes, ' + addendum');
    expect(screen.getByTestId('dirty-flag')).toBeTruthy();

    // "Stay" keeps the operator on the screen.
    await user.click(screen.getByRole('link', { name: 'Back to sessions' }));
    const dialog = await screen.findByTestId('leave-dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(view.router.state.location.pathname).toBe('/sessions/s1');
    expect(screen.getByLabelText('Notes')).toHaveValue('initial notes + addendum');

    // "Leave" performs the navigation without writing to the server.
    await user.click(screen.getByRole('link', { name: 'Back to sessions' }));
    const secondDialog = await screen.findByTestId('leave-dialog');
    await user.click(within(secondDialog).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect(view.router.state.location.pathname).toBe('/sessions');
    expect(view.fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);

    // Coming back restores the draft and the dirty flag.
    await user.click(screen.getByRole('button', { name: 'Furnace 7' }));
    expect(await screen.findByLabelText('Notes')).toHaveValue('initial notes + addendum');
    expect(screen.getByTestId('dirty-flag')).toBeTruthy();
  });

  it('saves notes and clears the dirty flag', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7', notes: 'initial notes' })],
      activeId: 's1',
      initialEntries: ['/sessions/s1'],
    });
    const user = userEvent.setup();
    const notes = await screen.findByLabelText('Notes');
    await user.type(notes, ' + addendum');
    await user.click(screen.getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(screen.queryByTestId('dirty-flag')).toBeNull());
    expect(view.fake.state.sessions[0].notes).toBe('initial notes + addendum');
    expect(view.fake.requests.some((r) => r.method === 'PATCH' && r.url === '/sessions/s1')).toBe(true);
  });

  it('keeps the notes dirty and shows an error when saving fails', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7', notes: 'initial notes' })],
      activeId: 's1',
      initialEntries: ['/sessions/s1'],
    });
    const user = userEvent.setup();
    const notes = await screen.findByLabelText('Notes');
    await user.type(notes, ' + addendum');
    view.fake.failNext(
      (method, url) => method === 'PATCH' && url === '/sessions/s1',
      500,
      'internal_error',
    );
    await user.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/internal_error/);
    expect(screen.getByTestId('dirty-flag')).toBeTruthy();
    expect(view.fake.state.sessions[0].notes).toBe('initial notes');
  });
});
