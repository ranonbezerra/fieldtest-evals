# repair1-set

## reasoning

```
Let me analyze the error carefully.

The error is in `drizzle/schema.ts` at line 45, column 3. It's about the third argument to `pgTable` for `tripMembers`.

The issue is that in Drizzle ORM, the third argument to `pgTable` (the table extra config callback) has a specific return type. Let me look at what's happening:

The code has:
```ts
(t) => [uniqueIndex('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)]
```

The error says:
- Argument type: `(t: {...}) => IndexBuilder[]`
- Expected type: `(self: {...}) => PgTableExtraConfig`
- `IndexBuilder[]` is not assignable to `PgTableExtraConfig`

So the callback needs to return a `PgTableExtraConfig` object, not an array. In Drizzle ORM, the `PgTableExtraConfig` is an object that can have properties like `indices`, `foreignKeys`, `check`, etc.

The correct way to pass indices in Drizzle's `pgTable` is:

```ts
(t) => ({ indices: [uniqueIndex('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)] })
```

Wait, let me reconsider. Looking at the Drizzle ORM API:

The third parameter to `pgTable` is `extraConfig` which is `(self) => PgTableExtraConfig`.

`PgTableExtraConfig` has properties like:
- `indices?: IndexBuilder[]`
- `foreignKeys?: ForeignKeyBuilder[]`
- `check?: CheckBuilder[]`

So the fix is to wrap the array in an object with the `indices` key:

```ts
(t) => ({ indices: [uniqueIndex('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)] })
```

This is the only error in the entire output. It's a single mistake in a single file. The fix is straightforward.

Now I need to produce the complete file with this one change.
```

## reply

### drizzle/schema.ts
```ts
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ indices: [uniqueIndex('trip_members_trip_id_user_id_key').on(t.tripId, t.userId)] }),
);

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type NewTripMemberRow = typeof tripMembers.$inferInsert;

export const tripInvites = pgTable('trip_invites', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  status: text('status', { enum: ['pending', 'accepted', 'declined'] })
    .notNull()
    .default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripInviteRow = typeof tripInvites.$inferSelect;
export type NewTripInviteRow = typeof tripInvites.$inferInsert;
```
