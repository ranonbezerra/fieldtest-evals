import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server } from '../../mocks/server';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure an authenticated user for every test.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  });

  afterEach(() => {
    // Reset active session between tests to avoid cross‑test contamination.
    state.activeSessionId = null;
  });

  it('appears after opening a session and can be closed', async () => {
    renderApp('/sessions');

    // Load the list and open a session.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));

    // Wait for the detail screen.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // The bar should now be visible.
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    // Close the session via the bar.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close session' }));

    // The bar disappears after the close succeeds.
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('persists after a full page refresh', async () => {
    const { unmount } = renderApp('/sessions');

    // Open a session.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Verify the bar is present.
    const bar = await screen.findByTestId('active-session-bar');
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();

    // Simulate a page reload by unmounting and mounting a fresh app.
    unmount();
    renderApp('/orders');

    // The bar should reappear based on server state.
    const barAfterRefresh = await screen.findByTestId('active-session-bar');
    expect(within(barAfterRefresh).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('shows an error state when fetching active session fails', async () => {
    server.use(
      http.get('/api/sessions/active', () => {
        return HttpResponse.json({ code: 'unknown' }, { status: 500 });
      }),
    );

    renderApp('/orders');

    const errorMsg = await screen.findByText('Error loading active session');
    expect(errorMsg).toBeInTheDocument();
  });

  it('updates elapsed time every second', async () => {
    vi.useFakeTimers();

    renderApp('/sessions');

    // Open a session.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    const elapsed = await screen.findByTestId('elapsed-time');
    const first = elapsed.textContent;

    // Advance virtual timers.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    await waitFor(() => {
      expect(elapsed.textContent).not.toBe(first);
    });

    vi.useRealTimers();
  });
});
