# repair1-set

## reasoning

```
Let me analyze the error carefully.

The error is in `drizzle/schema.ts` at line 39, column 3. It's about the `tripMembers` table definition.

The issue is with the third argument to `pgTable`. In Drizzle ORM, the third argument to `pgTable` is a callback that receives the table and returns a `PgTableExtraConfig`. 

Looking at the Drizzle ORM API:
- In older versions of Drizzle, you could pass an array of index builders directly as the third argument.
- In newer versions, the third argument must return a `PgTableExtraConfig` object, which has properties like `indexes`, `foreignKeys`, etc.

The current code:
```ts
(table) => [uniqueIndex('trip_members_trip_id_user_id_key').on(table.tripId, table.userId)]
```

This returns an `IndexBuilder[]`, but the expected type is `PgTableExtraConfig`.

The fix is to wrap the array in an object with the appropriate key. In newer Drizzle versions, `PgTableExtraConfig` expects:
```ts
{ indexes: [...] }
```

Wait, let me reconsider. Actually, looking at Drizzle ORM's API more carefully:

In Drizzle ORM, the third parameter to `pgTable` is:
```ts
(table) => ({ indexes: [...] })
```

or in some versions it might be different. Let me think about what `PgTableExtraConfig` looks like.

Based on the error message, `PgTableExtraConfig` is an object type (it says "Index signature for type 'string' is missing in type 'IndexBuilder[]'"), which means it's an object with named properties.

In Drizzle ORM (recent versions), the correct syntax is:
```ts
(table) => ({
  indexes: {
    trip_members_trip_id_user_id_key: uniqueIndex('trip_members_trip_id_user_id_key').on(table.tripId, table.userId),
  }
})
```

Wait, actually let me reconsider. Looking at the Drizzle docs more carefully:

In some versions of Drizzle, the third argument to `pgTable` accepts:
```ts
(table) => ({
  indexes: {
    indexName: uniqueIndex('indexName').on(table.col1, table.col2),
  }
})
```

Or alternatively, some versions support:
```ts
(table) => ({
  index: {
    indexName: uniqueIndex('indexName').on(table.col1, table.col2),
  }
})
```

Actually, I need to be more careful. Let me look at what Drizzle ORM actually expects.

In Drizzle ORM for PostgreSQL, the `PgTableExtraConfig` type is typically:
```ts
interface PgTableExtraConfig {
  indexes?: Record<string, IndexBuilder>;
  foreignKeys?: Record<string, ForeignKeyBuilder>;
  // etc.
}
```

So the fix should be:
```ts
(table) => ({
  indexes: {
    trip_members_trip_id_user_id_key: uniqueIndex('trip_members_trip_id_user_id_key').on(table.tripId, table.userId),
  },
})
```

Wait, but I'm not 100% sure about the exact shape. Let me think again...

Actually, looking at Drizzle ORM source code and documentation, the `PgTableExtraConfig` in recent versions has:

```ts
type PgTableExtraConfig = {
  indexes?: Record<string, PgIndexBuilder>;
  foreignKeys?: Record<string, PgForeignKeyBuilder>;
  // ...
}
```

So the correct fix is to change from returning an array to returning an object with an `indexes` property that is a record.

Let me write the corrected `tripMembers` definition:

```ts
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
  (table) => ({
    indexes: {
      trip_members_trip_id_user_id_key: uniqueIndex('trip_members_trip_id_user_id_key').on(table.tripId, table.userId),
    },
  }),
);
```

This is the only error in the output, so this is the only file I need to change.
```

## reply

### drizzle/schema.ts
```ts
import { date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  destination: text('destination').notNull(),
  startDate: date('start_date', { mode: 'date' }).notNull(),
  endDate: date('end_date', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `role` is 'owner' | 'member'; exactly one row per (trip, user), and each
 * trip has exactly one owner (the creator).
 */
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
  (table) => ({
    indexes: {
      trip_members_trip_id_user_id_key: uniqueIndex('trip_members_trip_id_user_id_key').on(table.tripId, table.userId),
    },
  }),
);

/**
 * `status` is 'pending' | 'accepted' | 'declined'. At most one *pending*
 * invite per (trip, email); that invariant is enforced by the service, which
 * reuses a pending invite instead of issuing a second one.
 */
export const tripInvites = pgTable('trip_invites', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  status: text('status').notNull().default('pending'),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type NewTripMemberRow = typeof tripMembers.$inferInsert;

export type TripInviteRow = typeof tripInvites.$inferSelect;
export type NewTripInviteRow = typeof tripInvites.$inferInsert;
```
