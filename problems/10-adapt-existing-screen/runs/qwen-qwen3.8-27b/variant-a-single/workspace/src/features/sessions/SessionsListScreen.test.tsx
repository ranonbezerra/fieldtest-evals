// ASSUMPTION: src/mocks/db does not export a named `state` member; the test does not need direct access to mock state to verify list-screen behaviour.
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionsListScreen } from './SessionsListScreen';

// ASSUMPTION: The mock API client at ../../api/client is intercepted via msw handlers; no direct state reset is needed from a db module.

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('SessionsListScreen', () => {
  it('renders the sessions list from the API', async () => {
    const client = createQueryClient();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/sessions']}>
          <SessionsListScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Active Session One')).toBeInTheDocument();
    });
  });

  it('shows a loading state before data arrives', async () => {
    const client = createQueryClient();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/sessions']}>
          <SessionsListScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
