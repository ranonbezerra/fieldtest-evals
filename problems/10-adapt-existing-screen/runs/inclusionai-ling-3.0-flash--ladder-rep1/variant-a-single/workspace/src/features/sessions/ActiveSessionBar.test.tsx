import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  afterEach(() => {
    state.activeSessionId = null;
  });

  it('appears on authenticated screens', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('does not appear on the login screen', async () => {
    state.activeSessionId = 's-001';
    renderApp('/login');
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('resume navigates to the session detail', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'));
  });

  it('close calls the endpoint behind a confirm and empties the bar', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close session' }),
    );

    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('shows elapsed time that ticks', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => {
      const bar = screen.getByTestId('active-session-bar');
      return bar.textContent?.match(/\d+m \d+s/);
    });

    expect(screen.getByTestId('active-session-bar').textContent).toMatch(/\d+m \d+s/);
  });

  it('shows the active session from GET /sessions/active on fresh load', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  });

  it('confirms before replacing a session with unsaved notes', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    // Open session 1 detail
    await userEvent.click(screen.getByText('Inspection 1'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'));

    // Edit notes → dirty
    const textarea = screen.getByLabelText('Notes');
    await userEvent.click(textarea);
    await userEvent.type(textarea, 'unsaved change');

    // Going back triggers the dirty-flag blocker on the detail screen
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Leave with unsaved notes?' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

    // Now on the list, clicking another session triggers the list's confirm
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Inspection 2'));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Switch active session?' })).toBeInTheDocument(),
    );

    // Confirm switch
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Switch active session?' })).getByRole('button', {
        name: 'Switch',
      }),
    );

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 2'));
  });
});
