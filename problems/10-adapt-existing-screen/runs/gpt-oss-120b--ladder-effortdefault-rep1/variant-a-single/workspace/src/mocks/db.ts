import type { Order, Session } from '../api/types';

export const sessions: Session[] = Array.from({ length: 27 }, (_, i) => ({
  id: `s-${String(i + 1).padStart(3, '0')}`,
  name: `Inspection ${i + 1}`,
  operator: ['Ada', 'Grace', 'Alan'][i % 3],
  status: (['open', 'paused', 'closed'] as const)[i % 3],
  notes: i % 4 === 0 ? 'Awaiting parts.' : '',
  startedAt: new Date(Date.UTC(2024, 3, 1 + (i % 20), 8, 0)).toISOString(),
  closedAt: i % 3 === 2 ? new Date(Date.UTC(2024, 3, 1 + (i % 20), 17, 0)).toISOString() : null,
}));

export const orders: Order[] = Array.from({ length: 31 }, (_, i) => ({
  id: `o-${String(i + 1).padStart(3, '0')}`,
  reference: `ORD-2024-${String(i + 1).padStart(4, '0')}`,
  customer: ['Northwind', 'Contoso', 'Fabrikam'][i % 3],
  status: (['pending', 'pending', 'approved', 'rejected', 'cancelled'] as const)[i % 5],
  totalMinor: 12_500 * (i + 1),
  placedAt: new Date(Date.UTC(2024, 4, 1 + (i % 20))).toISOString(),
}));

export const state = {
  activeSessionId: null as string | null,
  user: null as { id: string; name: string; roles: string[] } | null,
};

export const PAGE_SIZE = 10;
