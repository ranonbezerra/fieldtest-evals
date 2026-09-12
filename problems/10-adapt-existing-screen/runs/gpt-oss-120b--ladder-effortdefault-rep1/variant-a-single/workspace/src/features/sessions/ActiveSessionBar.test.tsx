import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  beforeEach(() => {
    // Ensure a fresh user for each test.
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
  });

  it('shows the active session when present', async () => {
    state.activeSessionId = 's-001'; // Inspection 1 (open)

    renderApp('/');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close session' })).toBeInTheDocument();
  });

  it('navigates to the session detail when clicking Resume', async () => {
    state.activeSessionId = 's-001';

    renderApp('/');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

    // The detail screen shows the same session name as its heading.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  });

  it('closes the session and clears the bar after confirmation', async () => {
    state.activeSessionId = 's-001';

    renderApp('/');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close session' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));

    // Confirmation dialog appears.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' })); // confirm

    // Bar should disappear (no session name).
    await waitFor(() => expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument());
  });

  it('handles fetch error without showing as “no active session”', async () => {
    // Force the active‑session endpoint to return 500.
    state.activeSessionId = 's-001';
    const originalHandler = state.activeSessionId;
    // Override handler temporarily via MSW.
    // Using server reset in test setup; we replace with a failing handler.
    // ASSUMPTION: The test environment allows redefining handlers inline.
    // Here we simply simulate by clearing auth (causing 401) to trigger error.
    state.user = null; // unauthenticated → 401 on /sessions/active

    renderApp('/');

    await waitFor(() => expect(screen.getByText(/Failed to load active session/)).toBeInTheDocument());
    // No session info should be rendered.
    expect(screen.queryByText('Inspection')).not.toBeInTheDocument();
  });
});
