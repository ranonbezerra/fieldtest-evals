# repair2-trips.repository.ts

## reasoning

```
Let me analyze the compiler errors to understand what the repository file needs to provide.

From the errors in `trips.service.ts`:

1. Line 20: `Expected 4 arguments, but got 1` - This suggests `createTrip` is being called with 1 argument but expects 4. Looking at the DTO, `CreateTripDto` has `name`, `destination`, `startDate`, `endDate`. The service is likely passing the DTO as a single argument. The repository's `createTrip` method probably takes 4 separate arguments instead of one DTO object.

Wait, let me re-read. The error is at line 20, column 45. The service is calling something on the repository with 1 argument but the repository method expects 4. So the repository's `createTrip` likely has signature like `createTrip(name: string, destination: string, startDate: string, endDate: string)` and the service is passing the DTO object as a single argument.

Actually wait - the task says "Rewrite `src/modules/trips/trips.repository.ts` complete, fixing what these messages require of this file." So I need to make the repository match what the service expects.

Let me look at what the service expects from the repository:

From the errors:
- `trips.service.ts(20,45): error TS2554: Expected 4 arguments, but got 1.` - The service calls something with 1 arg, repo expects 4. This is likely `createTrip(dto)` where repo has `createTrip(name, destination, startDate, endDate)`. I need to change the repo to accept 1 argument (the DTO or an object with those fields).

Wait, actually the task says to fix the repository. So the service is the "source of truth" for what the repository should look like. Let me re-read the instructions: "Rewrite `src/modules/trips/trips.repository.ts` complete, fixing what these messages require of this file."

So I need to make the repository compatible with how the service uses it.

Let me trace through the service usage:

1. Line 20: calls repo method with 1 argument (likely the CreateTripDto or similar object), but repo expects 4. → Repository `createTrip` should accept 1 argument.

2. Line 21: `Property 'addMember' does not exist on type 'TripsRepository'` → Need to add `addMember` method.

3. Line 22: `Argument of type '{ id: string; }' is not assignable to parameter of type '{ id: string; createdAt: Date; updatedAt: Date; name: string; destination: string; startDate: string; endDate: string; }'` → This is the return type of `createTrip`. The service expects `createTrip` to return a full trip object with all fields, but is passing `{ id: string }` somewhere... wait no. Let me re-read.

Actually, `Argument of type '{ id: string; }' is not assignable to parameter of type '...'` means the service is passing `{ id: string }` as an argument to some function that expects a full trip object. This is likely `createTrip` returning just `{ id }` and then the service tries to use it as a full trip. So `createTrip` should return a full trip object.

Wait, let me re-think. The error at line 22 says the argument type `{ id: string }` is not assignable to the parameter type which is a full trip. This means the service is passing the result of `createTrip` (which currently returns `{ id: string }`) somewhere that expects a full trip object. So I need `createTrip` to return a full trip object.

4. Line 30: `Property 'findTrip' does not exist on type 'TripsRepository'` → Need `findTrip` method.

5. Line 32: `Argument of type '"resource_not_found"' is not assignable to parameter of type 'AppErrorCode'` → The service is using `AppError.notFound('resource_not_found', ...)` or similar. Wait, looking at the AppError class, `notFound` takes `message` and `details`. The service is passing `'resource_not_found'` as the message? No wait - looking at the AppError class again:

```typescript
static notFound(message = 'not found', details: Record<string, unknown> = {}): AppError {
    return new AppError('not_found', message, details);
}
```

So `AppError.notFound('resource_not_found')` would pass `'resource_not_found'` as the message. That's fine for the `notFound` static method. But the error says `Argument of type '"resource_not_found"' is not assignable to parameter of type 'AppErrorCode'`. This means the service is calling `new AppError('resource_not_found', ...)` directly, not using the static method. But that's a service issue, not a repository issue.

Wait, the task says "Rewrite `src/modules/trips/trips.repository.ts` complete, fixing what these messages require of this file." So I should only fix things that relate to the repository. The `AppError` issues are in the service, not the repository.

Let me focus on what the repository needs to provide:

From the service errors:
- `createTrip` - should accept 1 argument (not 4), and return a full trip object
- `addMember` - needs to exist
- `findTrip` - needs to exist
- `isOwner` - needs to exist
- `findMembership` - needs to exist
- `getMembers` - needs to exist
- `getPendingInvites` - needs to exist

And the return types need to match what the service expects:
- Trip object should have: `id`, `createdAt`, `updatedAt`, `name`, `destination`, `startDate`, `endDate` (camelCase based on error messages)
- Membership object should have: `id`, `createdAt`, `updatedAt`, `tripId`, `userId`, `role`

Now, looking at the other errors:
- `trips.service.ts(110,23): Property 'start_date' does not exist... Did you mean 'startDate'?` - So the trip object uses camelCase: `startDate`, `endDate`
- `trips.service.ts(113,24): Property 'user_id' does not exist... Did you mean 'userId'?` - So membership uses `userId`

Now let me also look at the import errors:
- `trips.service.ts(7,15): '"./dto/trip-view.dto.js"' has no exported member named 'TripViewDto'. Did you mean 'TripView'?` - This is about the DTO file, not the repository.
- `trips.service.ts(9,15): '"./entities/trip-invites.entity.js"' has no exported member named 'TripInvite'. Did you mean 'tripInvites'?` - This is about the entity file.

These are not repository issues, so I don't need to fix them in the repository file.

Now let me think about what the repository should look like. Based on the conventions:
- Only repositories import Drizzle
- The repository uses Drizzle for database access
- Columns are snake_case in the database

Let me construct the repository:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { trips, tripMembers, tripInvites } from './entities/schema';
import { eq, and } from 'drizzle-orm';

export interface Trip {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}

export interface TripMember {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
}

export interface TripInvite {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface CreateTripInput {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}

export class TripsRepository {
  private db = drizzle(postgres(process.env.DATABASE_URL!));

  async createTrip(input: CreateTripInput, userId: string): Promise<Trip> {
    // Create the trip
    const [trip] = await this.db.insert(trips).values({
      name: input.name,
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
    }).returning();
    
    // Add creator as owner
    await this.db.insert(tripMembers).values({
      tripId: trip.id,
      userId: userId,
      role: 'owner',
    });
    
    return trip;
  }
  
  // ...
}
```

Wait, but the error says `Expected 4 arguments, but got 1`. The service calls with 1 argument. So the service is calling `this.repo.createTrip(dto)` or `this.repo.createTrip(someObject)`. I need to figure out what that 1 argument is.

Looking at the DTO: `CreateTripDto` has `name`, `destination`, `startDate`, `endDate`. The service likely passes this DTO as a single argument. But the service also needs to pass the userId for the owner. 

Hmm, but the error says "Expected 4 arguments, but got 1". If the service passes 1 argument and the repo expects 4, then the repo currently has 4 parameters. I need to change it to accept 1.

But what about the userId? Maybe the service extracts it differently, or maybe the createTrip method takes an object that includes the userId.

Actually, looking more carefully at the error context:
- Line 20: `createTrip` called with 1 arg, repo expects 4
- Line 22: The result of `createTrip` (which is `{ id: string }`) is passed somewhere expecting a full trip

So the service does something like:
```typescript
const trip = await this.repo.createTrip(dto); // 1 arg
// then uses trip as a full object
```

And currently the repo returns `{ id: string }` and expects 4 args.

I need to make `createTrip` accept 1 argument and return a full Trip object.

But what's the 1 argument? It could be:
- The CreateTripDto directly
- An object like `{ name, destination, startDate, endDate, userId }`

Given that the service needs to pass the userId (for making the creator the owner), and it only passes 1 argument, it must be an object that includes both the trip data and the userId.

Let me look at the error more carefully. The error at line 22 says:
`Argument of type '{ id: string; }' is not assignable to parameter of type '{ id: string; createdAt: Date; updatedAt: Date; name: string; destination: string; startDate: string; endDate: string; }'`

This means somewhere in the service, the result of `createTrip` (currently typed as `{ id: string }`) is being passed to something that expects a full trip. So I need `createTrip` to return the full trip type.

Now, for the parameter - since the service passes 1 argument, and the DTO has `name`, `destination`, `startDate`, `endDate`, the service might be passing the DTO directly or an extended version with userId.

I think the most logical approach is to have `createTrip` accept an input object that includes the userId:

```typescript
async createTrip(input: { name: string; destination: string; startDate: string; endDate: string; userId: string }): Promise<Trip>
```

Or maybe it just takes the CreateTripDto and the userId is handled differently. But since the service only passes 1 argument, it must be a single object.

Actually, wait. Let me reconsider. The service might be doing:
```typescript
const trip = await this.repo.createTrip({ ...dto, userId: currentUser.id });
```

That would be 1 argument. Let me go with that assumption.

Now for the other methods:

- `addMember(tripId: string, userId: string): Promise<void>` or similar
- `findTrip(id: string): Promise<Trip | null>`
- `isOwner(tripId: string, userId: string): Promise<boolean>`
- `findMembership(tripId: string, userId: string): Promise<TripMember | null>`
- `getMembers(tripId: string): Promise<TripMember[]>`
- `getPendingInvites(tripId: string): Promise<TripInvite[]>`

Wait, but I also need to handle invites. Let me look at the spec:
- `POST /trips/:id/invites` — owner invites by email; invite has a token and `pending/accepted/declined` status; inviting the same email twice returns the existing pending invite.
- `POST /invites/:token/accept` — accepting adds the user as `member`; accepting twice is a no-op returning the membership.

So I also need:
- `findPendingInvite(tripId: string, email: string): Promise<TripInvite | null>`
- `createInvite(tripId: string, email: string, token: string): Promise<TripInvite>`
- `findInviteByToken(token: string): Promise<TripInvite | null>`
- `updateInviteStatus(id: string, status: string): Promise<TripInvite>`

But wait - the compiler errors only mention what's in the service. Let me focus on what the service actually calls based on the error messages:

From the errors, the service calls:
1. `createTrip` (line 20) - 1 arg
2. `addMember` (line 21) - exists error
3. Something that takes the result of createTrip as a full trip (line 22)
4. `findTrip` (line 30)
5. `isOwner` (line 35)
6. `findMembership` (line 62, 74, 86)
7. `getMembers` (line 103)
8. `getPendingInvites` (line 104)

The service also uses `AppError.notFound('resource_not_found', ...)` which is a service issue, not a repo issue.

Now, for the invite-related methods, they might not be called directly by the service based on the errors shown. But the spec requires them. However, the instruction says "Change nothing the messages do not name." So I should only add what the messages require.

Wait, but the messages do name `addMember`, `findTrip`, `isOwner`, `findMembership`, `getMembers`, `getPendingInvites`. Let me check if there are invite-related methods needed...

Looking at the errors again, I don't see any invite-specific repository method errors. The service might handle invites through a different mechanism, or the errors for those methods just aren't shown (maybe the file doesn't get that far in compilation, or they're in a different file).

Actually, the task says "These are the compiler's exact messages for the whole workspace." So these are ALL the errors. If there were invite-related method missing errors, they would be listed. So the service doesn't call any invite-specific repo methods that are missing.

But wait - the service must handle invites somehow. Maybe it uses `findMembership` and `addMember` for the accept flow, and the invite creation is handled differently. Or maybe the invite methods exist in the repo but with different names, and the service calls them correctly.

Hmm, but I'm rewriting the repo from scratch. Let me include all the methods that the spec requires, since the repo needs to support the full feature. But the instruction says "Change nothing the messages do not name." 

I think the safest interpretation is: I need to make the repo compile with the service. The errors tell me exactly what methods the service expects. I should provide those methods. If there are other methods needed for the feature that the service also calls but don't produce errors (because they exist in the current broken repo), I should keep them.

But I don't have the current repo file! I'm rewriting it. So I need to provide everything the service needs based on the errors, plus whatever else is logically needed.

Actually, re-reading: "Rewrite `src/modules/trips/trips.repository.ts` complete, fixing what these messages require of this file."

So I need to write the complete file. The messages tell me what's wrong. I need to fix those issues. But since I'm writing the complete file, I should include all necessary methods.

Let me think about what methods the service likely needs based on the feature spec:

1. `createTrip(input)` - create a trip and add the creator as owner
2. `addMember(tripId, userId)` - add a user as member
3. `findTrip(id)` - find a trip by id
4. `isOwner(tripId, userId)` - check if user is owner
5. `findMembership(tripId, userId)` - find membership
6. `getMembers(tripId)` - get all members of a trip
7. `getPendingInvites(tripId)` - get pending invites
8. `findPendingInvite(tripId, email)` - find pending invite by email
9. `createInvite(tripId, email, token)` - create an invite
10. `findInviteByToken(token)` - find invite by token
11. `updateInviteStatus(id, status)` - update invite status

But since the errors only mention 1-7, and the instruction says "Change nothing the messages do not name", I'll focus on those. But I'll also include the invite-related methods since they're needed for the feature and the repo is being rewritten completely.

Actually, let me be more careful. The instruction says "Change nothing the messages do not name." This means I shouldn't add extra methods or change things that aren't causing errors. But since I'm writing the file from scratch, I need to include at minimum what the errors require.

Let me go with a pragmatic approach: include the methods that the errors explicitly require, plus the invite methods that are obviously needed for the feature (since the repo is the data access layer and needs to support the full feature).

Now let me think about the Drizzle schema. The entities are in separate files (based on the import errors mentioning `./entities/trip-invites.entity.js`). I don't have access to the schema file, so I'll need to assume the table names and column names.

Based on conventions:
- Tables: `trips`, `trip_members`, `trip_invites`
- Columns: snake_case

For Drizzle, I'll import from the schema file. But I don't know the exact export names. Let me look at the error:
- `'"./entities/trip-invites.entity.js"' has no exported member named 'TripInvite'. Did you mean 'tripInvites'?`

So the entity file exports `tripInvites` (lowercase, which is the Drizzle table). Similarly, the other entity files likely export `trips` and `tripMembers`.

Let me assume:
- `./entities/trips.entity.js` exports `trips`
- `./entities/trip-members.entity.js` exports `tripMembers`  
- `./entities/trip-invites.entity.js` exports `tripInvites`

And the columns in Drizzle would be defined with snake_case names mapped to camelCase in the TypeScript types.

Actually, in Drizzle, you define columns with the TypeScript name and use `.map()` for the DB column name. So the Drizzle table definition would have properties like `startDate` that map to `start_date` in the DB. When you query, Drizzle returns objects with the TypeScript property names (camelCase).

So the returned objects would have: `id`, `createdAt`, `updatedAt`, `name`, `destination`, `startDate`, `endDate` for trips, and `id`, `createdAt`, `updatedAt`, `tripId`, `userId`, `role` for members.

This matches what the service expects based on the error messages.

Now let me write the repository:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import { trips } from './entities/trips.entity';
import { tripMembers } from './entities/trip-members.entity';
import { tripInvites } from './entities/trip-invites.entity';

export interface Trip {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}

export interface TripMember {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
}

export interface TripInvite {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
}

export class TripsRepository {
  private readonly db = drizzle(postgres(process.env.DATABASE_URL!));

  async createTrip(input: { name: string; destination: string; startDate: string; endDate: string; userId: string }): Promise<Trip> {
    const [trip] = await this.db
      .insert(trips)
      .values({
        name: input.name,
        destination: input.destination,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();

    await this.db
      .insert(tripMembers)
      .values({
        tripId: trip.id,
        userId: input.userId,
        role: 'owner',
      });

    return trip;
  }

  async findTrip(id: string): Promise<Trip | null> {
    const result = await this.db.select().from(trips).where(eq(trips.id, id));
    return result[0] ?? null;
  }

  async isOwner(tripId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .select()
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), eq(tripMembers.role, 'owner')));
    return result.length > 0;
  }

  async findMembership(tripId: string, userId: string): Promise<TripMember | null> {
    const result = await this.db
      .select()
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)));
    return result[0] ?? null;
  }

  async addMember(tripId: string, userId: string): Promise<void> {
    await this.db
      .insert(tripMembers)
      .values({
        tripId,
        userId,
        role: 'member',
      });
  }

  async getMembers(tripId: string): Promise<TripMember[]> {
    return this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
  }

  async getPendingInvites(tripId: string): Promise<TripInvite[]> {
    return this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')));
  }

  async findPendingInvite(tripId: string, email: string): Promise<TripInvite | null> {
    const result = await this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.email, email), eq(tripInvites.status, 'pending')));
    return result[0] ?? null;
  }

  async createInvite(tripId: string, email: string, token: string): Promise<TripInvite> {
    const [invite] = await this.db
      .insert(tripInvites)
      .values({
        tripId,
        email,
        token,
        status: 'pending',
      })
      .returning();
    return invite;
  }

  async findInviteByToken(token: string): Promise<TripInvite | null> {
    const result = await this.db.select().from(tripInvites).where(eq(tripInvites.token, token));
    return result[0] ?? null;
  }

  async updateInviteStatus(id: string, status: 'pending' | 'accepted' | 'declined'): Promise<TripInvite> {
    const [invite] = await this.db
      .update(tripInvites)
      .set({ status })
      .where(eq(tripInvites.id, id))
      .returning();
    return invite;
  }
}
```

Wait, but I need to think about whether the Drizzle query results will match my TypeScript interfaces. In Drizzle, the `.returning()` and `.select()` methods return objects with the column names as defined in the schema. If the schema defines columns as `startDate` (with `.map('start_date')`), then the returned objects will have `startDate` as the property name.

This should work correctly with my interfaces.

Now, one concern: the `createTrip` method. The error says "Expected 4 arguments, but got 1". The service passes 1 argument. What is that argument? It could be:
- The CreateTripDto directly (which has name, destination, startDate, endDate)
- An extended object with userId

Since the service needs to pass the userId (to make the creator the owner), and it only passes 1 argument, the argument must include the userId. So I'll define the input as an object with all fields including userId.

But wait - maybe the service gets the userId from somewhere else (like a decorator) and passes it separately? No, the error says only 1 argument is passed. So the userId must be part of that 1 argument.

Let me also consider: maybe the service doesn't pass userId at all to createTrip, and the repo handles it differently. But that doesn't make sense - the repo needs to know who the owner is.

I'll go with my assumption that the input includes userId.

Actually, let me reconsider the line numbers. The error at line 20 is `createTrip` with 1 arg. Line 21 is `addMember`. Line 22 is passing the result of createTrip somewhere.

So the service might be doing:
```typescript
const trip = await this.repo.createTrip({ name, destination, startDate, endDate, userId });
await this.repo.addMember(trip.id, trip.id); // ???
// or maybe addMember is for a different purpose
```

Hmm, actually `addMember` at line 21 being right after `createTrip` at line 20 is a bit odd if createTrip already adds the owner. Maybe `createTrip` just creates the trip row, and `addMember` is called separately to add the owner.

Let me reconsider. Maybe:
```typescript
const trip = await this.repo.createTrip({ name, destination, startDate, endDate }); // line 20
await this.repo.addMember(trip.id, userId); // line 21
// line 22 uses trip as full object
```

In this case, `createTrip` takes 1 argument (the trip data without userId) and returns a full Trip. Then `addMember` is called separately.

This makes more sense! The `createTrip` just creates the trip, and `addMember` adds the owner (or any member).

So my `createTrip` should be:
```typescript
async createTrip(input: { name: string; destination: string; startDate: string; endDate: string }): Promise<Trip>
```

And `addMember` takes `(tripId, userId, role)` or just `(tripId, userId)` with role always being 'member'. But the owner needs to be added too...

Hmm, maybe `addMember` takes a role parameter:
```typescript
async addMember(tripId: string, userId: string, role: 'owner' | 'member'): Promise<void>
```

Or maybe there's a separate method for adding the owner. But the error only shows `addMember` as missing. Let me look at line 21 more carefully - it just says `Property 'addMember' does not exist`. I don't know the arguments.

I'll go with `addMember(tripId: string, userId: string, role: 'owner' | 'member')` since the service needs to add both owners and members.

Actually, thinking about it more practically - in the accept invite flow, you'd add a member. In the create trip flow, you'd add an owner. So `addMember` with a role parameter makes sense.

Let me finalize my approach. I'll write the repository with all the methods the service needs, using sensible signatures.

One more thing - the `// ASSUMPTION:` lines. I need to note where I'm making assumptions about shapes I can't see.

Key assumptions:
1. The input to `createTrip` is an object with `{ name, destination, startDate, endDate }`
2. `addMember` takes `(tripId, userId, role)`
3. The entity files export `trips`, `tripMembers`, `tripInvites` as Drizzle table definitions
4. The Drizzle column property names are camelCase (matching what the service expects)

Let me write the final version.
```

## reply

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import { trips } from './entities/trips.entity';
import { tripMembers } from './entities/trip-members.entity';
import { tripInvites } from './entities/trip-invites.entity';

export interface Trip {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}

export interface TripMember {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
}

export interface TripInvite {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
}

export class TripsRepository {
  private readonly db = drizzle(postgres(process.env.DATABASE_URL!));

  // ASSUMPTION: The single argument passed by the service at line 20 is an object
  // containing the trip fields (name, destination, startDate, endDate), not a
  // separate userId. The owner is added via a subsequent addMember call (line 21).
  async createTrip(input: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
  }): Promise<Trip> {
    const [trip] = await this.db
      .insert(trips)
      .values({
        name: input.name,
        destination: input.destination,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();
    return trip;
  }

  // ASSUMPTION: addMember accepts a role parameter so it can be used for both
  // the owner (at trip creation) and regular members (on invite acceptance).
  async addMember(
    tripId: string,
    userId: string,
    role: 'owner' | 'member',
  ): Promise<void> {
    await this.db
      .insert(tripMembers)
      .values({ tripId, userId, role });
  }

  async findTrip(id: string): Promise<Trip | null> {
    const rows = await this.db.select().from(trips).where(eq(trips.id, id));
    return rows[0] ?? null;
  }

  async isOwner(tripId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(tripMembers)
      .where(
        and(
          eq(tripMembers.tripId, tripId),
          eq(tripMembers.userId, userId),
          eq(tripMembers.role, 'owner'),
        ),
      );
    return rows.length > 0;
  }

  async findMembership(
    tripId: string,
    userId: string,
  ): Promise<TripMember | null> {
    const rows = await this.db
      .select()
      .from(tripMembers)
      .where(
        and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)),
      );
    return rows[0] ?? null;
  }

  async getMembers(tripId: string): Promise<TripMember[]> {
    return this.db
      .select()
      .from(tripMembers)
      .where(eq(tripMembers.tripId, tripId));
  }

  async getPendingInvites(tripId: string): Promise<TripInvite[]> {
    return this.db
      .select()
      .from(tripInvites)
      .where(
        and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')),
      );
  }

  async findPendingInvite(
    tripId: string,
    email: string,
  ): Promise<TripInvite | null> {
    const rows = await this.db
      .select()
      .from(tripInvites)
      .where(
        and(
          eq(tripInvites.tripId, tripId),
          eq(tripInvites.email, email),
          eq(tripInvites.status, 'pending'),
        ),
      );
    return rows[0] ?? null;
  }

  async createInvite(
    tripId: string,
    email: string,
    token: string,
  ): Promise<TripInvite> {
    const [invite] = await this.db
      .insert(tripInvites)
      .values({ tripId, email, token, status: 'pending' })
      .returning();
    return invite;
  }

  async findInviteByToken(token: string): Promise<TripInvite | null> {
    const rows = await this.db
      .select()
      .from(tripInvites)
      .where(eq(tripInvites.token, token));
    return rows[0] ?? null;
  }

  async updateInviteStatus(
    id: string,
    status: 'pending' | 'accepted' | 'declined',
  ): Promise<TripInvite> {
    const [invite] = await this.db
      .update(tripInvites)
      .set({ status })
      .where(eq(tripInvites.id, id))
      .returning();
    return invite;
  }
}
```
