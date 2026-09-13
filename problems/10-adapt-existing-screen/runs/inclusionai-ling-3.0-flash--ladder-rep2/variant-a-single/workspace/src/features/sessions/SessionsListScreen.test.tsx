import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { state } from '../../mocks/db';
import { renderApp } from '../../test/render';

describe('SessionsListScreen', () => {
  it('lists the first page and pages forward', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Inspection 11')).toBeInTheDocument());
  });

  it('filters by status and resets to the first page', async () => {
    state.user = { id: 'u-1', name: 'Ada', roles: ['operator'] };
    renderApp('/sessions');

    await waitFor(() => expect(screen.getByText('Inspection 1')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'closed');

    await waitFor(() => expect(screen.getByText(/Page 1 of/)).toBeInTheDocument());
    expect(screen.queryByText('Inspection 1')).not.toBeInTheDocument();
  });
});
