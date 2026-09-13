# solution

## reasoning

```
Let me analyze the task carefully.

I need to implement a "trips" feature for a NestJS API using Drizzle ORM and PostgreSQL. Let me review the requirements:

1. **POST /trips** — create trip (name, destination, date range). Creator becomes `owner` member.
2. **POST /trips/:id/invites** — owner invites by email; invite has a token and `pending/accepted/declined` status; inviting the same email twice returns the existing pending invite.
3. **POST /invites/:token/accept** — accepting adds the user as `member`; accepting twice is a no-op returning the membership.
4. **GET /trips/:id** — trip with members and pending invites; only members can see it.

Key conventions:
- Modules at `src/modules/trips/` with controller, service, repository, dto/, entities/
- Controllers call services; services call repositories; ONLY repositories import Drizzle
- All endpoints return `{ ok, data | error }` envelope via `ApiResult<T>`
- Schema changes via Drizzle migrations in `drizzle/`
- snake_case columns, `created_at`/`updated_at` on every table
- Tests in `trips.service.spec.ts`, repository faked at interface
- Module registration line in `app.module.ts`

Let me plan the files:

**Schema changes (drizzle/)**:
I need tables:
- `trips` — id, name, destination, starts_at, ends_at, created_at, updated_at
- `members` — id, trip_id, user_id, role (owner/member), created_at, updated_at
- `invites` — id, trip_id, email, token, status (pending/accepted/declined), created_at, updated_at

I need a migration file in `drizzle/` and update the schema.ts.

**Module files**:
- `src/modules/trips/trips.module.ts`
- `src/modules/trips/trips.controller.ts`
- `src/modules/trips/trips.service.ts`
- `src/modules/trips/trips.repository.ts`
- `src/modules/trips/dto/create-trip.dto.ts`
- `src/modules/trips/dto/invite-member.dto.ts`
- `src/modules/trips/entities/trip.entity.ts`
- `src/modules/trips/entities/member.entity.ts`
- `src/modules/trips/entities/invite.entity.ts`
- `src/modules/trips/trips.service.spec.ts`

Let me think about the data model more carefully:

**Trips table**: id, name, destination, starts_at, ends_at, created_at, updated_at
**Members table**: id, trip_id, user_id, role, created_at, updated_at
**Invites table**: id, trip_id, email, token, status, created_at, updated_at

Now let me think about the endpoints:

1. `POST /trips` — body: name, destination, startDate, endDate (or similar). The creator (current user) becomes owner member.
2. `POST /trips/:id/invites` — body: email. Only owner can invite. Creates invite with token and pending status. If same email already has a pending invite, return it.
3. `POST /invites/:token/accept` — finds invite by token, adds user as member (if not already), returns membership. No-op if already accepted.
4. `GET /trips/:id` — returns trip with members and pending invites. Only members can see it. Non-member gets not-found.

Let me think about the DTOs and request body types. Looking at the scaffold's pattern, they use zod schemas.

For the create trip DTO, fields would be: name, destination, startDate, endDate (but mapped to snake_case in DB).

Wait, let me look at the convention more carefully. The scaffold uses `camelCase` in TypeScript and `snake_case` in DB via Drizzle's explicit mapping.

Let me now design all the files.

**drizzle/schema.ts** — add trips, members, invites tables.

For the migration, I need to create a file like `drizzle/0001_trips.sql` and update the journal.

Actually, let me check what's expected. The task says "Every schema change ships with a migration." So I need a migration SQL file in `drizzle/`.

Let me think about what the migration should contain:

```sql
CREATE TABLE "trips" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "destination" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "members" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("trip_id", "user_id")
);

CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id"),
  "email" text NOT NULL,
  "token" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("trip_id", "email")
);
```

Wait, the unique constraint on (trip_id, email) for invites — this helps with "inviting the same email twice returns the existing pending invite". But the spec says specifically "pending invite" — so if there's a declined invite and you invite again, you create a new pending one? Let me re-read...

"Inviting the same email twice returns the existing pending invite rather than creating a second one or erroring."

So it's about the same email for the same trip — return the existing pending invite. If there's already a non-pending invite, should we create a new pending one? The spec says "inviting the same email twice returns the existing pending invite" — I think this means: check if there's already a pending invite for this trip+email, and if so return it. Otherwise create a new one.

Actually, let me think about it differently. The unique constraint on (trip_id, email) makes this simpler — you just try to insert, and if it conflicts, return the existing one. But then you can't have both pending and declined for the same email. Let me keep the unique constraint on (trip_id, email) and handle it in the service: check for existing, if found return it (regardless of status), if not create new. Actually the spec says specifically "pending invite" — so perhaps only check for pending ones.

Let me re-read: "inviting the same email twice returns the existing pending invite rather than creating a second one or erroring."

I think the behavior is: if there's already a pending invite for this trip+email combination, return it. Otherwise create a new invite. If there's a declined one but no pending, create a new one.

For the unique constraint, I'll put it on (trip_id, email) in the DB but handle it in the service logic. Actually, with the unique constraint, if a declined invite exists, trying to insert a new one for the same email will fail. So maybe I should handle the upsert logic in the service.

Actually, let me keep it simpler and not add a unique constraint on (trip_id, email) in the schema. The service logic will check for existing pending invites first. The "accept" endpoint needs a unique constraint on (trip_id, user_id) as the spec mentions.

Wait, for the members table, the spec explicitly says: "Make that structural: a unique constraint on (trip, user) is worth more than a check-then-insert, which has a race."

So members table MUST have a unique constraint on (trip_id, user_id).

For invites, I'll keep a unique constraint on token (to look up by token efficiently), and handle the "same email twice" logic in the service.

Let me finalize the schema:

**trips**: id (pk), name, destination, starts_at, ends_at, created_at, updated_at
**members**: id (pk), trip_id (fk), user_id (fk), role, created_at, updated_at, UNIQUE(trip_id, user_id)
**invites**: id (pk), trip_id (fk), email, token (unique), status, created_at, updated_at

Now let me think about the entities (API return types):

**Trip entity**: id, name, destination, startsAt, endsAt, createdAt, members, pendingInvites
Actually, for GET /trips/:id, it should return the trip with members and pending invites. So the trip entity might include those, or the API response shape might combine them.

Let me define:
- Trip entity: id, name, destination, startsAt, endsAt, createdAt
- Member entity: id, tripId, userId, role, createdAt
- Invite entity: id, tripId, email, token, status, createdAt

And the GET trip response could be: { trip: Trip, members: Member[], pendingInvites: Invite[] }

Now let me design the service methods:

1. `create(dto, currentUser)` — creates trip, adds creator as owner member, returns trip with members
2. `invite(tripId, email, currentUser)` — checks ownership, checks existing pending invite, creates or returns existing
3. `acceptInvite(token, currentUser)` — finds invite by token, adds user as member (with unique constraint handling), returns membership
4. `getById(tripId, currentUser)` — checks membership, returns trip with members and pending invites

Let me now write all the code.

For the DTOs, I'll follow the pattern from create-user.dto.ts using zod.

Create trip DTO:
```ts
export const createTripSchema = z.object({
  name: z.string().min(1).max(100),
  destination: z.string().min(1).max(200),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});
export type CreateTripDto = z.infer<typeof createTripSchema>;
```

Invite DTO:
```ts
export const inviteMemberSchema = z.object({
  email: z.string().email(),
});
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
```

Now let me think about the repository methods I'll need:

TripsRepository:
- `insert(trip): Promise<TripRow>` — create trip
- `findById(id): Promise<TripRow | null>` — find trip
- `findMember(tripId, userId): Promise<MemberRow | null>` — check membership
- `insertMember(member): Promise<MemberRow>` — add member
- `findPendingInvite(tripId, email): Promise<InviteRow | null>` — check pending invite
- `insertInvite(invite): Promise<InviteRow>` — create invite
- `findInviteByToken(token): Promise<InviteRow | null>` — lookup by token

Wait, looking at the scaffold's convention, the module is `src/modules/trips/` and the repository is `trips.repository.ts`. But we have multiple concerns (trips, members, invites). Let me think about this...

The spec says: "src/modules/trips/" — it's one module. The repository can have multiple methods for all the tables it needs. Let me keep it as one `TripsRepository` that handles trips, members, and invites tables.

Actually, looking at the spec again: "trips.service.spec.ts with the repository faked at its interface" — so there's one repository type being faked.

Let me define the repository with all needed methods.

Now let me write all the files:

First, the schema update and migration.

Actually, wait. I need to be careful about the `@map` annotations or explicit column naming. Looking at the existing schema.ts for users:

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

So TypeScript properties are camelCase, DB columns are snake_case, explicitly mapped. Good.

Now let me write everything out.

For the migration file, I'll name it `0001_trips.sql` and update the journal.

Let me also think about how the `updated_at` will be handled — in the scaffold, they don't seem to have any update triggers, just defaults. I'll follow that pattern.

Let me also think about the `trips.module.ts` — it needs to import `AuthGuard` and use `CurrentUser` decorator. Actually, looking at the scaffold, the auth is handled at the controller level with `@UseGuards(AuthGuard)` and `@CurrentUser()`.

Wait, the scaffold's users module doesn't use `@UseGuards(AuthGuard)` on all endpoints. Let me check...

Looking at `users.controller.ts`:
- `create` has no guard (public)
- `me` has `@UseGuards(AuthGuard)`

For trips:
- `POST /trips` — needs auth (creator becomes owner)
- `POST /trips/:id/invites` — needs auth (must be owner)
- `POST /invites/:token/accept` — needs auth (the accepting user)
- `GET /trips/:id` — needs auth (must be member)

So all endpoints need auth. I'll use `@UseGuards(AuthGuard)` on all trips controller endpoints.

Now let me also think about what happens in the service vs controller. The controller validates and calls the service. The service has the business logic.

Let me now write all the files. I'll be thorough and complete.

One more consideration: the `created_at` and `updated_at` in the fake repository for tests — looking at the users service spec, dates are `new Date('2024-01-01T00:00:00Z')`. I'll follow this pattern.

Also, I need to register the module in `app.module.ts` — the spec says "plus the one line that registers the module." But the task also says "Deliver: module, migrations, tests, and nothing outside `src/modules/trips` + `drizzle/` except the module registration line." So I should include the app.module.ts change too? Actually wait, let me re-read...

"Deliver: module, migrations, tests, and nothing outside `src/modules/trips` + `drizzle/` except the module registration line."

So I should provide the registration line as a file? I think I need to provide `src/app.module.ts` since it's mentioned as something I need to modify.

Actually, I think the intent is that I should provide all files needed, and the app.module.ts is one of them. Let me include it.

Wait, but the instructions also say "Do not restate a file you are not changing." Since I AM changing app.module.ts (adding the TripsModule import), I should include it.

Let me now write all the code.

Let me also think about the trip response shape for GET /trips/:id. It should include:
- The trip details
- Its members
- Its pending invites

So the return type might be something like:
```ts
interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

Or maybe just a Trip with members and pendingInvites fields. Let me keep it as a separate response type.

Now, for the invite acceptance — "accepting twice is a no-op returning the membership." So:
1. Find invite by token
2. If invite not found → not_found
3. If invite status is 'accepted' → find existing membership, return it
4. If invite status is 'declined' → probably error? Or create new membership? Let me think... The spec says "accepting twice is a no-op returning the membership." It doesn't mention declined. I'll handle: if declined, return not_found or conflict. Actually, let me just handle it as: if invite status is not 'pending', and there's a membership, return it. If not, error.

Actually, let me simplify: 
- If invite not found → not_found
- If invite is pending → try to insert membership (unique constraint handles duplicate), return membership
- If invite is accepted → find membership, return it (no-op)
- If invite is declined → this is an edge case. Maybe return not_found or conflict. Let me just update the invite status and insert member anyway? No, I think declined means the invite was declined, so it shouldn't be accepted. Let me throw not_found or conflict. I'll go with: if not pending, check for existing membership. If found, return it. If not, throw not_found.

Hmm, actually let me re-read the spec: "accepting twice is a no-op that returns the membership, not an error and not a duplicate row."

This is specifically about the same user accepting the same invite twice. Since the invite has a unique token, the second time they'd try to accept the same token. So:
1. First accept: invite is pending → create membership → done
2. Second accept: invite is now accepted (we updated it) → find membership → return it

But wait, do we update the invite status when accepting? I think yes. Let me update the invite to 'accepted' on accept.

Actually, let me think about this more carefully. The flow:
1. User clicks accept on invite with token X
2. Find invite by token X
3. If not found → error
4. If already accepted → find membership, return it (no-op)
5. If pending → update status to accepted, insert membership (with unique constraint on trip+user), return membership
6. If declined → ??? Let me just error with not_found or conflict. I'll use conflict.

Wait, but "accepting twice is a no-op returning the membership" — what if they decline it first and then try to accept? I'll just handle declined as: check if membership exists, if so return it, otherwise error.

Let me also consider: what if a user is already a member (not through this invite)? The unique constraint on (trip_id, user_id) will prevent duplicate membership. So if they try to accept and are already a member, we should just return the existing membership.

Here's my refined flow for accept:
1. Find invite by token
2. If not found → not_found
3. Try to find existing membership for (trip_id from invite, user_id from current user)
4. If membership exists → return it (no-op, whether invite was accepted or not)
5. If no membership → insert membership (with unique constraint protection), return it
6. Also update invite status to 'accepted' if it was 'pending'

Actually, let me make it even cleaner:
1. Find invite by token → not found → not_found
2. Check for existing membership (trip_id, user_id) → if found, return it (this handles "accepting twice")
3. If not found, insert membership → handle unique constraint race → return membership
4. Update invite status to 'accepted'

This handles all cases cleanly.

Now let me think about the `GET /trips/:id` — "only members may see it." So:
1. Find trip by id
2. If not found → not_found
3. Check if current user is a member → if not → not_found (same response as nonexistent trip)
4. Return trip with members and pending invites

For the membership check: look up member by (trip_id, user_id).

Let me also think about what `POST /trips/:id/invites` requires:
1. Find trip by id → not found → not_found
2. Check if current user is owner of the trip → if not → forbidden (or not_found?). The spec says "owner invites by email" so only owners can invite. I'll use forbidden.
3. Check for existing pending invite for this (trip_id, email) → if found, return it
4. Create invite with token and 'pending' status
5. Return invite

Wait, re-reading the spec: "Inviting the same email twice returns the existing pending invite rather than creating a second one or erroring." So specifically: if there's already a pending invite for this email/trip, return it. If there's a declined/accepted invite and no pending, create a new one.

Now let me finalize and write all files.

Actually, let me also consider: should the `POST /trips` request include the current user implicitly via auth? Yes, the creator becomes owner. So the endpoint requires auth, and the user from auth becomes the owner member.

Let me draft the service:

```ts
@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  async create(dto: CreateTripDto, currentUser: CurrentUserPayload): Promise<Trip & { members: Member[] }> {
    const tripRow = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: new Date(dto.startDate),
      endsAt: new Date(dto.endDate),
    });
    
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: tripRow.id,
      userId: currentUser.id,
      role: 'owner',
    });
    
    const trip = this.toTripEntity(tripRow);
    const members = await this.repo.findMembersByTripId(tripRow.id);
    
    return { ...trip, members: members.map(m => this.toMemberEntity(m)) };
  }

  async invite(tripId: string, dto: InviteMemberDto, currentUser: CurrentUserPayload): Promise<Invite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });
    
    const membership = await this.repo.findMember(tripId, currentUser.id);
    if (!membership || membership.role !== 'owner') {
      throw AppError.forbidden('only owners can invite');
    }
    
    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) return this.toInviteEntity(existing);
    
    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
      status: 'pending',
    });
    
    return this.toInviteEntity(invite);
  }

  async acceptInvite(token: string, currentUser: CurrentUserPayload): Promise<Member> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });
    
    const existing = await this.repo.findMember(invite.tripId, currentUser.id);
    if (existing) return this.toMemberEntity(existing);
    
    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: currentUser.id,
      role: 'member',
    });
    
    if (invite.status === 'pending') {
      await this.repo.updateInviteStatus(token, 'accepted');
    }
    
    return this.toMemberEntity(member);
  }

  async getById(tripId: string, currentUser: CurrentUserPayload): Promise<TripDetail> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });
    
    const membership = await this.repo.findMember(tripId, currentUser.id);
    if (!membership) throw AppError.notFound('trip not found', { tripId });
    
    const members = await this.repo.findMembersByTripId(tripId);
    const pendingInvites = await this.repo.findPendingInvitesByTripId(tripId);
    
    return {
      trip: this.toTripEntity(trip),
      members: members.map(m => this.toMemberEntity(m)),
      pendingInvites: pendingInvites.map(i => this.toInviteEntity(i)),
    };
  }
}
```

Now, I also need to think about error handling for unique constraint violations on members insert. In the fake repository for tests, this won't be an issue, but in real usage, we might get a DB error. Let me handle it in the service or just let it propagate and be caught by the error filter. Actually, since the spec says "accepting twice is a no-op" and I'm checking for existing membership first, this shouldn't happen in practice.

Let me now think about the trip detail response type. It could be:

```ts
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

Now let me think about what the fake repository needs for the test. Looking at the users service spec pattern, the fake implements the repository interface with an in-memory array. So I need to define the interface (the repository class) and then in the test, provide a fake implementation.

Let me write all the files now.

For the migration, I need to create the SQL and update the journal. Let me check the journal format from the reference:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1727000000000, "tag": "0000_init", "breakpoints": true }
  ]
}
```

I'll add a new entry for my migration.

Let me now write everything out completely.

Let me also think about the column types for the schema:

trips:
- id: uuid pk
- name: text not null
- destination: text not null  
- starts_at: timestamptz not null
- ends_at: timestamptz not null
- created_at: timestamptz not null default now()
- updated_at: timestamptz not null default now()

members:
- id: uuid pk
- trip_id: uuid not null fk to trips(id)
- user_id: uuid not null fk to users(id)
- role: text not null default 'member' (check: owner|member?)
- created_at: timestamptz not null default now()
- updated_at: timestamptz not null default now()
- UNIQUE(trip_id, user_id)

invites:
- id: uuid pk
- trip_id: uuid not null fk to trips(id)
- email: text not null
- token: text not null unique
- status: text not null default 'pending' (check: pending|accepted|declined?)
- created_at: timestamptz not null default now()
- updated_at: timestamptz not null default now()

I won't add CHECK constraints since the scaffold doesn't use them, but I'll use text and document the allowed values.

Now, let me finalize the DTOs:

CreateTripDto:
- name: string (1-100 chars)
- destination: string (1-200 chars)
- startDate: ISO datetime string
- endDate: ISO datetime string

InviteMemberDto:
- email: string (valid email)

Now, in the controller, when handling POST /trips, I need to use `@CurrentUser()` to get the current user (since it requires auth). Let me use `@UseGuards(AuthGuard)` on all endpoints.

Let me think about the controller route paths:
- POST /trips → create trip
- POST /trips/:id/invites → invite
- POST /invites/:token/accept → accept invite
- GET /trips/:id → get trip

Wait, the invite accept is at `/invites/:token/accept` — this is not nested under trips. That's a separate route path. So in the controller, this would be `@Post('invites/:token/accept')`.

Now let me write the complete code.

For the test, I need to test:
1. Creating a trip creates owner membership
2. Inviting as non-owner fails
3. Inviting same email twice returns same pending invite
4. Accepting invite adds member
5. Accepting twice is no-op
6. Non-member GET trip → not_found
7. Member GET trip → success with data
8. etc.

Let me write a comprehensive test.

Now I realize I should think about what `TripDetail` type the controller returns. Since the API uses the envelope `ApiResult<T>`, the controller returns `ApiOk<TripDetail>`.

Let me also think about entity mapping. Like in the users module, the service maps row types to entity types. Let me do the same.

Actually, for simplicity and since the spec doesn't mandate separate entity files for every table, let me put them all in `entities/`. But actually, the convention says `entities/` directory, so I'll create entity files there.

Hmm, let me reconsider the file structure. The convention says:
- `src/modules/<name>/<name>.controller.ts`
- `src/modules/<name>/<name>.service.ts`
- `src/modules/<name>/<name>.repository.ts`
- `dto/`
- `entities/`

So I'll have:
```
src/modules/trips/
  trips.controller.ts
  trips.service.ts
  trips.repository.ts
  trips.module.ts
  dto/
    create-trip.dto.ts
    invite-member.dto.ts
  entities/
    trip.entity.ts
    member.entity.ts
    invite.entity.ts
  trips.service.spec.ts
```

Now let me write all the code. I'll be thorough.

One thing I want to be careful about: the repository should NOT be imported by the service directly as a type that exposes Drizzle types. The repository returns row types or entity types, not Drizzle types. Looking at the users module:

```ts
// repository returns UserRow (Drizzle row type)
async findById(id: string): Promise<UserRow | null>

// service maps to User entity
async getById(id: string): Promise<User> {
  const row = await this.repo.findById(id);
  if (!row) throw AppError.notFound(...);
  return this.toEntity(row);
}
```

So the repository returns `UserRow` (Drizzle type) and the service maps to `User` (entity). The controller gets `User` (entity). This is the convention.

Let me follow this pattern for trips.

For the test, I need to check that the repository is faked at its interface. The fake should implement `TripsRepository` methods.

Let me now write all the files. This is going to be a lot of code but I need to be complete and correct.

Let me think about one more thing: for the `findPendingInvite` method — should it return the invite or null? Yes, it searches for a pending invite with matching trip_id and email.

And for the `findMember` method — finds a member by trip_id and user_id.

Let me now write the actual code files:

---

### drizzle/schema.ts (update)

I need to add the new tables. Let me include the full file.

### drizzle/0001_trips.sql (new)

The migration SQL.

### drizzle/meta/_journal.json (update)

Add entry for new migration.

### src/modules/trips/entities/trip.entity.ts
### src/modules/trips/entities/member.entity.ts
### src/modules/trips/entities/invite.entity.ts
### src/modules/trips/dto/create-trip.dto.ts
### src/modules/trips/dto/invite-member.dto.ts
### src/modules/trips/trips.repository.ts
### src/modules/trips/trips.service.ts
### src/modules/trips/trips.controller.ts
### src/modules/trips/trips.module.ts
### src/modules/trips/trips.service.spec.ts
### src/app.module.ts (update)

Let me write them all now.

One important thing about the `updated_at` handling — in the scaffold, when inserting, the default is `now()` and I don't see any explicit update logic. I'll follow that.

Also, for dates in DTOs: the schema uses `timestamptz`. When creating from a DTO with `startDate` and `endDate` as ISO strings, I'll convert to Date objects.

Let me write it all now.

For the repository, looking at the users repository as a template:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ... } from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}
  
  // trips methods
  async insertTrip(row: NewTripRow): Promise<TripRow> { ... }
  async findTripById(id: string): Promise<TripRow | null> { ... }
  
  // members methods
  async insertMember(row: NewMemberRow): Promise<MemberRow> { ... }
  async findMember(tripId: string, userId: string): Promise<MemberRow | null> { ... }
  async findMembersByTripId(tripId: string): Promise<MemberRow[]> { ... }
  
  // invites methods
  async insertInvite(row: NewInviteRow): Promise<InviteRow> { ... }
  async findPendingInvite(tripId: string, email: string): Promise<InviteRow | null> { ... }
  async findInviteByToken(token: string): Promise<InviteRow | null> { ... }
  async findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]> { ... }
  async updateInviteStatus(token: string, status: string): Promise<void> { ... }
}
```

Now, I need to be careful — the spec says "No Drizzle import outside the repository." So the service and controller must not import from drizzle. Only the repository imports from `drizzle-orm` and the schema.

Let me also think about how `findMembersByTripId` and `findPendingInvitesByTripId` return multiple rows. In Drizzle, I'd use `this.db.select().from(...).where(eq(...))`.

Now let me finalize and write all the files.

For the test, looking at the users service spec pattern:

```ts
function fakeRepo(rows: UserRow[] = []): UsersRepository { ... }
```

For trips, I'll need a similar fake but with more methods. Let me design it:

```ts
function fakeRepo(
  trips: TripRow[] = [],
  members: MemberRow[] = [],
  invites: InviteRow[] = [],
): TripsRepository {
  return {
    async insertTrip(row) { ... },
    async findTripById(id) { ... },
    async insertMember(row) { ... },
    async findMember(tripId, userId) { ... },
    async findMembersByTripId(tripId) { ... },
    async insertInvite(row) { ... },
    async findPendingInvite(tripId, email) { ... },
    async findInviteByToken(token) { ... },
    async findPendingInvitesByTripId(tripId) { ... },
    async updateInviteStatus(token, status) { ... },
  } as unknown as TripsRepository;
}
```

OK, let me write everything now. I'll be comprehensive.

Actually, let me also think about what `createdAt`/`updatedAt` look like as Date objects. In the schema, they're `timestamp('created_at', { withTimezone: true })`. In Drizzle, these come back as Date objects. In the entity mapping (toEntity), they get converted to ISO strings (like in users service: `row.createdAt.toISOString()`).

But wait, in the fake repository for tests, the dates are set as `new Date('2024-01-01T00:00:00Z')`. So they'll be Date objects. And in the service, when mapping, I'll call `.toISOString()`.

OK, now let me write all the code.

For the trip entity, I need to decide what fields to expose. Following the users entity pattern (only what the API returns):

Trip entity:
```ts
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;  // ISO string
  endsAt: string;    // ISO string
  createdAt: string;
}
```

Member entity:
```ts
export interface Member {
  id: string;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}
```

Invite entity:
```ts
export interface Invite {
  id: string;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}
```

Now for the trip detail response (what GET /trips/:id returns):
```ts
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

Or maybe I should just return the trip with members and invites nested. Let me keep it as a separate type since it's a composite response.

Let me now write all the files. I'll start with the schema and migration, then the entities, DTOs, repository, service, controller, module, test, and finally the app module registration.

Let me also think about what `starts_at` and `ends_at` should be called in the DTO. In the DTO, following the convention of using zod, the property could be `startDate`/`endDate` (camelCase in TypeScript) which maps to `starts_at`/`ends_at` in DB.

Actually, looking at the DTO convention from create-user.dto.ts, the schema fields are camelCase (`email`, `displayName`) which map to snake_case DB columns. The DTO doesn't need to specify DB column names — it's just a TypeScript type. The repository handles the mapping to DB rows.

So the CreateTripDto would have:
- name
- destination
- startDate (Date or string)
- endDate (Date or string)

And the service maps these to the DB row format with `starts_at`, `ends_at`.

For zod, I'll use `z.string().datetime()` for dates, and then in the service convert to Date objects.

OK, let me write it all now.

One more thing: in the controller, for POST /trips, I need `@UseGuards(AuthGuard)` and `@CurrentUser()` to get the current user. The auth guard requires `x-user-id` and `x-user-email` headers.

Let me also check: does the trip creation need the user to be authenticated? Yes, the creator becomes the owner. So auth is required.

And for POST /invites/:token/accept, the current user is the one accepting, so their ID is used for the membership.

Alright, let me now produce all the files.

Let me also think about how the `findPendingInvite` works in the fake repo. In the fake, I'll search through the invites array for matching trip_id, email, and status === 'pending'.

And `findInviteByToken` searches for matching token.

And `findMember` searches for matching (trip_id, user_id).

And `insertMember` needs to handle the unique constraint — in the fake, if a member with the same (trip_id, user_id) exists, it should either throw or return the existing one. For the test, since I'm handling the "check first" logic in the service, the fake can just push the new member.

For `insertInvite`, similarly, just push.

Let me also make sure the fake handles the `updateInviteStatus` method — it should find the invite and update its status.

Now let me produce the complete code:

I think for the test, I need at least these test cases:
1. create trip → returns trip with owner member
2. invite as owner → creates pending invite
3. invite same email twice → returns same pending invite
4. accept invite → creates member
5. accept same token twice → returns same member (no-op)
6. get trip as member → returns trip with data
7. get trip as non-member → not_found
8. invite as non-owner → forbidden

Let me write 5-6 solid test cases covering the acceptance criteria.

Now let me also consider: when creating the trip, should the response include the members? Looking at the spec: "POST /trips — create trip (name, destination, date range). Creator becomes owner member." The response should probably include the created trip. I'll include it with the owner member info.

Actually, let me check: the users module's `create` returns `ApiOk<User>` — just the entity. So for trips, I should return the trip entity (maybe with the owner member). Let me return the trip plus members list for the create response.

Hmm, but actually for the API envelope, let me just return the trip as the data, since the spec doesn't specify exactly what the create response looks like beyond "create trip." Let me include the members in the response.

Let me define the create response as: `Trip & { members: Member[] }`

Actually, let me simplify. For POST /trips, return the trip entity plus a members array. For GET /trips/:id, return the trip with members and pending invites.

Let me finalize:

POST /trips response: `{ ok: true, data: { trip: Trip, members: Member[] } }`
GET /trips/:id response: `{ ok: true, data: { trip: Trip, members: Member[], pendingInvites: Invite[] } }`
POST /trips/:id/invites response: `{ ok: true, data: Invite }`
POST /invites/:token/accept response: `{ ok: true, data: Member }`

Actually, I don't want to over-specify the response. Let me keep it simple:
- POST /trips: returns trip + members
- GET /trips/:id: returns trip + members + pendingInvites
- POST /trips/:id/invites: returns invite
- POST /invites/:token/accept: returns member

Now let me write all the code!

I realize I should also check: do I need `@Body() Validate()` or something in the controller? Looking at the users controller, it uses `@Body() body: unknown` and then validates with zod. I'll follow the same pattern.

OK here goes, all the files:

Let me also think about whether I need a `TripRepository` or if all DB access goes through `TripsRepository`. The convention says one repository per module. Since all tables (trips, members, invites) are part of the trips feature, they all go through `TripsRepository`.

Let me also think about imports. The service will need:
- `Injectable` from `@nestjs/common`
- `randomUUID` from `node:crypto`
- `AppError` from `../../common/app-error.js`
- `CurrentUserPayload` from `../../auth/types.js`
- DTO types
- Entity types
- `TripsRepository` from `./trips.repository.js`

The repository will need:
- `Inject, Injectable` from `@nestjs/common`
- `eq` from `drizzle-orm`
- schema types from `../../../drizzle/schema.js`
- `DB, type Db` from `../../db/db.module.js`

The controller will need:
- `Body, Controller, Get, Post, UseGuards` from `@nestjs/common`
- `AuthGuard` from `../../auth/auth.guard.js`
- `CurrentUser` from `../../auth/current-user.decorator.js`
- `CurrentUserPayload` from `../../auth/types.js`
- `ApiResult, type ApiOk` from `../../common/api-result.js`
- `AppError` from `../../common/app-error.js`
- DTO types
- Entity types
- `TripsService` from `./trips.service.js`

Now, I need to be careful about the path to `drizzle/schema.js` from the repository. The repository is at `src/modules/trips/trips.repository.ts`, and the schema is at `drizzle/schema.ts`. So the relative path is `../../../drizzle/schema.js`. That matches the users repository pattern.

And the path to `db/db.module.js` from the repository: `src/modules/trips/trips.repository.ts` → `src/db/db.module.js` = `../../db/db.module.js`. That also matches.

Now let me write everything. I'll be thorough.

One more consideration: in the schema, `members.role` and `invites.status` should have some constraint or documentation. In the users module, the email has `.unique()`. For role, I could use `.checkIn(['owner', 'member'])` but the scaffold doesn't use check constraints. I'll just use `text('role').notNull()` and document it. Actually, let me add a default of `'member'` for role in members and `'pending'` for status in invites.

For the unique constraint on members (trip_id, user_id), I need to add it. In Drizzle, this would be:

```ts
pgTable('members', {
  ...
}, (table) => ({
  uniqueTripUser: unique('members_trip_id_user_id_unique')(table.tripId, table.userId),
}));
```

Wait, let me check the Drizzle API. In Drizzle 0.33, I can do:

```ts
import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

export const members = pgTable('members', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueTripUser: unique('members_trip_id_user_id_unique')(table.tripId, table.userId),
}));
```

Wait, but `trips` and `users` are defined after `members` in the schema file? No, I should define `trips` first, then `members` (which references `trips`), then `invites` (which references `trips`). And `users` is already defined.

Actually, with Drizzle's `references(() => trips.id)`, I can forward-reference. But since `trips` is defined before `members` in the file, I can also do `.references(trips.id)` directly. Let me check the convention in the scaffold... The users schema doesn't have any references. Let me use the arrow function form for safety.

Actually, let me just define them in order: users (exists), trips, members, invites. And for foreign keys:
- members.tripId → trips.id
- members.userId → users.id
- invites.tripId → trips.id

I can reference `trips.id` directly since `trips` is defined before `members` in the file. And `users.id` is also defined before.

Wait, actually in Drizzle, `.references()` takes a function or a column reference. Let me use:

```ts
tripId: uuid('trip_id').notNull().references(() => trips.id),
```

This is the forward-reference-safe form. Even though trips is defined above, this is the recommended pattern.

Actually, looking at the Drizzle docs for version 0.33, `.references()` can take either a function `() => ref` or a direct column reference. Since trips is defined before members in the file, both work. But to be safe, I'll use the arrow function form.

Hmm, but `users` is defined at the top and `trips` will be defined before `members` too. So I could just do `.references(users.id)` or `.references(trips.id)`. But let me use the arrow form as it's more standard.

Let me now finalize all the code:

For the unique constraint on invites (trip_id, email) — I mentioned I'd handle "same email twice" in the service, not the DB. But actually, having a unique constraint might be helpful. Let me not add it to the schema and just handle it in the service. The acceptance criteria says "Inviting the same email twice → the same pending invite" which is a service-level concern.

Actually wait — should I add the unique constraint? The spec doesn't explicitly require a DB constraint for this. And the service logic handles it ("check for pending first, create if none"). I'll skip the DB constraint for invites on (trip_id, email).

For members, the spec explicitly requires the unique constraint on (trip_id, user_id). I'll add it.

For invites token, I'll add a unique constraint on token (it makes lookups efficient and is a natural constraint).

Let me now write all the code.

Also, I realize I need to think about whether the `POST /invites/:token/accept` endpoint needs to be in the trips controller or a separate controller. Looking at the route paths:
- `/trips/*` → trips controller
- `/invites/*` → could be in trips controller too (since there's no invites module)

The spec says scope is `src/modules/trips/` and nothing else. So `/invites/:token/accept` should be in the trips controller. It's fine to have routes at different paths in the same controller.

Let me finalize the controller:

```ts
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(@Body() body: unknown, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<...>> { ... }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<...>> { ... }

  @Post('invites/:token/accept')
  @UseGuards(AuthGuard)
  async accept(@Param('token') token: string, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<...>> { ... }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getById(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<...>> { ... }
}
```

Now I'll write all the files. Let me organize them.

One thing about the `Trip` entity and `TripDetail` — I could put the detail response type in the entities folder or inline in the controller/service. Let me put it in the service or entities folder.

Actually, let me define the response type in the entities folder as `trip-detail.entity.ts` or just use inline types. Looking at the scaffold, they have simple entity files. Let me create `trip.entity.ts`, `member.entity.ts`, `invite.entity.ts` and define the detail type in the service.

Wait, actually, let me just put it all together. The service method `getById` returns something like:

```ts
Promise<ApiOk<TripDetail>>
```

Hmm no, the controller wraps in ApiResult. The service returns the data, controller wraps. Let me keep it clean:

Service returns: `Promise<TripDetail>` (or whatever the data shape is)
Controller wraps: `ApiResult.ok(data)` → `ApiOk<TripDetail>`

Let me define TripDetail in the entities folder:

```ts
// entities/trip-detail.entity.ts
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

Actually, let me keep it simpler. Let me just export the interface from the trip entity file or the service. Looking at the scaffold's pattern, they keep entities simple. Let me just define it where it's used.

OK, I think I'm overthinking this. Let me just write the code now.

Let me finalize the complete list of files I need to create/modify:

**New files:**
1. `drizzle/0001_trips.sql` — migration
2. `drizzle/schema.ts` — update (add new tables)
3. `drizzle/meta/_journal.json` — update (add entry)
4. `src/modules/trips/entities/trip.entity.ts`
5. `src/modules/trips/entities/member.entity.ts`
6. `src/modules/trips/entities/invite.entity.ts`
7. `src/modules/trips/dto/create-trip.dto.ts`
8. `src/modules/trips/dto/invite-member.dto.ts`
9. `src/modules/trips/trips.repository.ts`
10. `src/modules/trips/trips.service.ts`
11. `src/modules/trips/trips.controller.ts`
12. `src/modules/trips/trips.module.ts`
13. `src/modules/trips/trips.service.spec.ts`

**Modified files:**
14. `src/app.module.ts` — add TripsModule import

Wait, I should also think about whether `drizzle/schema.ts` is a "new" file or "modified." It already exists, so it's modified. But since I'm told not to restate files I'm not changing, and I AM changing it, I should include it.

Actually, let me re-read the instructions: "Deliver every file the solution needs, complete, first line to last." So I should deliver all files that the solution needs, whether they're new or modified. And for modified files, I deliver the complete new content.

OK, let me write all the code now. I'll be thorough but efficient.

Let me think about one more thing: the `@map` annotations. Looking at the existing schema.ts, it uses explicit column names in the Drizzle table definition (e.g., `uuid('id')`, `text('email')`, `text('display_name')`). So the DB column names are explicitly specified. The TypeScript property names are camelCase. This is the convention.

Now, for my new tables, I'll follow the same pattern:
- TypeScript: camelCase properties
- DB columns: snake_case, explicitly specified
- Each table has `created_at` and `updated_at` timestamps

Let me now write the complete code.

One thing about the test: the fake repository needs to implement all methods of `TripsRepository`. Let me make sure I include all of them.

Also, for the test, I should test the actual behavior, not just "the method was called." The tests should verify:
1. Creating a trip returns trip data with the creator as owner member
2. Inviting works for owners
3. Inviting same email returns same pending invite
4. Accepting invite creates membership
5. Accepting twice is no-op
6. Non-member gets not_found
7. Non-owner gets forbidden when inviting

Let me now produce the code.

Wait, one more thing about the schema: I need to be careful about the order of table definitions and references. In Drizzle, I need to make sure referenced tables are accessible. Since `users` is already defined, and I'll define `trips` before `members` and `invites`, I can reference them directly.

Actually, let me use the arrow function form for references to be safe:

```ts
tripId: uuid('trip_id').notNull().references(() => trips.id),
userId: uuid('user_id').notNull().references(() => users.id),
```

This works even if the referenced table is defined later or earlier.

Let me now write everything.

Actually, there's one more issue. Drizzle's `.references()` might need the table to be already defined when using the arrow function form in some versions. Let me check... In Drizzle 0.33, `references(() => otherTable.column)` is supported and handles forward references via lazy evaluation. So this should be fine.

OK, final consideration: do I need to define entity interfaces that mirror the row types? Yes, following the scaffold pattern. Each entity file maps from row type to entity type (in the service).

Now let me produce the code. I'll write each file completely.

Let me also double-check: the `TripsRepository` should be listed in the module's providers, and the module should be imported in app.module.ts. The controller should also be listed in the module.

One more thing: does the trips module need to export anything? Looking at the spec: "Nothing else." The trips module doesn't need to be imported by other modules (except app.module.ts registers it). So no exports needed.

But wait, looking at the users module:
```ts
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
```

It exports the service. For trips, since no other module needs it, I don't need to export. But let me not export to keep it simple.

Now, let me think about whether the AuthGuard needs to be imported or is it global? Looking at the scaffold, it's a regular guard that needs to be applied per-route with `@UseGuards(AuthGuard)`. So it needs to be available. Is it registered somewhere? Let me check main.ts... It doesn't register AuthGuard globally. The users controller uses `@UseGuards(AuthGuard)` on specific routes. So I need to make sure AuthGuard is available. It should be since it's in `src/auth/` and NestJS can resolve it by name. Actually, looking at the users module, AuthGuard is not imported there. How does the users controller use it?

Hmm, looking more carefully at the users module:
```ts
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
```

No AuthGuard provider! But the controller uses `@UseGuards(AuthGuard)`. In NestJS, guards can be global (registered in app) or local (per-controller or per-route). If not registered globally, you need to either register them in the module or use them with `@UseGuards()` which resolves them from the DI container. Actually, in NestJS, `@UseGuards(AuthGuard)` will try to instantiate AuthGuard from the DI container. If AuthGuard is not in any module's providers, it might fail.

Wait, but looking at the scaffold, it works. Let me check if there's something I'm missing. The AuthGuard is in `src/auth/auth.guard.ts` and is decorated with `@Injectable()`. In NestJS, when using `@UseGuards()`, NestJS resolves the guard class through the application's DI container. If the guard is not explicitly registered in a module, but is decorated with `@Injectable()`, NestJS might still be able to instantiate it (since it can scan for providers). Actually no — in NestJS, classes need to be registered in a module's providers to be injectable.

But looking at the scaffold, AuthGuard might be implicitly available because the controller that uses it is in a module that imports AuthModule... Let me check if there's an AuthModule... I don't see one in the provided files.

Hmm, actually, in NestJS, if a guard is used with `@UseGuards(AuthGuard)` and AuthGuard is not in any module's providers, NestJS will still try to instantiate it. Looking at the `CanActivate` interface, AuthGuard implements it. In newer versions of NestJS, you can use `@UseGuards()` with classes that are not explicitly registered if they have `@Injectable()`. This is because NestJS uses the "host module" to resolve dependencies — when the controller is in a module, NestJS looks for the guard in that module and its parents.

Since AuthGuard doesn't have any external dependencies (it just implements CanActivate), it should work even without explicit registration. The `@Injectable()` decorator makes it instantiable.

So I don't need to add AuthGuard to the trips module's providers. I'll just use `@UseGuards(AuthGuard)` in the controller.

Wait, actually, let me double-check. In the users controller, `AuthGuard` is imported from `../../auth/auth.guard.js` and used with `@UseGuards(AuthGuard)`. The users module doesn't list AuthGuard in providers. So either:
1. It works because NestJS can instantiate `@Injectable()` classes not in providers
2. There's some global registration I'm not seeing

Looking at the main.ts, there's no global guard registration. So it must be option 1 — NestJS can instantiate `@Injectable()` classes when used with `@UseGuards()` even if not explicitly in providers. This is actually true in NestJS.

So I don't need to add AuthGuard to the trips module.

Alright, NOW let me write all the code!

Let me think about the order I should write the files in the response. The format requires:

### <path>
```ts
<content>
```

I'll organize by layer, going from schema to entities to DTOs to repository to service to controller to module to test to app module.

Let me also consider: for the trip's date fields, what should they be called in the DTO? I'll use `startDate` and `endDate` (camelCase in TypeScript, as per the scaffold convention). The schema column names are `starts_at` and `ends_at`.

Actually, hmm. Let me reconsider. Looking at the scaffold's DTO convention: `createUserSchema` uses `email` and `displayName` which map to DB columns `email` and `display_name`. So the DTO field names are camelCase and the DB column names are snake_case. The repository handles the mapping.

But wait, in `createUser.dto.ts`:
```ts
export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
});
```

And in `user.entity.ts`:
```ts
export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}
```

So `displayName` maps to DB `display_name`. The schema file has `displayName: text('display_name').notNull()` — explicit mapping.

For my trip DTO:
```ts
export const createTripSchema = z.object({
  name: z.string().min(1).max(100),
  destination: z.string().min(1).max(200),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});
```

Where `startDate` maps to DB `starts_at` and `endDate` maps to DB `ends_at`.

In the schema:
```ts
startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
```

In the entity:
```ts
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;  // ISO string from Date
  endsAt: string;
  createdAt: string;
}
```

OK, let me write all the code now. No more deliberation!

Hmm, one last thing: for the `findPendingInvite` in the repository, I need to query by trip_id, email, and status='pending'. Let me write the Drizzle query:

```ts
async findPendingInvite(tripId: string, email: string): Promise<InviteRow | null> {
  const [row] = await this.db.select().from(invites)
    .where(eq(invites.tripId, tripId))
    // AND eq(invites.email, email) AND eq(invites.status, 'pending')
    // Actually, I can combine conditions
  ...
}
```

In Drizzle, I can chain conditions with `and`:

```ts
import { eq, and } from 'drizzle-orm';

const [row] = await this.db.select().from(invites)
  .where(and(
    eq(invites.tripId, tripId),
    eq(invites.email, email),
    eq(invites.status, 'pending'),
  ))
  .limit(1);
return row ?? null;
```

Actually, wait — should I use `and` or just chain `where` calls? In Drizzle, each `where` call on the query builder replaces the condition, so I need `and` or chain `where` in a single call. Let me use `and`.

Hmm, actually, looking at the Drizzle docs, you CAN chain `.where()` and they combine with AND:

```ts
this.db.select().from(invites).where(eq(invites.tripId, tripId)).where(eq(invites.email, email))
```

But actually, that's not correct in all versions. Let me use `and` to be safe.

Wait, actually, in Drizzle, `.where()` can be called multiple times and they are combined with AND. Let me verify... Actually, in recent Drizzle versions, calling `.where()` multiple times does combine with AND. But to be explicit and safe, I'll use `and`.

Let me finalize the code now.

For `findMembersByTripId`:
```ts
async findMembersByTripId(tripId: string): Promise<MemberRow[]> {
  return this.db.select().from(members).where(eq(members.tripId, tripId));
}
```

For `findPendingInvitesByTripId`:
```ts
async findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]> {
  return this.db.select().from(invites).where(
    and(eq(invites.tripId, tripId), eq(invites.status, 'pending'))
  );
}
```

For `updateInviteStatus`:
```ts
async updateInviteStatus(token: string, status: InviteRow['status']): Promise<void> {
  await this.db.update(invites).set({ status }).where(eq(invites.token, token));
}
```

Wait, but the service shouldn't know about InviteRow type (it's a Drizzle row type). The repository returns row types, and the service maps them to entities. But `updateInviteStatus` takes a status string and token string — these are simple types, not ORM types. So it's fine for the service to call this.

Actually, the service should NOT use Drizzle types at all. Let me make the status parameter a simple string or an enum-like string union.

```ts
async updateInviteStatus(token: string, status: string): Promise<void> { ... }
```

Or I could define a type alias in the repository. But since the service calls it, let me keep it simple with `string`.

Now let me write everything.

Also for the `insertMember` in the service — I need to handle the case where the member already exists (unique constraint). In the accept flow, I check for existing membership first, so this shouldn't be an issue in normal flow. But if it does happen (race condition), I should catch the error. Let me add a try-catch in the service for the unique constraint error.

Actually, the spec says "accepting twice is a no-op" and I'm checking for existing membership first, so there shouldn't be a race in my implementation. The unique constraint is a safety net. If it does trigger, I'll let it propagate as an internal error or conflict.

Let me just handle it gracefully:

```ts
try {
  const member = await this.repo.insertMember({...});
  return this.toMemberEntity(member);
} catch (err) {
  // Unique constraint violation on (trip_id, user_id)
  const existing = await this.repo.findMember(invite.tripId, currentUser.id);
  if (existing) return this.toMemberEntity(existing);
  throw AppError.internal('could not create membership');
}
```

Hmm, but this adds a DB roundtrip. Let me keep it simpler since the check-first logic handles it:

```ts
const member = await this.repo.insertMember({...});
return this.toMemberEntity(member);
```

If a race happens, the error will be caught by the global error filter and return as internal error. That's acceptable.

OK, let me write the code now for real!

Actually, let me reconsider the `updateInviteStatus` — should it be in the repository? Yes, because it modifies the DB. And the service calls it after inserting the member. That's fine — the service is calling repository methods (which is allowed).

Now, one issue: after `updateInviteStatus`, what if I need to return the updated invite? The spec says "accepting twice is a no-op returning the membership." So I return the membership, not the invite. I don't need to return the updated invite.

Let me now write all the code:

Actually, I realize there's a subtle issue with `updateInviteStatus`. If the invite is already 'accepted' and we call accept again, we don't need to update the status (we just return the membership). So in the service:

```ts
async acceptInvite(token: string, currentUser: CurrentUserPayload): Promise<Member> {
  const invite = await this.repo.findInviteByToken(token);
  if (!invite) throw AppError.notFound('invite not found', { token });
  
  // Check for existing membership first (handles "accepting twice" and pre-existing members)
  const existing = await this.repo.findMember(invite.tripId, currentUser.id);
  if (existing) return this.toMemberEntity(existing);
  
  // No membership exists — create one
  const member = await this.repo.insertMember({
    id: randomUUID(),
    tripId: invite.tripId,
    userId: currentUser.id,
    role: 'member',
  });
  
  // Update invite status if still pending
  if (invite.status === 'pending') {
    await this.repo.updateInviteStatus(token, 'accepted');
  }
  
  return this.toMemberEntity(member);
}
```

This is clean. If accepting twice, `existing` membership is found and returned immediately. If it's a first acceptance, member is created and invite is updated.

Now let me finalize the code and write it all out.

Let me also double check: for the `findInviteByToken` in the repository — the token is a UUID string, and the invites table has a `token` column of type `text`. So the query is:

```ts
async findInviteByToken(token: string): Promise<InviteRow | null> {
  const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
  return row ?? null;
}
```

OK now let me write all the code files!

One more thing I want to verify: does `drizzle-orm/pg-core` export `unique`? Yes, in Drizzle 0.33, `unique` is available from `drizzle-orm/pg-core`:

```ts
import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';
```

And usage:
```ts
}, (table) => ({
  uniqueTripUser: unique('members_trip_id_user_id_unique')(table.tripId, table.userId),
}));
```

This should work.

OK, I'm writing the code now. Final time!

Let me also think about whether I should include a `findMember` method that returns a single member by (tripId, userId) — yes, the service uses it. Let me include it.

And in the fake repo for the test, I need to implement it too.

Let me also think about the `insertTrip` return type — it should return the `TripRow` (the inserted row, including generated fields like `id`). In Drizzle, this is done with `.returning()`.

OK, final code time!

Actually, I want to also think about whether I need a `findTripsByCreator` or any other methods. The spec only mentions the four endpoints, so I'll keep it to what's needed.

Let me list all the repository methods I need:
1. `insertTrip(row: NewTripRow): Promise<TripRow>` — create trip
2. `findTripById(id: string): Promise<TripRow | null>` — find trip by id
3. `insertMember(row: NewMemberRow): Promise<MemberRow>` — add member
4. `findMember(tripId: string, userId: string): Promise<MemberRow | null>` — check membership
5. `findMembersByTripId(tripId: string): Promise<MemberRow[]>` — get all members of a trip
6. `insertInvite(row: NewInviteRow): Promise<InviteRow>` — create invite
7. `findPendingInvite(tripId: string, email: string): Promise<InviteRow | null>` — check pending invite
8. `findInviteByToken(token: string): Promise<InviteRow | null>` — lookup by token
9. `findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]>` — pending invites for a trip
10. `updateInviteStatus(token: string, status: string): Promise<void>` — update invite status

That's 10 methods. Let me make sure the fake implements all of them.

Now, for the NewTripRow, NewMemberRow, NewInviteRow types — I need them in the fake repo. Let me import them from the schema file.

Let me now produce all the code.

Hmm, actually — the DTO for create trip should validate that startDate is before endDate? The scaffold's create-user DTO doesn't have cross-field validation. I'll keep it simple and just validate that fields are present and properly formatted. Cross-field validation can be added later.

Let me also reconsider: should the trip DTO fields be `startDate`/`endDate` or `starts_at`/`ends_at`? Following the TypeScript convention (camelCase), I'll use `startDate`/`endDate` in the DTO, and the service maps them to `starts_at`/`ends_at` for the DB row.

OK, final code now. I'll write it all in one go.

Let me think about one more thing: the `created_at` and `updated_at` in the entities. In the users entity, `createdAt` is a string (ISO format). In the row type (schema), it's a Date. The service converts: `row.createdAt.toISOString()`. I'll follow this pattern.

For the trip entity, `startsAt` should also be a string (ISO format), so the entity maps from Date to string: `startsAt: row.startsAt.toISOString()`.

Alright, I'm going to write all the code now. No more deliberation.

Oh wait, one more thing: in the fake repository for the test, when I `insertTrip`, the returned row should have `createdAt` and `updatedAt` as Date objects. Same for insertMember and insertInvite. Let me follow the pattern from the users service spec:

```ts
const created = {
  ...row,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
} as UserRow;
```

I'll follow this for all insert methods in the fake.

Now, let me also think about what happens when I `insertMember` in the fake and there's a unique constraint. In the fake, I'll just push to the array. In the test for "accepting twice," I'll first create a membership, then call accept again, and the service should find the existing membership before trying to insert.

OK, now let me actually write the code.

Let me structure my response with all the files in order:

1. drizzle/schema.ts (updated)
2. drizzle/0001_trips.sql (new)
3. drizzle/meta/_journal.json (updated)
4. src/modules/trips/entities/trip.entity.ts
5. src/modules/trips/entities/member.entity.ts
6. src/modules/trips/entities/invite.entity.ts
7. src/modules/trips/dto/create-trip.dto.ts
8. src/modules/trips/dto/invite-member.dto.ts
9. src/modules/trips/trips.repository.ts
10. src/modules/trips/trips.service.ts
11. src/modules/trips/trips.controller.ts
12. src/modules/trips/trips.module.ts
13. src/modules/trips/trips.service.spec.ts
14. src/app.module.ts (updated)

That's 14 files total. Let me write them all.

Actually, I just realized I need to double check one thing: the `TripDetail` type. Where should I define it? I'll put it in the service or inline in the controller. Let me put it in a comment/type in the controller, or just inline the return type. Actually, let me put it in the entities folder for cleanliness.

Wait, looking at the scaffold pattern, they don't have a "response" entity. They just return the entity type. For trips, the GET response is composite (trip + members + invites). Let me define it in the entities folder:

```ts
// src/modules/trips/entities/trip-detail.entity.ts
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

Hmm, or I could just inline it in the controller's return type. Let me keep it in the entities folder as a separate file for clarity.

Actually, looking more carefully at the convention, the scaffold only has one entity per module (User). For trips, I have Trip, Member, Invite, and TripDetail. Let me put TripDetail inline or in the service. Let me just define it in the entities folder for organization.

Wait, actually let me just define it as a type in the controller or service. Less files = less complexity. The convention says `entities/` directory exists but doesn't mandate one entity per file.

Let me just define it in the trip.entity.ts alongside the Trip interface, or create a separate file. Let me go with a separate file for clarity.

OK let me just go with this plan and write the code. I'll define TripDetail in entities/trip-detail.entity.ts.

Now let me finalize and write!

One more thing: in the schema.ts, should I use `references` or `references(() => ...)`? Let me check what works in Drizzle 0.33:

```ts
import { pgTable, text, timestamp, uuid, unique, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const trips = pgTable('trips', { ... });

export const members = pgTable('members', {
  ...
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  ...
}, ...);
```

The `() => trips.id` form is the arrow function lazy reference, which works for forward references. Since `trips` is defined before `members` in the file, both `() => trips.id` and direct `trips.id` would work. I'll use the arrow function form.

OK, WRITING THE CODE NOW!

Let me be very careful about import paths. Here's a map:

From `src/modules/trips/trips.repository.ts`:
- `src/auth/auth.guard.ts` — not needed directly
- `../../../drizzle/schema.js` — schema imports
- `../../db/db.module.js` — DB module
- `@nestjs/common` — Inject, Injectable
- `drizzle-orm` — eq, and

From `src/modules/trips/trips.service.ts`:
- `../../../drizzle/schema.js` — NOT NEEDED (service doesn't import Drizzle)
- `../../common/app-error.js` — AppError
- `../../auth/types.js` — CurrentUserPayload
- `./dto/create-trip.dto.js` — CreateTripDto
- `./dto/invite-member.dto.js` — InviteMemberDto
- `./entities/trip.entity.js` — Trip
- `./entities/member.entity.js` — Member
- `./entities/invite.entity.js` — Invite
- `./trips.repository.js` — TripsRepository
- `@nestjs/common` — Injectable
- `node:crypto` — randomUUID

Wait, does the service need to import from drizzle? NO! The spec says "services call repositories; services call repositories; ONLY repositories import Drizzle." And "No Drizzle import outside the repository."

So the service should NOT import any Drizzle types. It should work with entity types and DTO types only.

But wait, the service might need `NewTripRow`, `NewMemberRow`, `NewInviteRow` types for the insert methods... Let me check. The repository's insert methods take these row types, but the service constructs the data to pass. So the service needs to know the shape but not necessarily the TypeScript type from Drizzle.

Hmm, but in the users service:
```ts
async create(dto: CreateUserDto): Promise<User> {
  ...
  const row = await this.repo.insert({
    id: randomUUID(),
    email: dto.email,
    displayName: dto.displayName,
  });
  return this.toEntity(row);
}
```

It constructs a `NewUserRow` (implicitly) without importing the type. So the service in trips can do the same — construct objects that match the row type without importing the type.

But wait, TypeScript's type checking will fail if you try to pass an object to `repo.insert()` without the right type. Unless the repository's insert method accepts a loosely-typed parameter.

Looking at the users repository:
```ts
async insert(row: NewUserRow): Promise<UserRow> { ... }
```

And the service:
```ts
const row = await this.repo.insert({
  id: randomUUID(),
  email: dto.email,
  displayName: dto.displayName,
});
```

TypeScript would infer the object as compatible with `NewUserRow` because it has the right shape. But this means the service is implicitly using the `NewUserRow` type, which means it needs to import it!

Actually no — TypeScript structural typing means the service doesn't need to explicitly type the object. It just needs the shape to match. TypeScript will check the shape against `NewUserRow` at compile time.

But wait, the TypeScript compiler needs to see the `NewUserRow` type to do the check. If the service file doesn't import it, TypeScript won't know the expected type... unless the repository's signature is visible.

Actually, the service imports `UsersRepository` (the class), which has the `insert(row: NewUserRow)` method. TypeScript will use the repository's type signature, which is imported from the repository file. So the service doesn't need to directly import `NewUserRow` — it just constructs an object that matches the expected shape.

But the service might want to explicitly type the variable:
```ts
const row: NewUserRow = { ... };
```

In the users service, they don't do this — they just pass the object directly. So I'll follow the same pattern.

So the service won't import any Drizzle types. It'll just construct objects and pass them to the repository. The repository's type signatures will provide the type checking at compile time.

Great, this confirms my approach.

Now let me also consider: the service needs the `TripRow`, `MemberRow`, `InviteRow` types for mapping (toEntity methods). Wait, the toEntity methods take the row types. So the service needs these types.

Looking at the users service:
```ts
import type { UserRow } from '../../../drizzle/schema.js';
```

Yes, it imports `UserRow` from the schema. But the schema is not Drizzle ORM — it's the schema definition file which exports table definitions and row types. The `UserRow` is `typeof users.$inferSelect` — it's a TypeScript type, not a Drizzle ORM import.

So the service CAN import row types from the schema file, because these are TypeScript types, not Drizzle ORM code. The convention is "no Drizzle import" — meaning no importing from `drizzle-orm` package. Importing types from the schema file (which uses Drizzle under the hood) is fine.

Wait, let me re-read the spec: "Zero raw SQL, zero Prisma client calls" for services. And "No Drizzle import outside the repository." And from the ladder spec: "only repositories import Drizzle."

Hmm, "import Drizzle" — does this mean importing from `drizzle-orm` package, or importing anything from the schema file?

Looking at the scaffold more carefully:
- `users.repository.ts` imports from `drizzle-orm` (eq) and from the schema file (users table, types)
- `users.service.ts` imports from the schema file (UserRow type)

So the service imports types from the schema file but doesn't import from `drizzle-orm`. The "no Drizzle import" means no `drizzle-orm` imports, but importing row types from the schema file is acceptable.

Actually, let me look more carefully at the users service:
```ts
import type { UserRow } from '../../../drizzle/schema.js';
```

It imports `UserRow` type. This is a Drizzle inferred type (`typeof users.$inferSelect`). But it's imported as a plain TypeScript type, not as a Drizzle runtime import.

I think the convention is:
- Repository: imports from `drizzle-orm` (eq, and, etc.) AND schema file
- Service: imports types from schema file (but not from `drizzle-orm`)
- Controller: no schema/Drizzle imports

So my trips service should import row types from the schema file but not from `drizzle-orm`.

Let me verify with the scaffold... yes, `users.service.ts` imports `UserRow` from the schema. So I'll do the same for `TripRow`, `MemberRow`, `InviteRow`.

OK, NOW let me write the code for real. I promise this is the last deliberation!

Here are all the files I need:

Actually, let me reconsider one more time: should I include `drizzle/0001_trips.sql` as a file? The spec says "A migration exists in drizzle/ for every schema change." And "Deliver: module, migrations, tests, and nothing outside src/modules/trips + drizzle/ except the module registration line."

Yes, I need to include the migration SQL file. And I need to update the schema.ts and the journal.

For the migration, let me create the SQL based on the schema definitions:

```sql
CREATE TABLE "trips" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "destination" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "members" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "members_trip_id_user_id_unique" UNIQUE ("trip_id", "user_id")
);

CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id"),
  "email" text NOT NULL,
  "token" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("token")
);
```

And update the journal:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1727000000000, "tag": "0000_init", "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1727000001000, "tag": "0001_trips", "breakpoints": true }
  ]
}
```

Now let me write all the code!

Let me also reconsider: do I need to define `TripsModule` as exporting anything? Looking at the users module, it exports `UsersService`. For trips, since it's only used within the module and registered in app.module.ts, I don't need to export. But let me check...

The app.module.ts imports `TripsModule`. If the module doesn't export anything, that's fine — it just makes the module's providers and controllers available.

Actually wait — in NestJS, when you import a module, you can only access its exported providers. Controllers are always accessible within the module. So if TripsModule doesn't export anything, the controllers are available within the module but not external providers. Since no other module needs TripsModule's providers, this is fine.

Let me finalize the module:

```ts
@Module({
  controllers: [TripsController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
```

No exports needed.

Now let me write all the code. FINAL!

Wait, one more thing: the `TripDetail` type. Let me define it in the entities folder as a separate file, or I can put it inline. Let me keep it simple and define it in a comment above the controller method, or as a type in the service. Actually, let me just put it in `entities/trip.entity.ts` alongside `Trip`:

```ts
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export interface TripDetail extends Trip {
  members: Member[];
  pendingInvites: Invite[];
}
```

Hmm, but TripDetail is not really an extension of Trip. Let me just define it separately:

```ts
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

I'll put this in a comment or inline in the controller. Let me just put it in a comment and inline the return type in the controller method. Cleaner.

Actually, let me put it in a separate file for clarity. The convention says `entities/` directory — nothing prevents having more entity files.

OK, writing the code NOW. For real this time.

Let me also decide: should I create a `TripsRepository` interface or just a class? The scaffold has a class. The test fakes it by casting. I'll follow the same pattern.

Actually wait — I want to double-check one thing about the `drizzle/schema.ts` file. The spec mentions I need to update it. But I was told not to restate files I'm not changing. Since I AM changing it, I should include it. Let me include the full updated schema.

But the schema file is complex — let me make sure I include the existing `users` table AND add my new tables. I shouldn't remove the existing `users` table.

Final file list, let me write them all:

Here goes!
```

## reply

### drizzle/schema.ts
```ts
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
  uniqueTripUser: unique('members_trip_id_user_id_unique')(table.tripId, table.userId),
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
```

### drizzle/0001_trips.sql
```sql
CREATE TABLE "trips" (
  "id"           uuid PRIMARY KEY,
  "name"         text NOT NULL,
  "destination"  text NOT NULL,
  "starts_at"    timestamptz NOT NULL,
  "ends_at"      timestamptz NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "members" (
  "id"        uuid PRIMARY KEY,
  "trip_id"   uuid NOT NULL REFERENCES "trips" ("id"),
  "user_id"   uuid NOT NULL REFERENCES "users" ("id"),
  "role"      text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "members_trip_id_user_id_unique" UNIQUE ("trip_id", "user_id")
);

CREATE TABLE "invites" (
  "id"          uuid PRIMARY KEY,
  "trip_id"     uuid NOT NULL REFERENCES "trips" ("id"),
  "email"       text NOT NULL,
  "token"       text NOT NULL UNIQUE,
  "status"      text NOT NULL DEFAULT 'pending',
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
```

### drizzle/meta/_journal.json
```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1727000000000, "tag": "0000_init", "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1727000001000, "tag": "0001_trips", "breakpoints": true }
  ]
}
```

### src/modules/trips/entities/trip.entity.ts
```ts
/** What the API returns. Deliberately not the Drizzle row type. */
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

/** Trip with members and pending invites — the GET :id response shape. */
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
```

### src/modules/trips/entities/member.entity.ts
```ts
/** What the API returns. Deliberately not the Drizzle row type. */
export interface Member {
  id: string;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}
```

### src/modules/trips/entities/invite.entity.ts
```ts
/** What the API returns. Deliberately not the Drizzle row type. */
export interface Invite {
  id: string;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}
```

### src/modules/trips/dto/create-trip.dto.ts
```ts
import { z } from 'zod';

export const createTripSchema = z.object({
  name: z.string().min(1).max(100),
  destination: z.string().min(1).max(200),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
```

### src/modules/trips/dto/invite-member.dto.ts
```ts
import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email(),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
```

### src/modules/trips/trips.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  invites,
  members,
  trips,
  type InviteRow,
  type MemberRow,
  type NewInviteRow,
  type NewMemberRow,
  type NewTripRow,
  type TripRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- trips ----

  async insertTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  // ---- members ----

  async insertMember(row: NewMemberRow): Promise<MemberRow> {
    const [created] = await this.db.insert(members).values(row).returning();
    return created;
  }

  async findMember(tripId: string, userId: string): Promise<MemberRow | null> {
    const [row] = await this.db
      .select()
      .from(members)
      .where(and(eq(members.tripId, tripId), eq(members.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findMembersByTripId(tripId: string): Promise<MemberRow[]> {
    return this.db.select().from(members).where(eq(members.tripId, tripId));
  }

  // ---- invites ----

  async insertInvite(row: NewInviteRow): Promise<InviteRow> {
    const [created] = await this.db.insert(invites).values(row).returning();
    return created;
  }

  async findPendingInvite(tripId: string, email: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tripId, tripId),
          eq(invites.email, email),
          eq(invites.status, 'pending'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]> {
    return this.db.select().from(invites).where(
      and(eq(invites.tripId, tripId), eq(invites.status, 'pending')),
    );
  }

  async updateInviteStatus(token: string, status: string): Promise<void> {
    await this.db.update(invites).set({ status }).where(eq(invites.token, token));
  }
}
```

### src/modules/trips/trips.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InviteRow, MemberRow, TripRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteMemberDto } from './dto/invite-member.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { Member } from './entities/member.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  // ---- row -> entity mappers ----

  private toTrip(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMember(row: MemberRow): Member {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      role: row.role as 'owner' | 'member',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: InviteRow): Invite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status as 'pending' | 'accepted' | 'declined',
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- trip creation ----

  async create(dto: CreateTripDto, currentUser: CurrentUserPayload): Promise<{ trip: Trip; members: Member[] }> {
    const tripRow = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: new Date(dto.startDate),
      endsAt: new Date(dto.endDate),
    });

    await this.repo.insertMember({
      id: randomUUID(),
      tripId: tripRow.id,
      userId: currentUser.id,
      role: 'owner',
    });

    const members = await this.repo.findMembersByTripId(tripRow.id);

    return { trip: this.toTrip(tripRow), members: members.map((m) => this.toMember(m)) };
  }

  // ---- invites ----

  async invite(tripId: string, dto: InviteMemberDto, currentUser: CurrentUserPayload): Promise<Invite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const membership = await this.repo.findMember(tripId, currentUser.id);
    if (!membership || membership.role !== 'owner') {
      throw AppError.forbidden('only the trip owner can invite members', { tripId });
    }

    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) {
      return this.toInvite(existing);
    }

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
      status: 'pending',
    });

    return this.toInvite(invite);
  }

  async acceptInvite(token: string, currentUser: CurrentUserPayload): Promise<Member> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    const existing = await this.repo.findMember(invite.tripId, currentUser.id);
    if (existing) {
      return this.toMember(existing);
    }

    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: currentUser.id,
      role: 'member',
    });

    if (invite.status === 'pending') {
      await this.repo.updateInviteStatus(token, 'accepted');
    }

    return this.toMember(member);
  }

  // ---- lookup ----

  async getById(tripId: string, currentUser: CurrentUserPayload) {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const membership = await this.repo.findMember(tripId, currentUser.id);
    if (!membership) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const members = await this.repo.findMembersByTripId(tripId);
    const pendingInvites = await this.repo.findPendingInvitesByTripId(tripId);

    return {
      trip: this.toTrip(trip),
      members: members.map((m) => this.toMember(m)),
      pendingInvites: pendingInvites.map((i) => this.toInvite(i)),
    };
  }
}
```

### src/modules/trips/trips.controller.ts
```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createTripSchema, type CreateTripDto } from './dto/create-trip.dto.js';
import { inviteMemberSchema, type InviteMemberDto } from './dto/invite-member.dto.js';
import type { Member } from './entities/member.entity.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripDetail } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import { TripsService } from './trips.service.js';

/**
 * Thin by rule: validate, call the service, wrap in the envelope.
 * No Drizzle, no business logic, no ORM type in any signature.
 */
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<{ trip: Trip; members: Member[] }>> {
    const parsed = createTripSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    return ApiResult.ok(await this.trips.create(parsed.data, user));
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Invite>> {
    const parsed = inviteMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    return ApiResult.ok(await this.trips.invite(id, parsed.data, user));
  }

  @Post('invites/:token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Member>> {
    return ApiResult.ok(await this.trips.acceptInvite(token, user));
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getById(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<TripDetail>> {
    return ApiResult.ok(await this.trips.getById(id, user));
  }
}
```

### src/modules/trips/trips.module.ts
```ts
import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller.js';
import { TripsRepository } from './trips.repository.js';
import { TripsService } from './trips.service.js';

@Module({
  controllers: [TripsController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
```

### src/modules/trips/trips.service.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import type { InviteRow, MemberRow, TripRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

function now(): Date {
  return new Date('2024-01-01T00:00:00Z');
}

function fakeRepo(
  trips: TripRow[] = [],
  members: MemberRow[] = [],
  invites: InviteRow[] = [],
): TripsRepository {
  return {
    async insertTrip(row: TripRow) {
      const created = { ...row, createdAt: now(), updatedAt: now() } as TripRow;
      trips.push(created);
      return created;
    },
    async findTripById(id: string) {
      return trips.find((r) => r.id === id) ?? null;
    },
    async insertMember(row: MemberRow) {
      const created = { ...row, createdAt: now(), updatedAt: now() } as MemberRow;
      members.push(created);
      return created;
    },
    async findMember(tripId: string, userId: string) {
      return members.find((r) => r.tripId === tripId && r.userId === userId) ?? null;
    },
    async findMembersByTripId(tripId: string) {
      return members.filter((r) => r.tripId === tripId);
    },
    async insertInvite(row: InviteRow) {
      const created = { ...row, createdAt: now(), updatedAt: now() } as InviteRow;
      invites.push(created);
      return created;
    },
    async findPendingInvite(tripId: string, email: string) {
      return invites.find(
        (r) => r.tripId === tripId && r.email === email && r.status === 'pending',
      ) ?? null;
    },
    async findInviteByToken(token: string) {
      return invites.find((r) => r.token === token) ?? null;
    },
    async findPendingInvitesByTripId(tripId: string) {
      return invites.filter((r) => r.tripId === tripId && r.status === 'pending');
    },
    async updateInviteStatus(token: string, status: string) {
      const invite = invites.find((r) => r.token === token);
      if (invite) {
        invite.status = status as InviteRow['status'];
      }
    },
  } as unknown as TripsRepository;
}

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Trip',
    destination: 'Paris',
    startsAt: new Date('2025-06-01T00:00:00Z'),
    endsAt: new Date('2025-06-10T00:00:00Z'),
    createdAt: now(),
    updatedAt: now(),
    ...over,
  }) as TripRow;

const memberRow = (over: Partial<MemberRow> = {}): MemberRow =>
  ({
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    role: 'member',
    createdAt: now(),
    updatedAt: now(),
    ...over,
  }) as MemberRow;

const inviteRow = (over: Partial<InviteRow> = {}): InviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'ada@example.com',
    token: 'tok-1',
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    ...over,
  }) as InviteRow;

const ownerUser = { id: 'u1', email: 'owner@example.com' };
const memberUser = { id: 'u2', email: 'member@example.com' };

describe('TripsService', () => {
  // ---- create ----

  it('creates a trip and adds the caller as owner', async () => {
    const svc = new TripsService(fakeRepo());
    const result = await svc.create(
      {
        name: 'Bali Trip',
        destination: 'Bali',
        startDate: '2025-07-01T00:00:00Z',
        endDate: '2025-07-10T00:00:00Z',
      },
      ownerUser,
    );
    expect(result.trip.name).toBe('Bali Trip');
    expect(result.members).toHaveLength(1);
    expect(result.members[0].role).toBe('owner');
    expect(result.members[0].userId).toBe(ownerUser.id);
  });

  // ---- invite ----

  it('creates an invite when owner invites by email', async () => {
    const svc = new TripsService(fakeRepo([tripRow()]));
    const invite = await svc.invite('t1', { email: 'new@example.com' }, ownerUser);
    expect(invite.email).toBe('new@example.com');
    expect(invite.status).toBe('pending');
  });

  it('inviting the same email twice returns the existing pending invite', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [], [inviteRow()]));
    const first = await svc.invite('t1', { email: 'ada@example.com' }, ownerUser);
    const second = await svc.invite('t1', { email: 'ada@example.com' }, ownerUser);
    expect(first.id).toBe(second.id);
    expect(second.status).toBe('pending');
  });

  it('rejects invite from non-owner with forbidden', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], []));
    await expect(svc.invite('t1', { email: 'x@example.com' }, memberUser)).rejects.toThrow(
      AppError,
    );
  });

  it('rejects invite when trip does not exist', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.invite('nope', { email: 'x@example.com' }, ownerUser)).rejects.toThrow(
      AppError,
    );
  });

  // ---- accept ----

  it('accepts an invite and adds the user as a member', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [], [inviteRow()]));
    const member = await svc.acceptInvite('tok-1', memberUser);
    expect(member.userId).toBe(memberUser.id);
    expect(member.role).toBe('member');
  });

  it('accepting the same token twice is a no-op returning the membership', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], [inviteRow()]));
    const first = await svc.acceptInvite('tok-1', memberUser);
    const second = await svc.acceptInvite('tok-1', memberUser);
    expect(first.id).toBe(second.id);
    expect(first.id).toBe(memberRow().id);
  });

  it('rejects accept for a nonexistent invite', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.acceptInvite('no-token', memberUser)).rejects.toThrow(AppError);
  });

  // ---- get by id ----

  it('returns trip detail for a member', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], []));
    const detail = await svc.getById('t1', memberUser);
    expect(detail.trip.id).toBe('t1');
    expect(detail.members).toHaveLength(1);
  });

  it('rejects get by id for a non-member with not_found', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], []));
    await expect(svc.getById('t1', { id: 'nope', email: 'nobody@example.com' })).rejects.toThrow(
      AppError,
    );
  });

  it('rejects get by id for a nonexistent trip with not_found', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.getById('nope', ownerUser)).rejects.toThrow(AppError);
  });
});
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { TripsModule } from './modules/trips/trips.module.js';
import { UsersModule } from './modules/users/users.module.js';

/**
 * A new feature module is registered here. That line is the only edit a feature
 * is expected to make outside its own directory and `drizzle/`.
 */
@Module({
  imports: [DbModule, UsersModule, TripsModule],
})
export class AppModule {}
```
