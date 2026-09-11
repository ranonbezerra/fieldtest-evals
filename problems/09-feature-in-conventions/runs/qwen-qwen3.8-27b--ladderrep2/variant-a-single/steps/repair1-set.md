# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. **drizzle/schema.ts (lines 41, 62)**: The `pgTable` third argument (the table extra config callback) expects a `PgTableExtraConfig` which is an object, not an array. In Drizzle ORM, the third parameter to `pgTable` should return an object with named keys, not an array. The correct pattern is:
```ts
(t) => ({
  nameIndex: index('...').on(t.tripId),
  uniqueKey: unique('...').on(t.tripId, t.userId),
})
```

2. **trips.service.spec.ts (lines 255, 314, 333, 334)**: The spec calls `svc.get(...)` but the service defines the method as `getById(...)`. So either the spec should call `getById` or the service method should be renamed to `get`. Looking at the service, it's named `getById`. The spec calls `svc.get(...)`. Since the errors say "Property 'get' does not exist on type 'TripsService'", the fix is to change the spec to call `svc.getById(...)` instead of `svc.get(...)`.

3. **trips.service.spec.ts (lines 256, 319, 320, 321)**: These are `TS7006: Parameter 'm' implicitly has an 'any' type`. These are in callback parameters. Looking at the spec code:
- Line 256: `expect(detail.members.some((m) => m.userId === 'u2' && m.role === 'member')).toBe(true);`
- Lines 319-321: `expect(detail.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);` etc.

Wait, but if `getById` returns `TripDetail`, and `TripDetail` has `members: TripMember[]`, then `m` should be inferred as `TripMember`. The issue is that the method doesn't exist (`get` vs `getById`), so TypeScript can't infer the return type, making `detail` be `any` or the property access fails. Actually no — if `get` doesn't exist, then `detail` would be an error type. But the TS7006 errors on `m` are because the return type of a non-existent method is `any`, so `detail.members` is `any`, and the callback parameter `m` is implicitly `any`.

So fixing the `get` → `getById` calls should fix both the TS2339 errors AND the TS7006 errors (since the return type will be properly inferred).

Let me re-read the spec to confirm:

Line 255: `const detail = await svc.get('t1', grace);`
Line 256: `expect(detail.members.some((m) => m.userId === 'u2' && m.role === 'member')).toBe(true);`

Lines 314-321:
```
const detail = await svc.get('t1', ada);

expect(detail.id).toBe('t1');
expect(detail.name).toBe('Lisbon in June');
expect(detail.members).toHaveLength(2);
expect(detail.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
expect(detail.members.find((m) => m.userId === 'u1')?.email).toBe('ada@example.com');
expect(detail.members.find((m) => m.userId === 'u2')?.email).toBe('grace@example.com');
```

Lines 333-334:
```
await expect(svc.get('t1', stranger)).rejects.toMatchObject({ code: 'not_found' });
await expect(svc.get('does-not-exist', stranger)).rejects.toMatchObject({ code: 'not_found' });
```

So the fixes are:
1. **drizzle/schema.ts**: Change the third argument of `pgTable` from returning an array to returning an object.
2. **trips.service.spec.ts**: Change all `svc.get(...)` to `svc.getById(...)`.

Let me write out the corrected files.

For drizzle/schema.ts, the `tripMembers` table:
```ts
export const tripMembers = pgTable(
  'trip_members',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripUserKey: unique('trip_members_trip_user_key').on(t.tripId, t.userId),
    tripIdIdx: index('trip_members_trip_id_idx').on(t.tripId),
  }),
);
```

And the `tripInvites` table:
```ts
export const tripInvites = pgTable(
  'trip_invites',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    status: text('status', { enum: ['pending', 'accepted', 'declined'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripIdIdx: index('trip_invites_trip_id_idx').on(t.tripId),
  }),
);
```

For trips.service.spec.ts, I need to change:
- `svc.get('t1', grace)` → `svc.getById('t1', grace)` (line 255)
- `svc.get('t1', ada)` → `svc.getById('t1', ada)` (line 314)
- `svc.get('t1', stranger)` → `svc.getById('t1', stranger)` (line 333)
- `svc.get('does-not-exist', stranger)` → `svc.getById('does-not-exist', stranger)` (line 334)

Let me write out both complete files.
```

## reply

Looking at the errors as a whole, there are exactly **two distinct mistakes**:

1. **drizzle/schema.ts**: The third argument to `pgTable` must return a `PgTableExtraConfig` (an object with named keys), not an array. This affects both `tripMembers` and `tripInvites`.

2. **trips.service.spec.ts**: The spec calls `svc.get(...)` but the service defines the method as `getById(...)`. Fixing the name resolves both the TS2339 errors and the downstream TS7006 implicit-`any` errors (which exist only because the non-existent method returns `any`).

### drizzle/schema.ts
```ts
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * Every table carries `created_at` and `updated_at`. Columns are snake_case;
 * the TypeScript property is camelCase and mapped explicitly.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  destination: text('destination').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

export const tripMembers = pgTable(
  'trip_members',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripUserKey: unique('trip_members_trip_user_key').on(t.tripId, t.userId),
    tripIdIdx: index('trip_members_trip_id_idx').on(t.tripId),
  }),
);

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type NewTripMemberRow = typeof tripMembers.$inferInsert;

export const tripInvites = pgTable(
  'trip_invites',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    status: text('status', { enum: ['pending', 'accepted', 'declined'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripIdIdx: index('trip_invites_trip_id_idx').on(t.tripId),
  }),
);

export type TripInviteRow = typeof tripInvites.$inferSelect;
export type NewTripInviteRow = typeof tripInvites.$inferInsert;
```

### src/modules/trips/trips.service.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { TripsService } from './trips.service.js';
import { TripsRepository, type TripMemberWithUser } from './trips.repository.js';

/**
 * The repository is faked at its interface, with the same state semantics the
 * unique (trip, user) constraint gives in Postgres: one membership per pair,
 * ever.
 */

const NOW = new Date('2024-01-01T00:00:00Z');

interface FakeState {
  trips: TripRow[];
  memberships: TripMemberRow[];
  invites: TripInviteRow[];
  users: Array<{ id: string; email: string }>;
}

function fakeRepo(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    trips: initial.trips ?? [],
    memberships: initial.memberships ?? [],
    invites: initial.invites ?? [],
    users: initial.users ?? [],
  };

  const repo = {
    async createTrip(row: NewTripRow): Promise<TripRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      state.trips.push(created);
      return created;
    },
    async findTripById(id: string): Promise<TripRow | null> {
      return state.trips.find((t) => t.id === id) ?? null;
    },
    async findMembership(tripId: string, userId: string): Promise<TripMemberRow | null> {
      return state.memberships.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async insertMembershipIfAbsent(row: NewTripMemberRow): Promise<TripMemberRow> {
      const existing = state.memberships.find((m) => m.tripId === row.tripId && m.userId === row.userId);
      if (existing) return existing;
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripMemberRow;
      state.memberships.push(created);
      return created;
    },
    async findMembers(tripId: string): Promise<TripMemberWithUser[]> {
      return state.memberships
        .filter((m) => m.tripId === tripId)
        .map((m) => ({
          id: m.id,
          tripId: m.tripId,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
          email: state.users.find((u) => u.id === m.userId)?.email ?? 'unknown@example.com',
        }));
    },
    async createInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      state.invites.push(created);
      return created;
    },
    async findInviteByToken(token: string): Promise<TripInviteRow | null> {
      return state.invites.find((i) => i.token === token) ?? null;
    },
    async findPendingInviteByEmail(tripId: string, email: string): Promise<TripInviteRow | null> {
      return (
        state.invites.find((i) => i.tripId === tripId && i.email === email && i.status === 'pending') ??
        null
      );
    },
    async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
      return state.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async markInviteAccepted(id: string): Promise<void> {
      const invite = state.invites.find((i) => i.id === id);
      if (invite) invite.status = 'accepted';
    },
  };

  return { repo: repo as unknown as TripsRepository, state };
}

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Lisbon in June',
    destination: 'Lisbon',
    startsAt: new Date('2024-06-10T00:00:00Z'),
    endsAt: new Date('2024-06-14T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripRow;

const memberRow = (over: Partial<TripMemberRow> = {}): TripMemberRow =>
  ({
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    role: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripMemberRow;

const inviteRow = (over: Partial<TripInviteRow> = {}): TripInviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'grace@example.com',
    token: 'tok-1',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripInviteRow;

const ada: CurrentUserPayload = { id: 'u1', email: 'ada@example.com' };
const grace: CurrentUserPayload = { id: 'u2', email: 'grace@example.com' };

const newTrip = {
  name: 'Lisbon in June',
  destination: 'Lisbon',
  startsAt: new Date('2024-06-10T00:00:00Z'),
  endsAt: new Date('2024-06-14T00:00:00Z'),
};

describe('TripsService.create', () => {
  it('creates the trip and makes the creator the owner member', async () => {
    const { repo, state } = fakeRepo();
    const svc = new TripsService(repo);

    const trip = await svc.create(newTrip, ada);

    expect(trip.name).toBe('Lisbon in June');
    expect(trip.destination).toBe('Lisbon');
    expect(typeof trip.id).toBe('string');
    expect(trip.startsAt).toBe('2024-06-10T00:00:00.000Z');
    expect(trip.endsAt).toBe('2024-06-14T00:00:00.000Z');
    expect(typeof trip.createdAt).toBe('string');

    expect(state.trips).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({ tripId: trip.id, userId: ada.id, role: 'owner' });
  });
});

describe('TripsService.invite', () => {
  const ownerState = (): Partial<FakeState> => ({
    trips: [tripRow()],
    memberships: [memberRow({ tripId: 't1', userId: 'u1', role: 'owner' })],
    users: [{ id: 'u1', email: 'ada@example.com' }],
  });

  it('creates a pending invite carrying a token when the owner invites by email', async () => {
    const { repo, state } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    const invite = await svc.invite('t1', { email: 'grace@example.com' }, ada);

    expect(invite.email).toBe('grace@example.com');
    expect(invite.status).toBe('pending');
    expect(invite.token).toBeTruthy();
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0].tripId).toBe('t1');
  });

  it('returns the existing pending invite when the same email is invited twice', async () => {
    const { repo, state } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    const first = await svc.invite('t1', { email: 'grace@example.com' }, ada);
    const second = await svc.invite('t1', { email: 'grace@example.com' }, ada);

    expect(second.id).toBe(first.id);
    expect(second.token).toBe(first.token);
    expect(second.status).toBe('pending');
    expect(state.invites).toHaveLength(1);
  });

  it('creates a separate invite for a different email', async () => {
    const { repo, state } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    const first = await svc.invite('t1', { email: 'grace@example.com' }, ada);
    const second = await svc.invite('t1', { email: 'lin@example.com' }, ada);

    expect(second.id).not.toBe(first.id);
    expect(second.email).toBe('lin@example.com');
    expect(state.invites).toHaveLength(2);
  });

  it('rejects a non-owner with forbidden and creates no invite', async () => {
    const { repo, state } = fakeRepo({
      ...ownerState(),
      memberships: [memberRow({ tripId: 't1', userId: 'u2', role: 'member' })],
      users: [
        { id: 'u1', email: 'ada@example.com' },
        { id: 'u2', email: 'grace@example.com' },
      ],
    });
    const svc = new TripsService(repo);

    await expect(svc.invite('t1', { email: 'ada@example.com' }, grace)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(state.invites).toHaveLength(0);
  });

  it('raises not_found for an unknown trip', async () => {
    const { repo } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    await expect(svc.invite('nope', { email: 'grace@example.com' }, ada)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('TripsService.accept', () => {
  const invitedState = (): Partial<FakeState> => ({
    trips: [tripRow()],
    memberships: [memberRow({ id: 'm1', tripId: 't1', userId: 'u1', role: 'owner' })],
    invites: [inviteRow({ tripId: 't1', email: 'grace@example.com', token: 'tok-1', status: 'pending' })],
    users: [
      { id: 'u1', email: 'ada@example.com' },
      { id: 'u2', email: 'grace@example.com' },
    ],
  });

  it('adds the invitee as a member and marks the invite accepted', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    const membership = await svc.accept('tok-1', grace);

    expect(membership.tripId).toBe('t1');
    expect(membership.userId).toBe('u2');
    expect(membership.email).toBe('grace@example.com');
    expect(membership.role).toBe('member');
    expect(state.invites[0].status).toBe('accepted');
    expect(state.memberships.filter((m) => m.userId === 'u2')).toHaveLength(1);

    const detail = await svc.getById('t1', grace);
    expect(detail.members.some((m) => m.userId === 'u2' && m.role === 'member')).toBe(true);
    expect(detail.pendingInvites).toHaveLength(0);
  });

  it('treats a second accept of the same token as a no-op returning the same membership', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    const first = await svc.accept('tok-1', grace);
    const second = await svc.accept('tok-1', grace);

    expect(second.id).toBe(first.id);
    expect(second.userId).toBe('u2');
    expect(second.role).toBe('member');
    expect(state.memberships.filter((m) => m.userId === 'u2')).toHaveLength(1);
    expect(state.invites).toHaveLength(1);
  });

  it('raises not_found for an unknown token', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    await expect(svc.accept('nope', grace)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.memberships).toHaveLength(1);
    expect(state.invites[0].status).toBe('pending');
  });

  it('rejects a user the invite is not addressed to with forbidden', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    await expect(svc.accept('tok-1', ada)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.memberships.filter((m) => m.userId === 'u1' && m.role === 'member')).toHaveLength(0);
    expect(state.invites[0].status).toBe('pending');
  });
});

describe('TripsService.get', () => {
  const fullState = (): Partial<FakeState> => ({
    trips: [tripRow()],
    memberships: [
      memberRow({ id: 'm1', tripId: 't1', userId: 'u1', role: 'owner' }),
      memberRow({ id: 'm2', tripId: 't1', userId: 'u2', role: 'member' }),
    ],
    invites: [
      inviteRow({ id: 'i1', tripId: 't1', email: 'grace@example.com', token: 'tok-1', status: 'accepted' }),
      inviteRow({ id: 'i2', tripId: 't1', email: 'lin@example.com', token: 'tok-2', status: 'pending' }),
    ],
    users: [
      { id: 'u1', email: 'ada@example.com' },
      { id: 'u2', email: 'grace@example.com' },
    ],
  });

  it('returns the trip with its members and pending invites to a member', async () => {
    const { repo } = fakeRepo(fullState());
    const svc = new TripsService(repo);

    const detail = await svc.getById('t1', ada);

    expect(detail.id).toBe('t1');
    expect(detail.name).toBe('Lisbon in June');
    expect(detail.members).toHaveLength(2);
    expect(detail.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
    expect(detail.members.find((m) => m.userId === 'u1')?.email).toBe('ada@example.com');
    expect(detail.members.find((m) => m.userId === 'u2')?.email).toBe('grace@example.com');
    expect(detail.pendingInvites).toHaveLength(1);
    expect(detail.pendingInvites[0]).toMatchObject({ email: 'lin@example.com', status: 'pending' });
    // Invite tokens never leak through the trip view.
    expect(JSON.stringify(detail)).not.toContain('tok-');
  });

  it('answers a non-member with not_found, exactly as for a missing trip', async () => {
    const { repo } = fakeRepo(fullState());
    const svc = new TripsService(repo);
    const stranger: CurrentUserPayload = { id: 'u9', email: 'stranger@example.com' };

    await expect(svc.getById('t1', stranger)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.getById('does-not-exist', stranger)).rejects.toMatchObject({ code: 'not_found' });
  });
});
```
