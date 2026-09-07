import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Session } from '../src/api/types';
import { makeSession, renderApp } from './harness';

function seedSessions(): Session[] {
  // 25 sessions; every third one is closed.
  return Array.from({ length: 25 }, (_, i) =>
    makeSession({
      id: `s${i + 1}`,
      name: `Session ${i + 1}`,
      status: (i + 1) % 3 === 0 ? 'closed' : 'open',
    }),
  );
}

describe('session list', () => {
  it('paginates with next/previous and the page indicator', async () => {
    const view = renderApp({ sessions: seedSessions(), activeId: null });
    const user = userEvent.setup();

    expect(await screen.findByRole('button', { name: 'Session 1' })).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: 'Session 11' })).toBeTruthy();
    expect(view.router.state.location.search).toBe('?page=2');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: 'Session 21' })).toBeTruthy();
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('button', { name: 'Session 11' })).toBeTruthy();
    expect(view.router.state.location.search).toBe('?page=2');
  });

  it('filters by status and resets to the first page', async () => {
    const view = renderApp({ sessions: seedSessions(), activeId: null });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Session 1' });

    await user.selectOptions(screen.getByRole('combobox'), 'closed');
    expect(await screen.findByRole('button', { name: 'Session 24' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Session 1' })).toBeNull());
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(view.router.state.location.search).toBe('?status=closed');

    await user.selectOptions(screen.getByRole('combobox'), 'all');
    expect(await screen.findByRole('button', { name: 'Session 1' })).toBeTruthy();
    expect(view.router.state.location.search).toBe('');
  });

  it('honours status and page deep links', async () => {
    const view = renderApp({
      sessions: seedSessions(),
      activeId: null,
      initialEntries: ['/sessions?page=2&status=open'],
    });
    expect(await screen.findByRole('button', { name: 'Session 16' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Session 1' })).toBeNull();
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(view.router.state.location.search).toBe('?page=2&status=open');
  });
});
