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
