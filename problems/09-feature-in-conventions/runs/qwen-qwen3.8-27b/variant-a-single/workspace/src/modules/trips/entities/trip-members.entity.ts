import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const tripMembers = pgTable('trip_members', {
  id: text('id').primaryKey(),
  tripId: text('trip_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});
