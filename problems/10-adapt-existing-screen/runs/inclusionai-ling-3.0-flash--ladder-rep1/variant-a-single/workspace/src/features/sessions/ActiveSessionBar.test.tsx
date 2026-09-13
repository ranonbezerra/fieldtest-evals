import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';

describe('ActiveSessionBar', () => {
  it('does not appear on unauthenticated screens', () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/login');
    expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument();
  });

  it('appears on an authenticated screen when a session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText('Inspection 1')).toBeInTheDocument();
  });

  it('is absent when no session is active', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('surfaces a failure distinctly from having no session', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    server.use(
      http.get('/api/sessions/active', () =>
        HttpResponse.json({ code: 'server_error' }, { status: 500 }),
      ),
    );
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText(/could not load the active session/i)).toBeInTheDocument());
    server.resetHandlers();
  });

  it('ticks elapsed time', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    expect(screen.getByText(/:\d{2}/)).toBeInTheDocument();
  });

  it('resumes the active session on Resume', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inspection 1'),
    );
  });

  it('closes the session through the confirm dialog', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close session' }),
    );
    await waitFor(() => expect(screen.queryByTestId('active-session-bar')).not.toBeInTheDocument());
  });

  it('keeps the session when the confirm dialog is cancelled', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = sessions[0].id;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('active-session-bar')).toBeInTheDocument();
  });

  it('becomes visible after navigating to a session from the list', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    state.activeSessionId = null;
    renderApp('/sessions');
    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 1' }));
    await waitFor(() => expect(screen.getByTestId('active-session-bar')).toBeInTheDocument());
  });
});
