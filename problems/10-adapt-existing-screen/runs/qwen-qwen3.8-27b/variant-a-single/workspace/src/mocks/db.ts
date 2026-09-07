import type { Session, SessionStatus } from '../api/types';

// ASSUMPTION: The scaffold's types.ts does not export an `Order` type; the
// original mock likely included order fixtures for a different feature branch.
// Only `Session` fixtures are retained here.

export const sessions: Session[] = [
  {
    id: 'ses_001',
    name: 'Warehouse Intake — Dock 3',
    status: 'open' as SessionStatus,
    started_at: '2025-06-10T08:00:00.000Z',
    notes: '',
  },
  {
    id: 'ses_002',
    name: 'Cycle Count — Aisle 12',
    status: 'open' as SessionStatus,
    started_at: '2025-06-10T09:30:00.000Z',
    notes: 'Flagged 3 discrepancies.',
  },
  {
    id: 'ses_003',
    name: 'Returns Processing — Batch 44',
    status: 'closed' as SessionStatus,
    started_at: '2025-06-09T14:00:00.000Z',
    notes: '',
  },
  {
    id: 'ses_004',
    name: 'Shelf Restock — Zone B',
    status: 'closed' as SessionStatus,
    started_at: '2025-06-08T07:15:00.000Z',
    notes: 'Completed ahead of schedule.',
  },
];
