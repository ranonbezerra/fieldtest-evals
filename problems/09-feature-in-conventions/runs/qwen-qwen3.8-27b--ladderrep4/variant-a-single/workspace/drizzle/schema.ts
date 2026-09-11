import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export type MemberRole = 'owner' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'declined';

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

/**
 * The unique constraint on (trip, user) is what makes "accepting twice" safe
 * under concurrency: a duplicate insert loses to the constraint instead of
 * racing against the check-then-insert in the service.
 */
export const tripMembers = pgTable(
  'trip_members',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<MemberRole>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripUserUnique: unique('trip_members_trip_user_key').on(t.tripId, t.userId),
  }),
);

export const tripInvites = pgTable(
  'trip_invites',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    status: text('status').notNull().default('pending').$type<InviteStatus>(),
    invitedBy: uuid('invited_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pendingUnique: uniqueIndex('trip_invites_pending_key')
      .on(t.tripId, t.email)
      .where(sql`${t.status} = 'pending'`),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type NewTripMemberRow = typeof tripMembers.$inferInsert;

export type TripInviteRow = typeof tripInvites.$inferSelect;
export type NewTripInviteRow = typeof tripInvites.$inferInsert;
