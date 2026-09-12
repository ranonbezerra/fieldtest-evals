import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Users table – unchanged from scaffold.
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

/**
 * Trips table.
 */
export const trips = pgTable('trips', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  destination: text('destination').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

/**
 * Trip members – a user can be an owner or a regular member.
 * Unique on (trip_id, user_id) enforced by service logic.
 */
export const tripMembers = pgTable('trip_members', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type NewTripMemberRow = typeof tripMembers.$inferInsert;

/**
 * Trip invites – one per email per trip while pending.
 */
export const tripInvites = pgTable('trip_invites', {
  id: uuid('id').primaryKey(),
  token: uuid('token').notNull().unique(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  status: text('status')
    .notNull()
    .default('pending'), // 'pending' | 'accepted' | 'declined'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TripInviteRow = typeof tripInvites.$inferSelect;
export type NewTripInviteRow = typeof tripInvites.$inferInsert;
