import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('appears after opening a session and persists after a refresh', async () => {
    // Authenticate
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    const { unmount } = renderApp('/sessions');

    // Load the list and open the first session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Bar should now be visible
    const bar = await screen.findByTestId('active-session-bar');
    expect(bar).toHaveTextContent('Inspection 1');

    // Simulate a full page refresh by unmounting and mounting a fresh app instance
    unmount();
    renderApp('/sessions');

    // The bar should still show the previously active session
    const barAfterRefresh = await screen.findByTestId('active-session-bar');
    expect(barAfterRefresh).toHaveTextContent('Inspection 1');
  });

  it('can close the active session via the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    renderApp('/sessions');

    // Open a session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Ensure the bar is present
    const bar = await screen.findByTestId('active-session-bar');
    expect(bar).toBeInTheDocument();

    // Click the "Close session" button on the bar
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));

    // Confirm dialog should appear
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
    await userEvent.click(confirmBtn);

    // Bar should disappear and server state cleared
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
    expect(state.activeSessionId).toBeNull();
  });

  it('prompts when navigating away with unsaved notes', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    renderApp('/sessions');

    // Open a session
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());

    // Edit the notes field to make the form dirty
    const notesField = screen.getByLabelText('Notes');
    await userEvent.clear(notesField);
    await userEvent.type(notesField, 'Unsaved changes');

    // Attempt to navigate away via the header link
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));

    // Blocker dialog should appear
    const blockerDialog = await screen.findByRole('dialog', { name: 'Leave with unsaved notes?' });
    const leaveBtn = within(blockerDialog).getByRole('button', { name: 'Leave' });
    await userEvent.click(leaveBtn);

    // After confirming, we should be back on the sessions list
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument());
  });
});
