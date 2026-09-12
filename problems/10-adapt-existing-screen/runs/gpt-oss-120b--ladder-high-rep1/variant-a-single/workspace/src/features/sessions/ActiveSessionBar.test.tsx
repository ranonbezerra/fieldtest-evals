import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure a clean auth + active‑session state before each test.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
  });

  it('appears after opening a session and persists across navigation', async () => {
    renderApp('/sessions');

    // Wait for the first page of sessions to load.
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Open a session from the list.
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // The bar should now be visible.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Navigate away (to Orders) – the bar should stay.
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('closes active session and bar disappears', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Wait for the bar's Resume button (unique to the bar).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Locate the Close button inside the same bar.
    const resumeBtn = screen.getByRole('button', { name: 'Resume' });
    const bar = resumeBtn.closest('.active-session-bar') as HTMLElement;
    if (!bar) throw new Error('Active session bar not found');
    const closeBtn = within(bar).getByRole('button', { name: 'Close session' });

    // Trigger the close flow.
    await userEvent.click(closeBtn);

    // Confirm dialog appears – confirm the action.
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
    await userEvent.click(confirmBtn);

    // After successful close the bar should disappear.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument());
  });

  it('persists after page refresh', async () => {
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Ensure the bar is present.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());

    // Simulate a full page refresh by unmounting and remounting the app.
    cleanup();
    renderApp('/orders');

    // The bar should be restored from the server‑side active session.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
  });
});
