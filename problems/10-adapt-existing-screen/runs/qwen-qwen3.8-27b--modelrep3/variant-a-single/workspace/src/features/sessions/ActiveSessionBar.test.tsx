import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { renderApp } from '../../test/render';
import { formatElapsed } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

afterEach(() => {
  state.user = null;
  state.activeSessionId = null;
});

describe('ActiveSessionBar', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(5_000)).toBe('5s');
    expect(formatElapsed(65_000)).toBe('1m 5s');
    expect(formatElapsed(3_665_000)).toBe('1h 1m 5s');
    expect(formatElapsed(-1)).toBe('0s');
  });

  it('shows no bar while the server has no active session', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('restores the active session from the API after a page refresh', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    // A fresh app instance, as a full page reload produces: only the server
    // still remembers which session is active.
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 2')).toBeInTheDocument();
    expect(within(bar).getByText('paused')).toBeInTheDocument();
  });

  it('makes an opened session the active one, and keeps showing it elsewhere', async () => {
    state.user = OPERATOR;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Inspection 1' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('replaces the active session when another one is opened', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('resumes the active session from the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    renderApp('/orders');
    const bar = await screen.findByTestId('active-session-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 4' })).toBeInTheDocument());
  });

  it('closes the active session from the bar and empties the bar', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-005';
    const target = sessions.find((s) => s.id === 's-005');
    if (!target) throw new Error('mock data must contain s-005');
    const snapshot = { ...target };

    try {
      renderApp('/orders');
      const bar = await screen.findByTestId('active-session-bar');
      await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));

      const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

      await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
      const row = await screen.findByRole('row', { name: /Inspection 5/ });
      expect(within(row).getByText('closed')).toBeInTheDocument();
    } finally {
      Object.assign(target, snapshot);
    }
  });

  it('asks before opening another session while the current one has unsaved notes', async () => {
    state.user = OPERATOR;
    renderApp('/sessions/s-001');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Notes'), 'Waiting on parts.');

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    expect(within(dialog).getByText('Your changes to the notes have not been saved.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument();
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    const again = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('active-session-bar')).queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('ticking the elapsed time once per second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      state.user = OPERATOR;
      state.activeSessionId = 's-001';
      renderApp('/orders');

      for (let i = 0; i < 50 && !screen.queryByTestId('active-session-bar'); i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      const bar = screen.getByTestId('active-session-bar');
      const elapsed = within(bar).getByTestId('active-session-elapsed');
      const first = elapsed.textContent;
      expect(first).toMatch(/^\d+h \d+m \d+s$/);

      await vi.advanceTimersByTimeAsync(2500);
      for (let i = 0; i < 10 && elapsed.textContent === first; i++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(elapsed.textContent).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logout clears the bar and a re-login starts without one', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 2' }));
    await screen.findByTestId('active-session-bar');
    expect(within(screen.getByTestId('active-session-bar')).getByText('Inspection 2')).toBeInTheDocument();
  });
});
