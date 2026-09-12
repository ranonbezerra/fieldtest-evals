# repair1-set

## reasoning

```
Let me analyze the errors:

1. **drizzle/schema.ts(41,3)**: The `tripMembers` table uses a callback that returns `UniqueConstraintBuilder[]` (an array), but the type expects `PgTableExtraConfig` (an object). In Drizzle, the third argument to `pgTable` should return an object with keys like `{ unique: [...] }` or use the `unique()` function differently. Let me think about this...

Actually, looking at the Drizzle ORM API, the third argument to `pgTable` is a callback that receives the table columns and returns a `PgTableExtraConfig`. The correct way to define a unique constraint in Drizzle's `pgTable` third argument is:

```ts
(t) => ({
  unique: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
})
```

Wait, let me reconsider. Looking at Drizzle docs, the `pgTable` function's third parameter is:

```ts
(t) => ({
  // table-level constraints
})
```

But actually, in newer versions of Drizzle, you can use:
```ts
(t) => ({
  tripIdUserId: [unique().on(t.tripId, t.userId)],
})
```

Hmm, but the error says `PgTableExtraConfig` is expected, and the return type needs to be that type. Let me look at what `PgTableExtraConfig` is. It's essentially a record of constraint names to arrays of constraints.

Actually, looking more carefully at Drizzle's API, the correct pattern for the third argument of `pgTable` is:

```ts
(t) => ({
  // each key is a name, value is an array of constraints
  uq_trip_members_trip_user: [unique().on(t.tripId, t.userId)],
})
```

Wait no. Let me re-read the error. The error says:

```
Argument of type '(t: {...}) => UniqueConstraintBuilder[]' is not assignable to parameter of type '(self: {...}) => PgTableExtraConfig'.
  Type 'UniqueConstraintBuilder[]' is not assignable to type 'PgTableExtraConfig'.
    Index signature for type 'string' is missing in type 'UniqueConstraintBuilder[]'.
```

So the callback returns `UniqueConstraintBuilder[]` but should return `PgTableExtraConfig`. The `PgTableExtraConfig` is an object (with index signature for string). So the fix is to wrap it in an object:

```ts
(t) => ({
  uq_trip_members_trip_id_user_id: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
})
```

Wait, but that's a named constraint. Let me think about what the correct Drizzle API is here.

Actually, looking at Drizzle source, `PgTableExtraConfig` is:
```ts
type PgTableExtraConfig = {
  [key: string]: PgTableConstraint[];
}
```

So the callback should return an object where each key maps to an array of constraints. The fix would be:

```ts
(t) => ({
  trip_id_user_id: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
})
```

Hmm, but actually I need to check what version of Drizzle is being used. In some versions, you can just do:

```ts
(t) => ({
  uq_trip_members_trip_id_user_id: [unique().on(t.tripId, t.userId)],
})
```

But the original code has `unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)` which suggests they're using a named unique constraint. Let me just wrap it in an object with a key.

Actually wait - I need to reconsider. Let me look at the Drizzle docs more carefully.

In Drizzle ORM for PostgreSQL, the `pgTable` function signature is:
```ts
pgTable(name, columns, extraConfig)
```

Where `extraConfig` is a function that takes the columns and returns an object of constraints. Each key in the returned object is a name for the constraint group, and the value is an array of `PgTableConstraint`.

So the fix is:
```ts
(t) => ({
  uq_trip_members: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
})
```

Wait, but actually I recall that in Drizzle, the unique constraint at the table level works differently. Let me look at what the correct pattern is.

Looking at Drizzle docs examples:
```ts
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
}, (users) => [
  uniqueIndex("users_email_key").on(users.email)
])
```

Hmm, but that's an index, not a constraint. Let me check...

Actually, I think in Drizzle, the third argument can return either an array of constraints or an object. But the error clearly says it expects `PgTableExtraConfig` which is an object with string index signature.

Let me look at this differently. The error message says:
- Current return type: `UniqueConstraintBuilder[]`
- Expected return type: `PgTableExtraConfig`
- The issue: `Index signature for type 'string' is missing in type 'UniqueConstraintBuilder[]'`

So `PgTableExtraConfig` is `{ [key: string]: ... }` and we need to return an object, not an array.

The fix: wrap the array in an object with a key name:

```ts
(t) => ({
  uq_trip_members_trip_user: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
})
```

Actually, I just realized I should look at what `unique()` returns in Drizzle. In Drizzle, `unique()` at the table level returns a `UniqueConstraint`. The `PgTableExtraConfig` type is:

```ts
export type PgTableExtraConfig = {
  [key: string]: PgTableConstraint[];
}
```

So we need:
```ts
(t) => ({
  someKey: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
})
```

The key name doesn't really matter for the database - it's just a label for the constraint group in the Drizzle config. I'll use a descriptive key.

2. **trips.service.ts(102,22) and (154,37)**: `AppError.forbidden` doesn't exist. I need to check what static methods `AppError` has. Since I can't see the `AppError` file, I need to infer from the errors. The service uses `AppError.notFound` (which works based on the reference) and `AppError.conflict` (which also seems to work since it's not in the error list). The missing one is `AppError.forbidden`.

Looking at common patterns, `AppError` likely has methods like `notFound`, `conflict`, `unprocessableEntity`, etc. For a 403 forbidden, it might be called something else. Common alternatives:
- `AppError.forbidden` - doesn't exist per the error
- Maybe it's a generic constructor? Like `new AppError(403, 'code', 'message')`
- Or maybe there's no specific `forbidden` factory and you need to use a different approach

Since I can't see the AppError class, I need to figure out what's available. The fact that `AppError.notFound` and `AppError.conflict` work but `AppError.forbidden` doesn't suggests the class has specific static methods but not one for forbidden.

Common patterns in such classes:
- They might have a generic `create` or just use `new AppError(status, code, message, details)`
- Or they might have `unauthorized` for 401 but not `forbidden` for 403

Since the task says "errors use the existing `AppError` codes" and I can see that `notFound` and `conflict` are static methods that work, I need to figure out what to use for 403.

Looking at the convention from the task description:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So for a 403, the code would be something like `forbidden` or `access_denied`.

Since I can't see the AppError definition, and the error says `forbidden` doesn't exist, the most likely alternatives are:
1. There's a generic constructor: `new AppError(403, 'forbidden', 'message', details)`
2. There's a differently-named static method

Given that the reference shows `AppError.notFound('user not found', { id: userId })` and `AppError.conflict('message')`, the pattern seems to be `AppError.<method>(message, details?)`.

For a 403, common naming would be... let me think. If `notFound` maps to 404 and `conflict` maps to 409, then `forbidden` would map to 403. But the error says it doesn't exist.

Maybe the class only has a limited set of static methods and for 403 you need to use the constructor directly? Or maybe it's called `unauthorized` (but that's typically 401)?

Actually, I think the safest approach given the information is to use the constructor directly. A typical AppError class might look like:

```ts
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details: object = {}) {
    super(message);
  }
  
  static notFound(message: string, details: object = {}) {
    return new AppError(404, 'resource_not_found', message, details);
  }
  
  static conflict(message: string, details: object = {}) {
    return new AppError(409, 'conflict', message, details);
  }
  
  // ... maybe others but not forbidden
}
```

So for 403, I'd use: `new AppError(403, 'forbidden', 'message', details)`

But wait, I'm guessing. Let me think about what's most likely given the conventions. The error envelope says `code` is `snake_case`. Common codes:
- 404: `resource_not_found`
- 409: `conflict`
- 403: `forbidden` or `access_denied`

I'll go with `new AppError(403, 'forbidden', message, details)` as that's the most standard approach when a static factory doesn't exist.

Hmm, but actually I realize I should think about this more carefully. The reference code in the service uses:
- `AppError.notFound('user not found', { id: userId })` 
- `AppError.notFound('trip not found', { tripId })`
- `AppError.forbidden('only the trip owner can send invites', { tripId })` ← ERROR
- `AppError.conflict('this invite has been declined')` 
- `AppError.conflict('this invite has already been accepted')`
- `AppError.forbidden('only members can view this trip', { tripId })` ← ERROR

So `notFound` and `conflict` exist as static methods but `forbidden` doesn't. The fix is to replace `AppError.forbidden(...)` with the appropriate alternative.

Given the pattern, I'll use `new AppError(403, 'forbidden', message, details)`. This is the most reasonable assumption.

Wait, but what if AppError has a different constructor signature? Let me think...

The static methods seem to be:
- `AppError.notFound(message: string, details?: object)` → 404, code `resource_not_found`
- `AppError.conflict(message: string, details?: object)` → 409, code `conflict`

A reasonable constructor would be:
- `new AppError(status: number, code: string, message: string, details?: object)`

So: `new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId })`

I'll go with this approach.

Now let me write the fixed files:

### drizzle/schema.ts
Fix line 41: wrap the unique constraint in an object.

### src/modules/trips/trips.service.ts
Fix lines 102 and 154: replace `AppError.forbidden(...)` with `new AppError(403, 'forbidden', ...)`.

Let me write the complete files.
```

## reply

### drizzle/schema.ts
```ts
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
    tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq_trip_members_trip_user: [unique('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)],
  }),
);

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type NewTripMemberRow = typeof tripMembers.$inferInsert;

export const tripInvites = pgTable('trip_invites', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripInviteRow = typeof tripInvites.$inferSelect;
export type NewTripInviteRow = typeof tripInvites.$inferInsert;
```

### src/modules/trips/trips.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { TripInviteRow, TripMemberRow, TripRow, UserRow } from '../../../drizzle/schema.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { PendingInvite, Trip, TripInvite, TripMember } from './entities/trip.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toMember(member: TripMemberRow, user: UserRow): TripMember {
    return {
      id: member.id,
      userId: member.userId,
      email: user.email,
      displayName: user.displayName,
      role: member.role as TripMember['role'],
      createdAt: member.createdAt.toISOString(),
    };
  }

  private toInvite(invite: TripInviteRow): TripInvite {
    return {
      id: invite.id,
      email: invite.email,
      token: invite.token,
      status: invite.status as TripInvite['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toPendingInvite(invite: TripInviteRow): PendingInvite {
    return {
      id: invite.id,
      email: invite.email,
      status: invite.status as PendingInvite['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toTrip(trip: TripRow, members: TripMember[], pendingInvites: PendingInvite[]): Trip {
    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startsAt: trip.startsAt.toISOString(),
      endsAt: trip.endsAt.toISOString(),
      createdAt: trip.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  /** The stub auth passes ids the database may not know; surface a 404 instead of an FK 500. */
  private async requireUserRow(userId: string): Promise<UserRow> {
    const user = await this.repo.findUserRow(userId);
    if (!user) throw AppError.notFound('user not found', { id: userId });
    return user;
  }

  private async assemble(trip: TripRow): Promise<Trip> {
    const [membersWithUsers, pendingInvites] = await Promise.all([
      this.repo.findMembersWithUsers(trip.id),
      this.repo.findPendingInvites(trip.id),
    ]);
    return this.toTrip(
      trip,
      membersWithUsers.map(({ member, user }) => this.toMember(member, user)),
      pendingInvites.map((invite) => this.toPendingInvite(invite)),
    );
  }

  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const creator = await this.requireUserRow(user.id);
    const trip = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: creator.id,
      role: 'owner',
    });
    return this.assemble(trip);
  }

  async createInvite(tripId: string, dto: CreateInviteDto, user: CurrentUserPayload): Promise<TripInvite> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const caller = await this.repo.findMember(tripId, user.id);
    if (!caller || caller.role !== 'owner') {
      throw new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId });
    }

    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) return this.toInvite(existing);

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomBytes(24).toString('hex'),
      status: 'pending',
    });
    return this.toInvite(invite);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found');

    // ASSUMPTION: the token is the invite credential; the spec does not require
    // the caller's email to match the invite's, so it is not checked.
    const userRow = await this.requireUserRow(user.id);

    const existing = await this.repo.findMember(invite.tripId, user.id);
    if (existing) {
      // Already in: nothing changes; a still-pending invite just settles.
      if (invite.status === 'pending') await this.repo.markInviteAccepted(invite.id);
      return this.toMember(existing, userRow);
    }

    if (invite.status !== 'pending') {
      throw AppError.conflict(
        invite.status === 'declined' ? 'this invite has been declined' : 'this invite has already been accepted',
      );
    }

    await this.repo.markInviteAccepted(invite.id);
    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    });
    return this.toMember(member, userRow);
  }

  async getTrip(tripId: string, user: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership) throw new AppError(403, 'forbidden', 'only members can view this trip', { tripId });

    return this.assemble(trip);
  }
}
```
