# repair1-db.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/mocks/db.ts`:

1. `src/mocks/db.ts(1,15): error TS2305: Module '"../api/types"' has no exported member 'Order'.`
   - The file imports `Order` from `../api/types`, but `Order` doesn't exist there. Looking at the types file, it exports `Session`, `SessionStatus`, `PagedSessions`, `SessionListParams`, `User`, `LoginResponse`. There's no `Order` type.

2. `src/mocks/db.ts(3,14): error TS2322: Type '{ id: string; name: string; operator: string; status: "open" | "closed" | "paused"; notes: string; startedAt: string; closedAt: string | null; }[]' is not assignable to type 'Session[]'. Property 'started_at' is missing in type '{ id: string; name: string; operator: string; status: "open" | "closed" | "paused"; notes: string; startedAt: string; closedAt: string | null; }' but required in type 'Session'.`
   - The mock data uses `startedAt` (camelCase) but the `Session` interface requires `started_at` (snake_case). Also the `status` type in the mock is `"open" | "closed" | "paused"` but `SessionStatus` is `'open' | 'closed'`.

So I need to fix `src/mocks/db.ts` to:
1. Remove the `Order` import (or not use it) since it doesn't exist in types.
2. Fix the session mock data to use `started_at` instead of `startedAt`, and remove `closedAt` or map it appropriately.
3. Fix the status to only use `'open' | 'closed'` (matching `SessionStatus`).

Looking at the `Session` interface:
```typescript
export interface Session {
  id: string;
  name: string;
  status: SessionStatus; // 'open' | 'closed'
  started_at: string;
  notes: string;
}
```

So the mock needs:
- `id: string`
- `name: string`
- `status: SessionStatus` ('open' | 'closed')
- `started_at: string` (ISO 8601)
- `notes: string`

No `operator`, no `closedAt` field on Session.

Now, the file also imports `Order` which doesn't exist. I need to remove that import. But wait - what was the file originally? It probably had both sessions and orders mock data. Since `Order` doesn't exist in types, I need to remove it.

Let me also check what other files reference. The `handlers.ts` also imports `Order` from types, but that's not my file to fix. I only need to fix `db.ts`.

For `db.ts`, I need to:
1. Remove the `Order` import (it doesn't exist)
2. Fix the session mock data to match the `Session` interface (use `started_at`, remove `closedAt`, fix status to only 'open' | 'closed')

Let me write the complete file. I'll keep it focused on what the compiler messages require. Since `Order` doesn't exist in types, I'll add an ASSUMPTION line about that.

Let me think about what reasonable mock data would look like. The file probably exports arrays of sessions (and maybe orders that I need to remove). I'll create a few sessions with the correct shape.
```

## reply

```typescript
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
```
