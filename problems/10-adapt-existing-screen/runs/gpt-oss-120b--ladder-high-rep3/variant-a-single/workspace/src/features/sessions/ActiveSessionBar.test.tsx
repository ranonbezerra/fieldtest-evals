import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('does not render when there is no active session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument();
  });

  it('renders the active session bar with session info', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText(/\d+:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('resume button navigates to session detail', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    const resumeBtn = screen.getByRole('button', { name: 'Resume' });
    await userEvent.click(resumeBtn);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inspection 1' })).toBeInTheDocument());
  });

  it('close session button opens confirm dialog and clears the bar on confirm', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    renderApp('/orders');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());

    const closeBtn = screen.getByRole('button', { name: 'Close session' });
    await userEvent.click(closeBtn);

    const dialog = screen.getByRole('dialog', { name: 'Close this session?' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Close session' });
    await userEvent.click(confirmBtn);

    await waitFor(() => expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument());
  });

  it('persists after a full page refresh', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = 's-001';
    const firstRender = renderApp('/orders');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    firstRender.unmount();

    // Simulate a page reload by rendering a fresh app instance.
    renderApp('/orders');
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
  });
});
