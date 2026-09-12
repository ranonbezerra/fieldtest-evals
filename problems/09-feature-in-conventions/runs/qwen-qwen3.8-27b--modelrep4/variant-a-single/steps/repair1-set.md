# repair1-set

## reasoning

```
The error is clear. The `pgTable` function in Drizzle ORM expects the third argument (table extra config) to return a `PgTableExtraConfig` object, not an array. 

Looking at the Drizzle ORM API, the third parameter of `pgTable` should return an object where you can define constraints. The correct way to add unique constraints in Drizzle is:

```ts
(table) => ({
  tripIdUserIdUnique: unique('memberships_trip_id_user_id_key').on(table.tripId, table.userId),
})
```

Or alternatively, you can use `uniqueIndex` or just the `unique` constraint inside an object.

Let me look at the Drizzle ORM API more carefully. The third argument to `pgTable` is a function that receives the table and returns a `PgTableExtraConfig`. This is an object (not an array) where keys are constraint names and values are constraint builders.

So the fix is:
- Line 41: Change `(table) => [unique('memberships_trip_id_user_id_key').on(table.tripId, table.userId)]` to `(table) => ({ tripUserId: unique('memberships_trip_id_user_id_key').on(table.tripId, table.userId) })`
- Line 58: Change `(table) => [unique('invites_trip_id_email_key').on(table.tripId, table.email)]` to `(table) => ({ tripEmail: unique('invites_trip_id_email_key').on(table.tripId, table.email) })`

Wait, let me reconsider. In Drizzle ORM, the `PgTableExtraConfig` type is essentially `{ [key: string]: ConstraintBuilder }` or similar. The key becomes part of the naming convention for the constraint.

Actually, looking at Drizzle's documentation and source, the third parameter returns an object where each property is a constraint. The property name is used to prefix or name the constraint in the generated SQL.

So the correct syntax would be:

```ts
(table) => ({
  tripIdUserId: unique('memberships_trip_id_user_id_key').on(table.tripId, table.userId),
})
```

Wait, but if you're providing an explicit name with `unique('memberships_trip_id_user_id_key')`, then the property name doesn't matter as much for the SQL. Let me just use a reasonable key name.

Actually, looking at this more carefully - in Drizzle ORM, the `unique` function returns a `UniqueConstraintBuilder`. The third argument to `pgTable` should return a `PgTableExtraConfig` which is an object of constraints.

Let me write the fix:

```ts
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripIdUserId: unique('memberships_trip_id_user_id_key').on(table.tripId, table.userId),
  }),
);
```

and

```ts
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripIdEmail: unique('invites_trip_id_email_key').on(table.tripId, table.email),
  }),
);
```

This should fix both errors since the return type is now an object (matching `PgTableExtraConfig`) instead of an array.
```

## reply

### drizzle/schema.ts
```ts
import { date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripIdUserId: unique('memberships_trip_id_user_id_key').on(table.tripId, table.userId),
  }),
);

export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembershipRow = typeof memberships.$inferInsert;

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripIdEmail: unique('invites_trip_id_email_key').on(table.tripId, table.email),
  }),
);

export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
```
