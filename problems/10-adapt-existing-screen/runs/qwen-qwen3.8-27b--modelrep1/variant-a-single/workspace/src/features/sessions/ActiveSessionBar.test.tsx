import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';

const operator = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function bar() {
  return screen.queryByRole('region', { name: 'Active session' });
}

function elapsedText(el: HTMLElement): string {
  const m = el.textContent?.match(/(\d+d )?\d{2}:\d{2}:\d{2}/);
  if (!m) throw new Error('no elapsed readout in the bar');
  return m[0];
}

function elapsedSeconds(text: string): number {
  const parts = text.split(' ');
  const [h, m, s] = parts[parts.length - 1].split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

describe('ActiveSessionBar', () => {
  it('formats the elapsed readout', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(65_000)).toBe('00:01:05');
    expect(formatElapsed(3_661_000)).toBe('01:01:01');
    expect(formatElapsed(90_061_000)).toBe('1d 01:01:01');
  });

  it('appears when a session is opened and follows the operator across screens', async () => {
    state.user = operator;
    state.activeSessionId = null;
    sessions[0].status = 'open';
    renderApp('/sessions');

    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Inspection 1')).toBeInTheDocument(),
    );
    expect(bar()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    const active = await screen.findByRole('region', { name: 'Active session' });
    expect(within(active).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(active).getByText('open')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument(),
    );

    expect(
      within(screen.getByRole('region', { name: 'Active session' })).getByText('Inspection 1'),
    ).toBeInTheDocument();
    expect(state.activeSessionId).toBe('s-001');
  });

  it('restores the active session from the API on a fresh load', async () => {
    state.user = operator;
    sessions[3].status = 'open';
    state.activeSessionId = 's-004';
    renderApp('/sessions');

    const active = await screen.findByRole('region', { name: 'Active session' });
    expect(within(active).getByText('Inspection 4')).toBeInTheDocument();
    // Not derived from the list: the first row is a different session.
    expect(within(active).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('Resume navigates to the active session detail', async () => {
    state.user = operator;
    sessions[3].status = 'open';
    state.activeSessionId = 's-004';
    renderApp('/orders');

    const active = await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(within(active).getByRole('button', { name: 'Resume' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('opening another session replaces the active one', async () => {
    state.user = operator;
    sessions[0].status = 'open';
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const active = await screen.findByRole('region', { name: 'Active session' });
    expect(within(active).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));

    await waitFor(() => expect(within(active).getByText('Inspection 2')).toBeInTheDocument());
    expect(within(active).queryByText('Inspection 1')).not.toBeInTheDocument();
    expect(state.activeSessionId).toBe('s-002');
  });

  it('asks about unsaved notes before the active slot is taken over', async () => {
    state.user = operator;
    sessions[0].status = 'open';
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    const notes = await screen.findByLabelText('Notes');
    await userEvent.type(notes, 'check gauge');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    expect(within(dialog).getByText(/have not been saved/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 2' }));

    const active = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() => expect(within(active).getByText('Inspection 2')).toBeInTheDocument());
    expect(within(active).queryByText('Inspection 1')).not.toBeInTheDocument();
    expect(state.activeSessionId).toBe('s-002');
  });

  it('a deep link to a detail takes over the active slot', async () => {
    state.user = operator;
    sessions[0].status = 'open';
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-007');

    const active = await screen.findByRole('region', { name: 'Active session' });
    await waitFor(() => expect(within(active).getByText('Inspection 7')).toBeInTheDocument());
    expect(within(active).queryByText('Inspection 1')).not.toBeInTheDocument();
    expect(state.activeSessionId).toBe('s-007');
  });

  it('close from the bar goes through confirm and empties the bar', async () => {
    state.user = operator;
    sessions[0].status = 'open';
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const active = await screen.findByRole('region', { name: 'Active session' });
    expect(within(active).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(active).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(active).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(within(active).getByRole('button', { name: 'Close session' }));
    await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close session' }),
    );

    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    const cell = within(screen.getByRole('table')).getByRole('cell', { name: 'Inspection 1' });
    const row = cell.parentElement as HTMLTableRowElement;
    await waitFor(() => expect(within(row).getByText('closed')).toBeInTheDocument());
    expect(state.activeSessionId).toBeNull();
  });

  it('clears with the operator on logout', async () => {
    state.user = operator;
    sessions[0].status = 'open';
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const active = await screen.findByRole('region', { name: 'Active session' });
    expect(within(active).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(state.user).toBeNull();
  });

  it('ticks the elapsed readout every second', async () => {
    state.user = operator;
    sessions[0].status = 'open';
    sessions[0].startedAt = new Date(Date.now() - 65_000).toISOString();
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    const active = await screen.findByRole('region', { name: 'Active session' });
    const first = elapsedText(active);
    await waitFor(() => expect(elapsedText(active)).not.toBe(first), { timeout: 3000 });
    expect(elapsedText(active)).toBe(formatElapsed((elapsedSeconds(first) + 1) * 1000));
  });
});
