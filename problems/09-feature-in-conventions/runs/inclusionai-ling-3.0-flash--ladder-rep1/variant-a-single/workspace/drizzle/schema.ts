import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

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
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable('members', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueTripUser: unique('members_trip_id_user_id_unique').on(table.tripId, table.userId),
}));

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;
export type MemberRow = typeof members.$inferSelect;
export type NewMemberRow = typeof members.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
