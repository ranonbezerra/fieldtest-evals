# repair2-trips.service.ts

## reasoning

```
Let me analyze the compiler errors to understand what's wrong with `trips.service.ts` and what the correct file should look like.

From the errors, I can deduce:

1. **Line 7**: `import { TripViewDto } from './dto/trip-view.dto.js'` — should be `TripView` (not `TripViewDto`)
2. **Line 9**: `import { TripInvite } from './entities/trip-invites.entity.js'` — the entity file exports `tripInvites` (the table), not a `TripInvite` type. The `TripInvite` interface is defined in `trips.repository.ts`.
3. **Line 20**: `Expected 4 arguments, but got 1` — this is about `createTrip` call. The service is calling `this.repo.createTrip(someObject)` but the repo's `createTrip` only takes one argument (an object with name, destination, startDate, endDate). Wait, let me re-read. The error says "Expected 4 arguments, but got 1." That means the service is calling `createTrip` with 1 argument but it expects 4. But looking at the repository, `createTrip` takes one argument (an object). 

Wait, let me re-read the repository code. The repository has:
```typescript
async createTrip(input: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
  }): Promise<Trip> {
```

So it takes 1 argument. But the error says "Expected 4 arguments, but got 1." This is confusing. Unless the service file is calling `createTrip` differently than what I think.

Wait, looking more carefully at the error: `src/modules/trips/trips.service.ts(20,45): error TS2554: Expected 4 arguments, but got 1.`

The column 45 suggests it's at a specific position. The service is probably calling something like `this.repo.createTrip(dto)` where `dto` is a `CreateTripDto` class instance. But wait, the repo's `createTrip` takes an object with 4 fields, not a class.

Actually wait - looking at the first error in the list:
```
2345: Argument of type 'CreateTripDto' is not assignable to parameter of type 'string'.
```

This seems like a different error that's cut off. Let me look at all errors more carefully.

The first line is:
```
2345: Argument of type 'CreateTripDto' is not assignable to parameter of type 'string'.
```

This is incomplete - it's missing the file/line prefix. But it suggests that somewhere a `CreateTripDto` is being passed where a `string` is expected.

Let me think about what the service file likely looks like based on all the errors:

1. Line 7: imports `TripViewDto` from `./dto/trip-view.dto.js` — should import `TripView`
2. Line 9: imports `TripInvite` from `./entities/trip-invites.entity.js` — should import from `trips.repository.js` instead
3. Line 20: `createTrip` called with 1 arg but expects 4 — Hmm, but the repo only has 1 param. Unless the service is calling a different method.

Wait, let me reconsider. The error at line 20 col 45 says "Expected 4 arguments, but got 1." This means the method being called at that position expects 4 separate arguments. But the repository's `createTrip` takes 1 object argument. So maybe the service is calling something else, or the repo method signature is different from what I see.

Actually, wait. Let me re-read the repository more carefully. The `createTrip` method takes one argument (an object). So if the service calls `this.repo.createTrip(something)` and gets "Expected 4 arguments, but got 1", that's contradictory unless...

Hmm, unless the error is about a different method. Let me look at line 20 more carefully. If the service file has something like:

```typescript
const trip = await this.repo.createTrip(dto);
```

where `dto` is a `CreateTripDto` class instance, and the repo expects `{ name: string; destination: string; startDate: string; endDate: string; }`...

Actually wait - the error says "Expected 4 arguments, but got 1." This is TS2554 which is about the number of arguments to a function call, not about the type of the argument. So the method being called at line 20 col 45 genuinely expects 4 separate parameters.

But the repository's `createTrip` only has 1 parameter. So either:
- The service is calling a different method
- Or there's something else going on

Let me look at this differently. Maybe the service file is poorly written and calling methods incorrectly. The task is to rewrite the service to fix all these errors. Let me just write the correct service file based on:

1. The repository's actual API (which I can see)
2. The feature spec
3. The conventions
4. The errors telling me what's wrong

Let me reconstruct what the service should do:

**`createTrip(userId: string, dto: CreateTripDto)`**:
- Call `this.repo.createTrip({ name, destination, startDate, endDate })`
- Call `this.repo.addMember(trip.id, userId, 'owner')`
- Return the trip (probably as a `TripView`)

**`inviteMember(tripId: string, userId: string, email: string)`**:
- Find the trip, throw not_found if missing
- Check if user is owner, throw forbidden if not
- Check if there's already a pending invite for that email, return it if so
- Create a new invite with a token
- Return the invite

**`acceptInvite(token: string)`**:
- Find invite by token, throw not_found if missing
- If already accepted, find membership and return it (no-op)
- Update invite status to 'accepted'
- Add user as member
- Return membership

Wait, but how does `acceptInvite` know the userId? The spec says "accepting adds the user as `member`". The user must be authenticated. So the service method probably takes a userId parameter too.

**`getTrip(tripId: string, userId: string)`**:
- Find the trip, throw not_found if missing
- Check membership, throw forbidden if not a member
- Get members and pending invites
- Return a view object

Now let me look at the errors again to figure out the exact types:

- `TripView` is exported from `./dto/trip-view.dto.js` (not `TripViewDto`)
- `TripInvite` type is in `trips.repository.ts` (not in the entity file)
- The repo methods are: `createTrip`, `addMember`, `findTrip`, `isOwner`, `findMembership`, `getMembers`, `getPendingInvites`, `findPendingInvite`, `createInvite`, `findInviteByToken`, `updateInviteStatus`
- AppError codes are: `'validation_failed' | 'unauthenticated' | 'not_found' | 'conflict' | 'forbidden' | 'internal'`

Now let me look at the specific errors to understand the current (broken) service structure:

- Line 7: `import { TripViewDto } from './dto/trip-view.dto.js'` → should be `import { TripView } from './dto/trip-view.dto.js'`
- Line 9: `import { TripInvite } from './entities/trip-invites.entity.js'` → should import from `./trips.repository.js`
- Line 20: calling something with 1 arg that expects 4 → This is likely `this.repo.createTrip(dto)` where `dto` is a class instance, but the repo expects a plain object. Wait no, TS2554 is about argument count not type. 

Hmm, actually let me reconsider. Maybe the current service has a different structure. Let me think about what would produce "Expected 4 arguments, but got 1" at line 20 col 45.

If the current service has something like:
```typescript
const trip = await this.repo.createTrip(dto.name, dto.destination, dto.startDate, dto.endDate);
```
No, that would be 4 arguments.

Or if it has:
```typescript
const trip = await this.repo.createTrip({ name: dto.name, ... });
```
That's 1 argument, and the repo's createTrip takes 1 argument. So that shouldn't error.

Wait, unless the repo method signature in the actual compiled file is different from what I see. But I was given the repo file as reference. Let me re-read it...

The repo's `createTrip` takes one parameter: `input: { name: string; destination: string; startDate: string; endDate: string; }`. So calling it with one argument should be fine argument-count-wise.

Unless... the error is about a different call on line 20. Let me think about what else could be on line 20.

Actually, you know what, I think I'm overcomplicating this. The task says to rewrite the file fixing what the errors require. Let me just write the correct service file based on:
1. The repository API I can see
2. The feature spec
3. The conventions
4. Making sure all the type errors are resolved

Let me also look at what `TripView` should be. Based on the errors about `start_date`, `end_date`, `user_id` not existing (errors at lines 110-113), the current service is trying to access snake_case properties on camelCase interfaces. So the `TripView` type probably uses camelCase.

Looking at error line 110: `Property 'start_date' does not exist on type '{ id: string; createdAt: Date; updatedAt: Date; name: string; destination: string; startDate: string; endDate: string; }'. Did you mean 'startDate'?`

This tells me the `Trip` type from the repo has `startDate` and `endDate` (camelCase). The current service is incorrectly using `start_date` and `end_date`.

Similarly, `user_id` should be `userId` on the `TripMember` type.

Now, for the `TripView` type - I don't see its definition, but based on the import error, it's exported from `./dto/trip-view.dto.js` as `TripView`. I'll need to figure out its shape.

Actually, looking at the error more carefully:
- Line 22: `Argument of type '{ id: string; }' is not assignable to parameter of type '{ id: string; createdAt: Date; updatedAt: Date; name: string; destination: string; startDate: string; endDate: string; }'`

This suggests that at line 22, the service is trying to pass `{ id: string }` where a full `Trip` object is expected. This might be in the `createTrip` method where after creating the trip, it's trying to construct a view.

Let me think about what `TripView` looks like. Based on the feature spec, `GET /trips/:id` returns "trip with members and pending invites". So `TripView` probably looks like:
```typescript
interface TripView {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  members: Array<{ userId: string; role: string }>;
  pendingInvites: Array<{ email: string; token: string }>;
}
```

But I don't know the exact shape. Let me look at the errors again for clues.

Actually, I think the safest approach is to just write the service correctly based on what I know, and if I need to reference `TripView`'s shape, I'll use the `Trip` type from the repository and construct the view inline.

Wait, but the error says `TripView` is exported from `./dto/trip-view.dto.js`. So I should import it and use it as a return type. But I don't know its exact shape. Let me just use it as a type annotation and construct the object correctly.

Actually, let me reconsider the approach. The task says "Rewrite `src/modules/trips/trips.service.ts` complete, fixing what these messages require of this file." So I need to write a file that:
1. Compiles without errors
2. Implements the feature spec
3. Follows the conventions

Let me write it:

```typescript
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../common/app-error.js';
import { TripsRepository, Trip, TripMember, TripInvite } from './trips.repository.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { TripView } from './dto/trip-view.dto.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  async createTrip(userId: string, dto: CreateTripDto): Promise<Trip> {
    const trip = await this.repo.createTrip({
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    await this.repo.addMember(trip.id, userId, 'owner');
    return trip;
  }

  async inviteMember(tripId: string, userId: string, email: string): Promise<TripInvite> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const isOwner = await this.repo.isOwner(tripId, userId);
    if (!isOwner) {
      throw new AppError('forbidden', 'only the owner can invite members');
    }

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return existing;
    }

    const token = uuidv4();
    return this.repo.createInvite(tripId, email, token);
  }

  async acceptInvite(token: string, userId: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found');
    }

    if (invite.status === 'accepted') {
      const membership = await this.repo.findMembership(invite.tripId, userId);
      if (membership) {
        return membership;
      }
      // If no membership found but invite is accepted, this is an edge case
      // Just return after ensuring membership exists
      await this.repo.addMember(invite.tripId, userId, 'member');
      return this.repo.findMembership(invite.tripId, userId)!;
    }

    if (invite.status === 'declined') {
      throw new AppError('conflict', 'invite has been declined');
    }

    await this.repo.updateInviteStatus(invite.id, 'accepted');
    await this.repo.addMember(invite.tripId, userId, 'member');
    return this.repo.findMembership(invite.tripId, userId)!;
  }

  async getTrip(tripId: string, userId: string): Promise<TripView> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const membership = await this.repo.findMembership(tripId, userId);
    if (!membership) {
      throw new AppError('forbidden', 'you must be a member to view this trip');
    }

    const members = await this.repo.getMembers(tripId);
    const pendingInvites = await this.repo.getPendingInvites(tripId);

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
      pendingInvites: pendingInvites.map((i) => ({ email: i.email, token: i.token })),
    };
  }
}
```

Wait, but I need to check: does `AppError.notFound` exist? Yes, from the reference:
```typescript
static notFound(message = 'not found', details: Record<string, unknown> = {}): AppError {
    return new AppError('not_found', message, details);
}
```

And the error at line 32 says: `Argument of type '"resource_not_found"' is not assignable to parameter of type 'AppErrorCode'`. So the current service uses `'resource_not_found'` which is wrong. The correct code is `'not_found'`. But since I'm using `AppError.notFound()`, this is handled.

Now, about the `TripView` type - I don't know its exact shape. The return type of `getTrip` should match. But since I'm constructing the object inline and the type is `TripView`, as long as the object matches the type, it'll compile. The problem is I don't know what fields `TripView` has.

Hmm, but the task says to fix the file. If `TripView` is a specific type with specific fields, I need to match them. But I don't have that file. Let me look at the errors for clues...

The errors at lines 110-113 show that the current service is building the view and accessing `trip.start_date`, `trip.end_date`, `member.user_id` which don't exist (they should be `startDate`, `endDate`, `userId`). This tells me the view construction is in the `getTrip` method.

I think the safest bet is to use the `TripView` type as the return type and construct the object to match. Since I don't know the exact shape of `TripView`, I'll need to make an assumption.

Actually, wait. Let me re-read the instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should add an assumption about `TripView`'s shape. Let me think about what makes sense given the feature spec: "GET /trips/:id — trip with members and pending invites"

A reasonable `TripView` would be:
```typescript
interface TripView {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  members: { userId: string; role: 'owner' | 'member' }[];
  pendingInvites: { email: string; token: string }[];
}
```

I'll write the code to construct this shape and add an assumption comment.

Now, about the `uuid` import - I'm not sure if `uuid` is available. Let me think of alternatives. Actually, for generating tokens, I could use `crypto.randomUUID()` which is available in Node 20+. That's safer.

Let me also reconsider the `acceptInvite` method. The spec says "accepting twice is a no-op returning the membership." So if the invite is already accepted, I should just return the existing membership. I don't need to add the member again.

Let me also think about whether the service should use `InviteMemberDto`. Looking at the spec file:
```typescript
export type InviteMemberDto = string;
```

So `InviteMemberDto` is just a string (the email). The test errors show:
```
src/modules/trips/trips.service.spec.ts(124,81): error TS2345: Argument of type 'string' is not assignable to parameter of type 'InviteMemberDto'.
```

Wait, that's in the spec file, not the service. The spec is passing a `string` where `InviteMemberDto` is expected. But `InviteMemberDto` is defined as `type InviteMemberDto = string`, so a string should be assignable to it. Unless the spec file has a different import or the type is used differently.

Actually, these spec errors are not my concern - I'm only fixing `trips.service.ts`. The spec errors might be caused by the service method signature not matching what the spec expects. Let me think...

If the spec calls `service.inviteMember(tripId, userId, email)` where `email` is a `string`, and the service method signature is `inviteMember(tripId: string, userId: string, email: InviteMemberDto)`, then since `InviteMemberDto = string`, it should work. But the error says "Argument of type 'string' is not assignable to parameter of type 'InviteMemberDto'". This would only happen if `InviteMemberDto` is not actually `string` in the context of the spec, or if there's a circular import issue, or if the type is different.

Wait, actually `type InviteMemberDto = string` means `InviteMemberDto` IS `string`. A `string` is assignable to `string`. So this error shouldn't occur unless the spec is importing a different `InviteMemberDto` or the file is different.

Hmm, but these are errors in the spec file, and the task says to fix `trips.service.ts`. The spec errors might be pre-existing or might be resolved once the service is fixed (if the service's method signatures affect how the spec's calls are type-checked).

Actually, I think the spec errors might be because the spec is calling the service method with the wrong number of arguments or wrong types, and once I fix the service, the spec might still have issues. But the task says "Change nothing the messages do not name." The messages name `trips.service.ts` and `trips.service.spec.ts`. But the task specifically says "Rewrite `src/modules/trips/trips.service.ts` complete, fixing what these messages require of this file."

So I should only fix `trips.service.ts`. The spec errors might be a consequence of the service having wrong signatures, and fixing the service might fix the spec too. Or they might be separate issues.

Let me focus on making `trips.service.ts` correct. The spec errors about `InviteMemberDto` suggest that the service's `inviteMember` method should accept a `string` (or `InviteMemberDto`) as the email parameter. Since `InviteMemberDto = string`, using either should work.

Actually, I just realized - maybe the issue is that the current service defines the email parameter as `InviteMemberDto` (which is `string`), but the spec is passing it as a separate argument in a way that doesn't match. Or maybe the current service has a different method signature.

Let me just write the service with `email: string` for the invite method, since that's the simplest and most correct.

Wait, actually looking at the spec errors more carefully:
```
src/modules/trips/trips.service.spec.ts(124,81): error TS2345: Argument of type 'string' is not assignable to parameter of type 'InviteMemberDto'.
```

Column 81 suggests it's deep in the line. If the spec has something like:
```typescript
await service.inviteMember(tripId, userId, 'test@example.com');
```

And the service method is:
```typescript
async inviteMember(tripId: string, userId: string, email: InviteMemberDto): Promise<TripInvite>
```

Since `InviteMemberDto = string`, this should work. Unless there's a type resolution issue.

You know what, I think these spec errors might just be a side effect of the service not compiling properly (when the service has type errors, downstream type checking can produce cascading errors). Once the service is fixed, the spec errors might resolve.

Let me just write the correct service file. Here's my plan:

```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { TripsRepository, Trip, TripMember, TripInvite } from './trips.repository.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { TripView } from './dto/trip-view.dto.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  async createTrip(userId: string, dto: CreateTripDto): Promise<Trip> {
    const trip = await this.repo.createTrip({
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    await this.repo.addMember(trip.id, userId, 'owner');
    return trip;
  }

  async inviteMember(tripId: string, userId: string, email: string): Promise<TripInvite> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const isOwner = await this.repo.isOwner(tripId, userId);
    if (!isOwner) {
      throw new AppError('forbidden', 'only the owner can invite members');
    }

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return existing;
    }

    return this.repo.createInvite(tripId, email, randomUUID());
  }

  async acceptInvite(token: string, userId: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found');
    }

    if (invite.status === 'accepted') {
      const membership = await this.repo.findMembership(invite.tripId, userId);
      if (membership) {
        return membership;
      }
    }

    if (invite.status === 'declined') {
      throw new AppError('conflict', 'this invite has been declined');
    }

    await this.repo.updateInviteStatus(invite.id, 'accepted');
    await this.repo.addMember(invite.tripId, userId, 'member');
    const membership = await this.repo.findMembership(invite.tripId, userId);
    if (!membership) {
      throw new AppError('internal', 'failed to create membership');
    }
    return membership;
  }

  async getTrip(tripId: string, userId: string): Promise<TripView> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const membership = await this.repo.findMembership(tripId, userId);
    if (!membership) {
      throw new AppError('forbidden', 'you must be a member to view this trip');
    }

    const members = await this.repo.getMembers(tripId);
    const pendingInvites = await this.repo.getPendingInvites(tripId);

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
      pendingInvites: pendingInvites.map((i) => ({ email: i.email, token: i.token })),
    };
  }
}
```

Now, the question is: will this compile? The main uncertainty is the `TripView` type. If `TripView` has a different shape than what I'm constructing, it won't compile. But based on the feature spec and the errors (which show the current code is trying to construct a view with trip fields + members + invites), I think this is the right shape.

Let me also double-check the import paths. The repo is at `./trips.repository.js` (ESM with .js extension for TS). The common file is at `../../common/app-error.js` (going up from `src/modules/trips/` to `src/` then into `common/`).

Wait, let me check the layout:
```
src/modules/trips/trips.service.ts
src/common/app-error.ts
```

So from `src/modules/trips/`, to get to `src/common/`, I go `../../common/app-error.js`. Yes, that's correct.

For the DTO:
```
src/modules/trips/dto/create-trip.dto.ts
src/modules/trips/dto/trip-view.dto.ts
```

So `./dto/create-trip.dto.js` and `./dto/trip-view.dto.js` are correct.

One thing I'm not sure about: does the project use `.js` extensions in imports? Looking at the error messages, they reference `./dto/trip-view.dto.js` and `./entities/trip-invites.entity.js`, so yes, the project uses `.js` extensions in imports (standard for ESM TypeScript).

Let me also make sure I'm not importing `InviteMemberDto` since the spec errors suggest there might be an issue with it. I'll just use `string` for the email parameter.

Actually, wait. Let me reconsider the `acceptInvite` method. The spec says "accepting twice is a no-op returning the membership." This means:
1. First accept: update invite to accepted, add member, return membership
2. Second accept: invite is already accepted, find and return existing membership (no changes)

My current implementation handles this. If the invite is already accepted, I look up the membership and return it. If for some reason the membership doesn't exist (edge case), I fall through to re-add it. But actually, if the invite is accepted, the membership should always exist (it was created on first accept). So I can simplify:

```typescript
if (invite.status === 'accepted') {
  const membership = await this.repo.findMembership(invite.tripId, userId);
  if (membership) {
    return membership;
  }
  // Fallback: shouldn't happen, but handle gracefully
  await this.repo.addMember(invite.tripId, userId, 'member');
  const m = await this.repo.findMembership(invite.tripId, userId);
  if (!m) throw new AppError('internal', 'failed to create membership');
  return m;
}
```

Actually, for the "no-op" case, I should just return the membership without any side effects. If the membership exists, return it. If it doesn't exist (shouldn't happen), that's an internal error. Let me keep it simple:

```typescript
if (invite.status === 'accepted') {
  const membership = await this.repo.findMembership(invite.tripId, userId);
  if (!membership) {
    throw new AppError('internal', 'membership not found for accepted invite');
  }
  return membership;
}
```

This is cleaner. The "no-op" means no database writes, just a read and return.

Let me finalize my solution. I'll also add the `// ASSUMPTION:` comment about `TripView`'s shape since I can't see its definition.

Actually, one more thought: the `createTrip` return type. Should it return `Trip` or `TripView`? The spec says "create trip (name, destination, date range). Creator becomes owner member." It doesn't specify what the response looks like in detail. I'll return `Trip` for now since that's what the repo returns. The controller can shape the response.

Wait, but looking at the error at line 22:
```
src/modules/trips/trips.service.ts(22,31): error TS2345: Argument of type '{ id: string; }' is not assignable to parameter of type '{ id: string; createdAt: Date; updatedAt: Date; name: string; destination: string; startDate: string; endDate: string; }'.
```

This suggests the current service at line 22 is trying to pass `{ id: string }` somewhere a full `Trip` is expected. This might be in a method that takes a `Trip` parameter. Or it could be that the current service is doing something like:

```typescript
const trip = { id: someId }; // incomplete object
// then passing it somewhere that expects Trip
```

In my rewrite, I don't do this, so this error is resolved.

I think my solution is solid. Let me write the final version.

One more consideration: should I use `@Injectable()` decorator? Yes, it's a NestJS service, so it needs the decorator for DI.

And the import for `randomUUID` - in Node 20+, `crypto.randomUUID()` is available. The import would be:
```typescript
import { randomUUID } from 'node:crypto';
```

This is available in Node 20+ without any additional packages.

Let me write the final file.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { TripsRepository, Trip, TripMember, TripInvite } from './trips.repository.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { TripView } from './dto/trip-view.dto.js';

// ASSUMPTION: TripView is shaped as { id, name, destination, startDate, endDate, members: { userId, role }[], pendingInvites: { email, token }[] } — the exact definition is not visible.

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  async createTrip(userId: string, dto: CreateTripDto): Promise<Trip> {
    const trip = await this.repo.createTrip({
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    await this.repo.addMember(trip.id, userId, 'owner');
    return trip;
  }

  async inviteMember(tripId: string, userId: string, email: string): Promise<TripInvite> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const isOwner = await this.repo.isOwner(tripId, userId);
    if (!isOwner) {
      throw new AppError('forbidden', 'only the owner can invite members');
    }

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return existing;
    }

    return this.repo.createInvite(tripId, email, randomUUID());
  }

  async acceptInvite(token: string, userId: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found');
    }

    if (invite.status === 'accepted') {
      const membership = await this.repo.findMembership(invite.tripId, userId);
      if (!membership) {
        throw new AppError('internal', 'membership not found for accepted invite');
      }
      return membership;
    }

    if (invite.status === 'declined') {
      throw new AppError('conflict', 'this invite has been declined');
    }

    await this.repo.updateInviteStatus(invite.id, 'accepted');
    await this.repo.addMember(invite.tripId, userId, 'member');
    const membership = await this.repo.findMembership(invite.tripId, userId);
    if (!membership) {
      throw new AppError('internal', 'failed to create membership');
    }
    return membership;
  }

  async getTrip(tripId: string, userId: string): Promise<TripView> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const membership = await this.repo.findMembership(tripId, userId);
    if (!membership) {
      throw new AppError('forbidden', 'you must be a member to view this trip');
    }

    const members = await this.repo.getMembers(tripId);
    const pendingInvites = await this.repo.getPendingInvites(tripId);

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
      pendingInvites: pendingInvites.map((i) => ({ email: i.email, token: i.token })),
    };
  }
}
```
