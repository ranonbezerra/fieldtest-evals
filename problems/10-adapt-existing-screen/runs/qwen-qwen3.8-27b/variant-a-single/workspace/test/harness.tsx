import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';
import { ActiveSessionProvider } from '../src/active-session/active-session-store';
import { AUTH_STORAGE_KEY, AuthProvider } from '../src/auth/auth';
import type { Session } from '../src/api/types';
import { routes } from '../src/routes';
import { createFakeApi, type FakeApi } from './fake-api';

export interface RenderAppOptions {
  initialEntries?: string[];
  sessions?: Session[];
  activeId?: string | null;
  /** Defaults to true; set to false to start logged out. */
  authenticated?: boolean;
}

export interface AppView extends RenderResult {
  router: ReturnType<typeof createMemoryRouter>;
  fake: FakeApi;
  queryClient: QueryClient;
}

const OPERATOR = { token: 'fake-token', user: { id: 'op-1', name: 'Op' } };

/**
 * Renders the real app (same routes and providers as src/main.tsx) on top of a
 * memory router and the fake API, so tests exercise behaviour end to end.
 */
export function renderApp(options: RenderAppOptions = {}): AppView {
  const fake = createFakeApi({ sessions: options.sessions, activeId: options.activeId });
  globalThis.fetch = fake.fetch as unknown as typeof fetch;

  if (options.authenticated ?? true) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(OPERATOR));
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  const router = createMemoryRouter(routes, {
    initialEntries: options.initialEntries ?? ['/sessions'],
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActiveSessionProvider>
          <RouterProvider router={router} />
        </ActiveSessionProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { ...result, router, fake, queryClient };
}

export function makeSession(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    name: `Session ${overrides.id}`,
    status: 'open',
    started_at: '2024-05-01T09:00:00.000Z',
    notes: '',
    ...overrides,
  };
}
