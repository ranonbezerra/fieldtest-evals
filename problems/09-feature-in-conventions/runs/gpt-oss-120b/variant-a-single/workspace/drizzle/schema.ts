import { pgTable, text, timestamp, uuid, varchar, date, integer } from 'drizzle-orm/pg-core';

/**
 * Existing users table.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Trips table.
 */
export const trips = pgTable('trips', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  destination: varchar('destination', { length: 100 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

/**
 * Trip members table.
 */
export const tripMembers = pgTable('trip_members', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MemberRow = typeof tripMembers.$inferSelect;
export type NewMemberRow = typeof tripMembers.$inferInsert;

/**
 * Invites table.
 */
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id),
  email: text('email').notNull(),
  token: uuid('token').notNull().unique(),
  status: varchar('status', { length: 10 }).notNull().default('pending'), // pending | accepted | declined
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
