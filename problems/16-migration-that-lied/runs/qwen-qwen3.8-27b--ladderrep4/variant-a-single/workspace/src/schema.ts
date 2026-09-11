import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  publicRef: text('public_ref').notNull(),
  searchKey: text('search_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
