import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeSession, renderApp } from './harness';

describe('active session bar', () => {
  it('is not rendered when no session is active', async () => {
    renderApp({ sessions: [makeSession({ id: 's1', name: 'Furnace 7' })], activeId: null });
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(screen.queryByRole('region', { name: /active session/i })).toBeNull();
  });

  it('restores the active session from the API after a page refresh', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
      initialEntries: ['/'],
    });
    const bar = await screen.findByRole('region', { name: /active session/i });
    expect(within(bar).getByText('Furnace 7')).toBeTruthy();
    expect(within(bar).getByText('open')).toBeTruthy();
    // The app asked the API for the active session, not client storage.
    expect(view.fake.requests.some((r) => r.method === 'GET' && r.url === '/sessions/active')).toBe(true);
  });

  it('ticks the elapsed time while the session is open', async () => {
    const startedAt = new Date(Date.now() - 5000).toISOString();
    renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7', started_at: startedAt })],
      activeId: 's1',
    });
    const bar = await screen.findByRole('region', { name: /active session/i });
    const elapsed = () => within(bar).getByText(/\d+m \d{2}s/);
    const first = elapsed().textContent;
    await waitFor(() => expect(elapsed().textContent).not.toBe(first), { timeout: 3000 });
  });

  it('resume navigates to the session detail', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    const bar = await screen.findByRole('region', { name: /active session/i });
    await user.click(within(bar).getByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('heading', { name: 'Furnace 7' })).toBeTruthy();
    expect(view.router.state.location.pathname).toBe('/sessions/s1');
  });

  it('empties the bar after a confirmed close', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    const bar = await screen.findByRole('region', { name: /active session/i });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(within(bar).getByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /active session/i })).toBeNull());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Furnace 7'));
    expect(view.fake.state.activeId).toBeNull();
    expect(view.fake.requests.some((r) => r.method === 'POST' && r.url === '/sessions/s1/close')).toBe(true);
  });

  it('keeps the bar when the operator cancels the close', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    const bar = await screen.findByRole('region', { name: /active session/i });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(within(bar).getByRole('button', { name: 'Close session' }));
    expect(within(bar).getByText('Furnace 7')).toBeTruthy();
    expect(view.fake.state.activeId).toBe('s1');
    expect(view.fake.requests.some((r) => r.url === '/sessions/s1/close')).toBe(false);
  });

  it('shows an error and keeps the bar when the close request fails', async () => {
    const view = renderApp({
      sessions: [makeSession({ id: 's1', name: 'Furnace 7' })],
      activeId: 's1',
    });
    const user = userEvent.setup();
    const bar = await screen.findByRole('region', { name: /active session/i });
    view.fake.failNext(
      (method, url) => method === 'POST' && url === '/sessions/s1/close',
      500,
      'internal_error',
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(within(bar).getByRole('button', { name: 'Close session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/internal_error/);
    expect(within(bar).getByText('Furnace 7')).toBeTruthy();
    expect(view.fake.state.activeId).toBe('s1');
  });
});
