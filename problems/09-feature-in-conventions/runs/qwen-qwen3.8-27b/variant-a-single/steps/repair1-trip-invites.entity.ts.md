# repair1-trip-invites.entity.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/modules/trips/entities/trip-invites.entity.ts`:

1. `src/modules/trips/trips.repository.ts(9,66): error TS2307: Cannot find module './entities/trip-invites.entity' or its corresponding type declarations.`
```

## reply

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const inviteStatusEnum = pgEnum('invite_status', [
  'pending',
  'accepted',
  'declined',
]);

export const tripInvites = pgTable('trip_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').notNull(),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  status: inviteStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```
