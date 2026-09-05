# repair1-trips.service.spec.ts

## reasoning

```
Let me analyze the compiler errors for `trips.service.spec.ts`:

1. Line 2: `Cannot find module './trips.service'` - relative import without extension
2. Line 3: `Cannot find module './trips.repository'` - relative import without extension
3. Line 4: `Cannot find module './dto/create-trip.dto'` - relative import without extension
4. Line 5: `Cannot find module './dto/invite-trip.dto'` - relative import without extension
5. Line 6: `Cannot find module './entities/trip.entity'` - relative import without extension
6. Line 7: `Cannot find module './entities/trip-member.entity'` - relative import without extension
7. Line 8: `Cannot find module './entities/trip-invite.entity'` - relative import without extension
8. Line 10: `Cannot find namespace 'vi'` - needs import from vitest
9. Line 23: `Cannot find namespace 'vi'` - same
10. Line 66: `Cannot find namespace 'vi'` - same
11. Line 69: `Cannot find name 'beforeEach'` - needs import from vitest

The errors tell me:
- The project uses ESM with `node16` or `nodenext` module resolution (evidenced by the error in trips.service.ts about needing explicit file extensions)
- So all relative imports need `.js` extension
- `vi` and `beforeEach` need to be imported from 'vitest'

Now let me look at what the spec file should contain based on the PLAN.md:

The tests are:
1. `createTrip` returns the trip and inserts an owner membership for the creator.
2. `createTrip` raises `invalid_date_range` when startDate equals endDate.
3. `inviteToTrip` on a non-existent trip raises `trip_not_found`.
4. `inviteToTrip` by a non-owner raises `not_the_owner`.
5. `inviteToTrip` by the owner creates a pending invite with a token.
6. `inviteToTrip` with the same email twice returns the existing pending invite (no second row).
7. `acceptInvite` with an unknown token raises `invite_not_found`.
8. `acceptInvite` for a valid pending invite marks it accepted and inserts a member row.
9. `acceptInvite` for an already-accepted invite is a no-op returning the existing membership.
10. `acceptInvite` by a user whose email does not match the invite raises `invite_not_found`.
11. `getTrip` for a non-member raises `not_a_member`.
12. `getTrip` for a member returns trip fields, members array, and only pending invites.
13. `getTrip` for a non-existent trip raises `trip_not_found`.

Now, looking at the service interface from the plan:
```ts
@Injectable()
export class TripsService {
  constructor(repo: TripsRepository) {}

  createTrip(dto: CreateTripDto, creatorId: number): Promise<Trip>;
  inviteToTrip(tripId: number, dto: InviteTripDto, ownerId: number): Promise<TripInvite>;
  acceptInvite(token: string, userId: number): Promise<TripMember>;
  getTrip(tripId: number, requesterId: number): Promise<GetTripResponseDto>;
}
```

And the repository interface:
```ts
export interface TripsRepository {
  create(data: { name: string; destination: string; startDate: Date; endDate: Date }): Promise<Trip>;
  findById(id: number): Promise<Trip | null>;
  addMember(tripId: number, userId: number, role: MemberRole): Promise<TripMember>;
  isMember(tripId: number, userId: number): Promise<boolean>;
  getMembers(tripId: number): Promise<TripMember[]>;
  findPendingInviteByTripAndEmail(tripId: number, email: string): Promise<TripInvite | null>;
  createInvite(tripId: number, email: string, token: string, invitedBy: number): Promise<TripInvite>;
  findInviteByToken(token: string): Promise<TripInvite | null>;
  updateInviteStatus(id: number, status: InviteStatus): Promise<TripInvite>;
  getPendingInvites(tripId: number): Promise<TripInvite[]>;
}
```

Wait, but the plan also mentions `findUserByEmail` in the acceptInvite flow. Let me re-read:

"3. Service: look up the user row by email (via repository `findUserByEmail` — added to interface). If no matching user → `invite_not_found`."

So the repository also has a `findUserByEmail` method. But it's not in the interface listed in section 3... The plan says "added to interface" so it should be there. Let me add it.

Actually, looking more carefully at the plan's section 3 for the repository interface, it lists:
```ts
export interface TripsRepository {
  create(data: { name: string; destination: string; startDate: Date; endDate: Date }): Promise<Trip>;
  findById(id: number): Promise<Trip | null>;
  addMember(tripId: number, userId: number, role: MemberRole): Promise<TripMember>;
  isMember(tripId: number, userId: number): Promise<boolean>;
  getMembers(tripId: number): Promise<TripMember[]>;
  findPendingInviteByTripAndEmail(tripId: number, email: string): Promise<TripInvite | null>;
  createInvite(tripId: number, email: string, token: string, invitedBy: number): Promise<TripInvite>;
  findInviteByToken(token: string): Promise<TripInvite | null>;
  updateInviteStatus(id: number, status: InviteStatus): Promise<TripInvite>;
  getPendingInvites(tripId: number): Promise<TripInvite[]>;
}
```

But then in section 4 (Control flow), it says:
"3. Service: look up the user row by email (via repository `findUserByEmail` — added to interface). If no matching user → `invite_not_found`."

So I need to assume the repository interface also has `findUserByEmail(email: string): Promise<{ id: number; email: string } | null>` or similar.

Now, for the spec file, I need to fake the repository at the interface level. The convention says "repository faked at interface" - meaning I create a mock object that implements `TripsRepository`.

Let me also think about what `AppError` looks like. From the plan:
- The existing `AppError` class accepts `(code: string, message: string, details?: Record<string, unknown>)`

And the error codes used are:
- `invalid_date_range`
- `trip_not_found`
- `not_the_owner`
- `invite_not_found`
- `not_a_member`

Now let me think about the `vi` namespace errors. The file was using `vi.fn()` etc. without importing `vi`. I need to import from 'vitest'.

For the module resolution issue, since the project uses `node16`/`nodenext` (evidenced by the error in trips.service.ts), all relative imports need `.js` extensions.

Let me also check: the `beforeEach` error means I need to import it from 'vitest'.

Now let me write the complete spec file:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember, MemberRole } from './entities/trip-member.entity.js';
import type { TripInvite, InviteStatus } from './entities/trip-invite.entity.js';
import { AppError } from '../../common/app-error.js';
```

Wait, but the error messages only name errors for `trips.service.spec.ts`. Let me look at what imports the spec file needs:

From the errors:
- Line 2: `./trips.service` - needs `.js`
- Line 3: `./trips.repository` - needs `.js`
- Line 4: `./dto/create-trip.dto` - needs `.js`
- Line Line 5: `./dto/invite-trip.dto` - needs `.js`
- Line 6: `./entities/trip.entity` - needs `.js`
- Line 7: `./entities/trip-member.entity` - needs `.js`
- Line 8: `./entities/trip-invite.entity` - needs `.js`
- Line 10: `vi` namespace not found - need to import `vi` from 'vitest'
- Line 69: `beforeEach` not found - need to import from 'vitest'

So the original file had imports on lines 2-8 (7 import lines) and was using `vi` on line 10 without importing it, and `beforeEach` on line 69.

Let me think about what the file structure was:
- Lines 1-8: imports (line 1 might be a blank line or the first import)
- Actually, looking at the error lines: 2,3,4,5,6,7,8 are the import lines. So line 1 is probably blank or has something else.

Wait, actually in the error output, the line numbers are:
- Line 2: `./trips.service`
- Line 3: `./trips.repository`
- Line 4: `./dto/create-trip.dto`
- Line 5: `./dto/invite-trip.dto`
- Line 6: `./entities/trip.entity`
- Line 7: `./entities/trip-member.entity`
- Line 8: `./entities/trip-invite.entity`

So line 1 might be empty or have a comment. The imports start at line 2.

Now, I also need to think about whether `AppError` is imported. The plan says errors use `AppError`. In the tests, I'll need to check that `AppError` is thrown with specific codes. Let me import it.

But wait - the error messages don't mention any import of `AppError` in the spec file. So either:
1. The original file didn't import `AppError` (and used a different approach to check errors), or
2. It was imported on line 1 (which isn't flagged).

Actually, looking at the errors more carefully, they only flag lines 2-8 for module not found. If there were an import of `AppError` that was also wrong, it would be flagged too. So either:
- Line 1 has the `AppError` import (correctly) - unlikely since it would need `.js` too
- The original file didn't import `AppError`

Hmm, but I need to check errors. Let me think... The tests need to verify that specific error codes are raised. I can do this by catching the error and checking its properties, or by using `expect(...).rejects.toMatchObject(...)`.

Actually, I'll just import `AppError` and use it in the tests. If the import path is wrong, it would have been flagged. Since I'm rewriting the file, I'll make sure all imports are correct.

Wait, the instruction says "Change nothing the messages do not name." So I should only fix what the messages require. But the messages ARE requiring me to fix the imports (they're all wrong). And I need to add `vi` and `beforeEach` imports. Let me just make the file correct.

Let me also think about what `findUserByEmail` returns. The plan says in the acceptInvite flow:
"3. Service: look up the user row by email (via repository `findUserByEmail` — added to interface). If no matching user → `invite_not_found`."

So the repository needs a `findUserByEmail` method. But it's not in the interface shown in section 3. This is a bit of a contradiction in the plan. I'll assume it exists on the repository interface since the plan explicitly says "added to interface".

For the fake repository, I need to include `findUserByEmail`. Let me define it as returning `{ id: number; email: string } | null`.

Now let me think about the `vi` usage. The original file used `vi.fn()` (based on the namespace error). I need to import `vi` from 'vitest'.

Let me write the complete file:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember, MemberRole } from './entities/trip-member.entity.js';
import type { TripInvite, InviteStatus } from './entities/trip-invite.entity.js';
import { AppError } from '../../common/app-error.js';

// ... rest of the file
```

Wait, I need to be careful. The plan says the service raises `AppError` instances. In the tests, I should verify the error code. Let me use `rejects.toThrow()` or catch and check properties.

Actually, let me reconsider. The convention says "errors use the existing `AppError` codes." So the service throws `AppError` instances. In tests, I can do:

```ts
await expect(service.createTrip(badDto, 1)).rejects.toMatchObject({ code: 'invalid_date_range' });
```

Or:
```ts
await expect(service.createTrip(badDto, 1)).rejects.toBeInstanceOf(AppError);
```

I think checking the code is more behavioral. Let me use `rejects.toMatchObject({ code: '...' })`.

But wait, I need to know the shape of `AppError`. The plan says:
"The existing `AppError` class accepts `(code: string, message: string, details?: Record<string, unknown>)`"

So it has at least `code`, `message`, and maybe `details` properties. I'll use `toMatchObject({ code: '...' })`.

Actually, I don't even need to import `AppError` for the tests if I just check the code property. But it might be cleaner to verify it's an instance. Let me just check the code property to keep it simple and avoid potential import issues.

Hmm, but the instruction says "Change nothing the messages do not name." The messages don't mention an AppError import. So maybe the original file didn't have one. Let me not import it and just check the `code` property on the rejected value.

Now, for the fake repository, I need to create an object that implements all the methods of `TripsRepository`. Let me list them:

From the plan's section 3:
- `create(data)`
- `findById(id)`
- `addMember(tripId, userId, role)`
- `isMember(tripId, userId)`
- `getMembers(tripId)`
- `findPendingInviteByTripAndEmail(tripId, email)`
- `createInvite(tripId, email, token, invitedBy)`
- `findInviteByToken(token)`
- `updateInviteStatus(id, status)`
- `getPendingInvites(tripId)`

And from section 4 (control flow for acceptInvite):
- `findUserByEmail(email)` - "added to interface"

Let me now write the full spec. I'll use `vi.fn()` for each method of the fake repository.

Actually, let me reconsider the approach. The convention says "repository faked at interface" - this means I create a plain object that implements the interface, using `vi.fn()` for each method. This is the standard approach.

Let me write it out:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember, MemberRole } from './entities/trip-member.entity.js';
import type { TripInvite, InviteStatus } from './entities/trip-invite.entity.js';

function makeFakeRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    addMember: vi.fn(),
    isMember: vi.fn(),
    getMembers: vi.fn(),
    findPendingInviteByTripAndEmail: vi.fn(),
    createInvite: vi.fn(),
    findInviteByToken: vi.fn(),
    updateInviteStatus: vi.fn(),
    getPendingInvites: vi.fn(),
    findUserByEmail: vi.fn(),
  };
}

describe('TripsService', () => {
  let service: TripsService;
  let repo: ReturnType<typeof makeFakeRepo>;

  beforeEach(() => {
    repo = makeFakeRepo();
    service = new TripsService(repo as unknown as TripsRepository);
  });

  // ... tests
});
```

Wait, I need to think about the constructor. The plan says:
```ts
@Injectable()
export class TripsService {
  constructor(repo: TripsRepository) {}
  ...
}
```

So it takes `TripsRepository` as a constructor parameter. In the test, I'll cast the fake to `TripsRepository`.

Now let me think about each test:

**Test 1: createTrip returns the trip and inserts an owner membership**
```ts
it('createTrip returns the trip and inserts an owner membership for the creator', async () => {
  const dto: CreateTripDto = { name: 'Trip', destination: 'Paris', startDate: '2025-01-01', endDate: '2025-01-10' };
  const trip: Trip = { id: 1, name: 'Trip', destination: 'Paris', startDate: new Date('2025-01-01'), endDate: new Date('2025-01-10'), createdAt: new Date(), updatedAt: new Date() };
  const membership: TripMember = { id: 1, tripId: 1, userId: 42, role: 'owner', createdAt: new Date(), updatedAt: new Date() };

  repo.create.mockResolvedValue(trip);
  repo.addMember.mockResolvedValue(membership);

  const result = await service.createTrip(dto, 42);

  expect(result).toEqual(trip);
  expect(repo.create).toHaveBeenCalledWith({ name: 'Trip', destination: 'Paris', startDate: new Date('2025-01-01'), endDate: new Date('2025-01-10') });
  expect(repo.addMember).toHaveBeenCalledWith(1, 42, 'owner');
});
```

**Test 2: createTrip raises invalid_date_range when startDate equals endDate**
```ts
it('createTrip raises invalid_date_range when startDate equals endDate', async () => {
  const dto: CreateTripDto = { name: 'Trip', destination: 'Paris', startDate: '2025-01-10', endDate: '2025-01-10' };

  await expect(service.createTrip(dto, 42)).rejects.toMatchObject({ code: 'invalid_date_range' });
});
```

**Test 3: inviteToTrip on non-existent trip raises trip_not_found**
```ts
it('inviteToTrip on a non-existent trip raises trip_not_found', async () => {
  const dto: InviteTripDto = { email: 'a@b.com' };
  repo.findById.mockResolvedValue(null);

  await expect(service.inviteToTrip(99, dto, 1)).rejects.toMatchObject({ code: 'trip_not_found' });
});
```

**Test 4: inviteToTrip by non-owner raises not_the_owner**
```ts
it('inviteToTrip by a non-owner raises not_the_owner', async () => {
  const dto: InviteTripDto = { email: 'a@b.com' };
  const trip: Trip = { id: 1, name: 'Trip', destination: 'Paris', startDate: new Date(), endDate: new Date(), createdAt: new Date(), updatedAt: new Date() };
  repo.findById.mockResolvedValue(trip);
  // The caller (userId=2) is a member but not the owner
  repo.getMembers.mockResolvedValue([{ id: 1, tripId: 1, userId: 1, role: 'owner', createdAt: new Date(), updatedAt: new Date() }]);

  await expect(service.inviteToTrip(1, dto, 2)).rejects.toMatchObject({ code: 'not_the_owner' });
});
```

Wait, I need to think about how the service checks ownership. Looking at the plan:
"3. Service: fetch members, verify `ownerId` has role `owner`; if not → `not_the_owner`."

So it fetches members and checks if the caller has role 'owner'. I could use `getMembers` or I could have a specific method. The plan says "fetch members" so it's using `getMembers`.

Actually, wait. Let me re-read the repository interface:
- `isMember(tripId, userId): Promise<boolean>` - checks if user is a member
- `getMembers(tripId): Promise<TripMember[]>` - gets all members

For checking ownership, the service would need to use `getMembers` and find if the caller has role 'owner'. Or maybe there's a simpler way... Let me just use `getMembers` as the plan suggests.

**Test 5: inviteToTrip by owner creates pending invite with token**
```ts
it('inviteToTrip by the owner creates a pending invite with a token', async () => {
  const dto: InviteTripDto = { email: 'a@b.com' };
  const trip: Trip = { ... };
  repo.findById.mockResolvedValue(trip);
  repo.getMembers.mockResolvedValue([{ id: 1, tripId: 1, userId: 1, role: 'owner', createdAt: new Date(), updatedAt: new Date() }]);
  repo.findPendingInviteByTripAndEmail.mockResolvedValue(null);
  const invite: TripInvite = { id: 1, tripId: 1, email: 'a@b.com', token: 'abc123', status: 'pending', invitedBy: 1, createdAt: new Date(), updatedAt: new Date() };
  repo.createInvite.mockResolvedValue(invite);

  const result = await service.inviteToTrip(1, dto, 1);

  expect(result).toEqual(invite);
  expect(repo.createInvite).toHaveBeenCalledOnce();
});
```

**Test 6: inviteToTrip same email twice returns existing pending invite**
```ts
it('inviteToTrip with the same email twice returns the existing pending invite (no second row)', async () => {
  const dto: InviteTripDto = { email: 'a@b.com' };
  const trip: Trip = { ... };
  repo.findById.mockResolvedValue(trip);
  repo.getMembers.mockResolvedValue([{ id: 1, tripId: 1, userId: 1, role: 'owner', createdAt: new Date(), updatedAt: new Date() }]);
  const existingInvite: TripInvite = { id: 1, tripId: 1, email: 'a@b.com', token: 'existing-token', status: 'pending', invitedBy: 1, createdAt: new Date(), updatedAt: new Date() };
  repo.findPendingInviteByTripAndEmail.mockResolvedValue(existingInvite);

  const result = await service.inviteToTrip(1, dto, 1);

  expect(result).toEqual(existingInvite);
  expect(repo.createInvite).not.toHaveBeenCalled();
});
```

**Test 7: acceptInvite with unknown token raises invite_not_found**
```ts
it('acceptInvite with an unknown token raises invite_not_found', async () => {
  repo.findInviteByToken.mockResolvedValue(null);

  await expect(service.acceptInvite('unknown-token', 42)).rejects.toMatchObject({ code: 'invite_not_found' });
});
```

**Test 8: acceptInvite for valid pending invite marks accepted and inserts member**
This is more complex. The flow:
1. Find invite by token → found, status 'pending'
2. Look up user by email → found
3. Status is pending → update invite status to 'accepted', insert membership

```ts
it('acceptInvite for a valid pending invite marks it accepted and inserts a member row', async () => {
  const invite: TripInvite = { id: 1, tripId: 1, email: 'a@b.com', token: 'tok', status: 'pending', invitedBy: 1, createdAt: new Date(), updatedAt: new Date() };
  repo.findInviteByToken.mockResolvedValue(invite);
  repo.findUserByEmail.mockResolvedValue({ id: 42, email: 'a@b.com' });
  repo.updateInviteStatus.mockResolvedValue({ ...invite, status: 'accepted' });
  const membership: TripMember = { id: 1, tripId: 1, userId: 42, role: 'member', createdAt: new Date(), updatedAt: new Date() };
  repo.addMember.mockResolvedValue(membership);

  const result = await service.acceptInvite('tok', 42);

  expect(result).toEqual(membership);
  expect(repo.updateInviteStatus).toHaveBeenCalledWith(1, 'accepted');
});
```

**Test 9: acceptInvite for already-accepted invite is no-op returning existing membership**
Flow:
1. Find invite by token → found, status 'accepted'
2. Look up user by email → found
3. Status is already 'accepted' → fetch membership for (tripId, userId) → return it

```ts
it('acceptInvite for an already-accepted invite is a no-op returning the existing membership', async () => {
  const invite: TripInvite = { id: 1, tripId: 1, email: 'a@b.com', token: 'tok', status: 'accepted', invitedBy: 1, createdAt: new Date(), updatedAt: new Date() };
  repo.findInviteByToken.mockResolvedValue(invite);
  repo.findUserByEmail.mockResolvedValue({ id: 42, email: 'a@b.com' });
  const membership: TripMember = { id: 1, tripId: 1, userId: 42, role: 'member', createdAt: new Date(), updatedAt: new Date() };
  repo.getMembers.mockResolvedValue([membership]);

  const result = await service.acceptInvite('tok', 42);

  expect(result).toEqual(membership);
  expect(repo.updateInviteStatus).not.toHaveBeenCalled();
});
```

Wait, how does the service find the existing membership? It could use `getMembers` and filter, or there might be a specific method. Looking at the repository interface, there's no `findMembership(tripId, userId)` method. So it probably uses `getMembers` and finds the one matching the userId. Or maybe `isMember` + something else.

Actually, looking at the plan's control flow:
"4. Service: if invite status is already `accepted` → fetch membership for `(tripId, userId)`; if it exists return it (no-op); if not (shouldn't happen) raise `invite_not_found`."

So it "fetches membership for (tripId, userId)". The only way to do that with the given interface is `getMembers(tripId)` and then find the one with matching `userId`. Let me go with that.

**Test 10: acceptInvite by user whose email doesn't match raises invite_not_found**
Flow:
1. Find invite by token → found, status 'pending', email is 'other@b.com'
2. Look up user by email (the invitee's email) → found user with id 99
3. But the current user (userId=42) doesn't match the found user (id=99)

Wait, let me re-read the plan:
"3. Service: look up the user row by email (via repository `findUserByEmail` — added to interface). If no matching user → `invite_not_found`."

Hmm, this is a bit confusing. Let me think about what "look up the user row by email" means in context. The invite has an email. The service looks up the user with that email. If no such user exists, it raises `invite_not_found`. But what if the user exists but is not the current user?

Looking at test 10: "acceptInvite by a user whose email does not match the invite raises `invite_not_found`."

So the scenario is:
- Invite has email 'a@b.com'
- Current user has userId=42, and their email is 'different@b.com' (or the service checks that the current user's identity matches)

Wait, I think the flow is:
1. Find invite by token → found
2. The invite has an email. Look up user with that email → get user record (e.g., id=42, email='a@b.com')
3. Check if the current user (userId passed in) matches the found user's id
4. If not → `invite_not_found`

OR maybe:
1. Find invite by token → found, email is 'a@b.com'
2. Look up user with email 'a@b.com' → found user id=99
3. Current user is id=42, which doesn't match 99 → `invite_not_found`

OR maybe the service looks up the current user's email and compares it to the invite's email? But there's no `findUserById` in the interface...

Actually, I think the simplest interpretation that matches test 10 is:
- The service looks up the user by the invite's email
- If the found user's id doesn't match the current userId, it raises `invite_not_found`
- If no user is found with that email, it also raises `invite_not_found`

Let me go with that interpretation.

```ts
it('acceptInvite by a user whose email does not match the invite raises invite_not_found', async () => {
  const invite: TripInvite = { id: 1, tripId: 1, email: 'a@b.com', token: 'tok', status: 'pending', invitedBy: 1, createdAt: new Date(), updatedAt: new Date() };
  repo.findInviteByToken.mockResolvedValue(invite);
  // The user with email 'a@b.com' has id 99, but current user is 42
  repo.findUserByEmail.mockResolvedValue({ id: 99, email: 'a@b.com' });

  await expect(service.acceptInvite('tok', 42)).rejects.toMatchObject({ code: 'invite_not_found' });
});
```

**Test 11: getTrip for non-member raises not_a_member**
```ts
it('getTrip for a non-member raises not_a_member', async () => {
  const trip: Trip = { ... };
  repo.findById.mockResolvedValue(trip);
  repo.isMember.mockResolvedValue(false);

  await expect(service.getTrip(1, 42)).rejects.toMatchObject({ code: 'not_a_member' });
});
```

**Test 12: getTrip for member returns trip fields, members, pending invites**
```ts
it('getTrip for a member returns trip fields, members array, and only pending invites', async () => {
  const trip: Trip = { id: 1, name: 'Trip', destination: 'Paris', startDate: new Date('2025-01-01'), endDate: new Date('2025-01-10'), createdAt: new Date(), updatedAt: new Date() };
  repo.findById.mockResolvedValue(trip);
  repo.isMember.mockResolvedValue(true);
  const members: TripMember[] = [
    { id: 1, tripId: 1, userId: 1, role: 'owner', createdAt: new Date(), updatedAt: new Date() },
    { id: 2, tripId: 1, userId: 42, role: 'member', createdAt: new Date(), updatedAt: new Date() },
  ];
  repo.getMembers.mockResolvedValue(members);
  const pendingInvites: TripInvite[] = [
    { id: 1, tripId: 1, email: 'a@b.com', token: 'tok1', status: 'pending', invitedBy: 1, createdAt: new Date(), updatedAt: new Date() },
  ];
  repo.getPendingInvites.mockResolvedValue(pendingInvites);

  const result = await service.getTrip(1, 42);

  expect(result.id).toBe(1);
  expect(result.name).toBe('Trip');
  expect(result.destination).toBe('Paris');
  expect(result.members).toHaveLength(2);
  expect(result.pendingInvites).toHaveLength(1);
  expect(result.pendingInvites[0].email).toBe('a@b.com');
});
```

**Test 13: getTrip for non-existent trip raises trip_not_found**
```ts
it('getTrip for a non-existent trip raises trip_not_found', async () => {
  repo.findById.mockResolvedValue(null);

  await expect(service.getTrip(99, 42)).rejects.toMatchObject({ code: 'trip_not_found' });
});
```

Now, let me also think about the `GetTripResponseDto` shape. From the plan:
```ts
export class GetTripResponseDto {
  id: number;
  name: string;
  destination: string;
  startDate: string;   // ISO
  endDate: string;     // ISO
  members: MemberView[];
  pendingInvites: PendingInviteView[];
}

export interface MemberView {
  userId: number;
  role: MemberRole;
}

export interface PendingInviteView {
  email: string;
  token: string;
}
```

So the service converts `Trip` to the DTO, converting dates to ISO strings, and mapping members to `MemberView[]` and pending invites to `PendingInviteView[]`.

For test 12, I should verify the date format is ISO:
```ts
expect(result.startDate).toBe(new Date('2025-01-01').toISOString());
```

And members should be mapped:
```ts
expect(result.members).toEqual([
  { userId: 1, role: 'owner' },
  { userId: 42, role: 'member' },
]);
```

And pending invites should only include email and token:
```ts
expect(result.pendingInvites).toEqual([
  { email: 'a@b.com', token: 'tok1' },
]);
```

Now let me also think about the `vi` namespace error. The errors are on lines 10, 23, and 66. This suggests `vi.fn()` was used in those places. In my rewrite, I'll use `vi.fn()` in the `makeFakeRepo` function and in `beforeEach`.

Wait, actually looking at the error pattern:
- Line 10: `vi` namespace - probably first `vi.fn()` call
- Line 23: `vi` namespace - another `vi.fn()` call
- Line 66: `vi` namespace - another `vi.fn()` call
- Line 69: `beforeEach` not found

This suggests the original file had a structure where `vi.fn()` was called in a few places (maybe inline in the fake repo creation) and `beforeEach` was used.

In my rewrite, I'll use a `makeFakeRepo()` function that creates the fake with all `vi.fn()` calls, and use `beforeEach` to reset.

Let me also think about whether I need `vi` imported separately or if it comes with the vitest import. In Vitest, `vi` is a separate export from 'vitest':
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

Yes, that's correct.

Now let me also consider: the `findUserByEmail` method. The plan says it's "added to interface" but it's not in the explicit interface listing in section 3. I'll include it in my fake and assume it exists on the repository interface. I should add an `// ASSUMPTION:` comment about this.

Actually, wait. Let me re-read the instruction: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The `findUserByEmail` shape is something I'm inferring from the plan's control flow description. The plan says "via repository `findUserByEmail` — added to interface" but doesn't show its exact signature. I'll assume it returns `{ id: number; email: string } | null`.

Let me finalize the file. I need to be careful about:
1. All relative imports have `.js` extension
2. `vi` and `beforeEach` are imported from 'vitest'
3. All 13 tests from the plan are present
4. The fake repository implements all needed methods

Let me also double-check: do I need to import `AppError`? The tests check for error codes using `toMatchObject({ code: '...' })`. This doesn't require importing `AppError` - I'm just checking a property on the rejected value. So no, I don't need to import it.

Actually wait - will `rejects.toMatchObject` work on an Error instance? Let me think... `AppError` extends `Error` (presumably). `toMatchObject` checks that the object has the specified properties. An Error instance with a `code` property should match `{ code: '...' }`. Yes, this should work.

Let me write the final version now.

One more thought: for test 8, the plan says the service opens a "single transaction" for updating invite status and inserting membership. But since we're testing at the service level with a faked repository, the transaction is an implementation detail of the repository. The service just calls the repository methods. So in the test, I just verify that `updateInviteStatus` and `addMember` are called.

Actually, wait. If the transaction is in the repository (as a Drizzle transaction), then the service might call a single repository method that does both. But looking at the repository interface, there's no `acceptInvite` method on the repository - the service orchestrates multiple repository calls. So the "transaction" must be either:
1. Handled at the service level (service calls a transaction-wrapping method)
2. Or the repository methods are called individually and the "transaction" is conceptual

Given the layer convention (service calls repositories), and the repository interface doesn't have a transaction method, I think the service just calls `updateInviteStatus` and `addMember` sequentially. The "transaction" in the plan might be aspirational or handled differently. For the test, I'll just verify both calls are made.

Actually, re-reading the plan: "Transaction boundaries: Each write operation that touches more than one table (createTrip, acceptInvite) wraps its writes in a single Drizzle transaction."

This suggests the repository should have transaction support. But the interface doesn't show it. Maybe the `create` method in the repository already handles the transaction internally (creating both the trip and the membership in one go)? Or maybe there's a `transaction` method on the repository that isn't shown.

For testing purposes, I'll just verify the observable behavior: the correct methods are called with the correct arguments. The internal transaction handling is a repository implementation detail.

Let me finalize. Here's my plan for the file:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember, MemberRole } from './entities/trip-member.entity.js';
import type { TripInvite, InviteStatus } from './entities/trip-invite.entity.js';

// ... makeFakeRepo helper
// ... describe block with all 13 tests
```

Wait, I realize I should double-check: does the `TripsService` constructor take the repository directly, or does it use NestJS dependency injection? Looking at the plan:

```ts
@Injectable()
export class TripsService {
  constructor(repo: TripsRepository) {}
  ...
}
```

With NestJS DI, the constructor parameter would typically have `@Inject()` or use the class token. But since `TripsRepository` is both an interface and a class (the implementation), NestJS would use the class as the token. In the test, I can just pass the fake directly to the constructor:

```ts
service = new TripsService(repo as unknown as TripsRepository);
```

This should work fine.

Now, one issue: `MemberRole` is imported but might not be directly used in the test file (it's used as a type in the mock data). Same with `InviteStatus`. Let me check if I actually use them... In the test data, I use string literals like `'owner'`, `'member'`, `'pending'`, `'accepted'`. TypeScript should infer these correctly without needing the type import. But to be safe and explicit, I'll keep the imports.

Actually, `MemberRole` is used in the type annotation for the mock data potentially. And `InviteStatus` similarly. Let me keep them for clarity.

Hmm, but if they're not directly referenced in a type annotation, TypeScript might flag them as unused imports. Let me think... In the test data objects, I'm creating objects that match `TripMember` and `TripInvite` interfaces. The `role` field is of type `MemberRole` and `status` is of type `InviteStatus`. When I write `role: 'owner'`, TypeScript infers this as `string` unless I explicitly annotate. But since I'm assigning to a variable typed as `TripMember`, it should be fine.

Actually, I don't need to explicitly type the mock data variables if I'm just passing them to `mockResolvedValue`. The mock is typed as `vi.fn()` which returns `any` by default. So I don't strictly need the type imports for the mock data.

But wait, I do import `Trip`, `TripMember`, and `TripInvite` for the type annotations on my local variables. Let me keep those.

Actually, let me simplify. I'll type the key variables:

```ts
const trip: Trip = { ... };
const membership: TripMember = { ... };
const invite: TripInvite = { ... };
```

This requires importing `Trip`, `TripMember`, and `TripInvite`. I don't strictly need `MemberRole` or `InviteStatus` as separate imports since they're part of those interfaces.

Let me also remove `CreateTripDto` and `InviteTripDto` type imports if I'm just creating plain objects. Actually, I do need them to type the DTO variables:

```ts
const dto: CreateTripDto = { name: 'Trip', destination: 'Paris', startDate: '2025-01-01', endDate: '2025-01-10' };
```

OK let me just write the final file. I'll be comprehensive but clean.

One more consideration: the `findUserByEmail` return type. I'll assume it returns `{ id: number; email: string } | null`. I'll add an ASSUMPTION comment for this.

Let me write it all out now.
```

## reply

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
import type { TripInvite } from './entities/trip-invite.entity.js';

// ASSUMPTION: The repository interface includes a `findUserByEmail(email: string): Promise<{ id: number; email: string } | null>` method, as referenced in the plan's acceptInvite control flow but not explicitly listed in the section-3 interface.

function makeFakeRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    addMember: vi.fn(),
    isMember: vi.fn(),
    getMembers: vi.fn(),
    findPendingInviteByTripAndEmail: vi.fn(),
    createInvite: vi.fn(),
    findInviteByToken: vi.fn(),
    updateInviteStatus: vi.fn(),
    getPendingInvites: vi.fn(),
    findUserByEmail: vi.fn(),
  };
}

function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 1,
    name: 'Trip',
    destination: 'Paris',
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-01-10'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMember(overrides?: Partial<TripMember>): TripMember {
  return {
    id: 1,
    tripId: 1,
    userId: 1,
    role: 'owner',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeInvite(overrides?: Partial<TripInvite>): TripInvite {
  return {
    id: 1,
    tripId: 1,
    email: 'a@b.com',
    token: 'tok123',
    status: 'pending',
    invitedBy: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('TripsService', () => {
  let service: TripsService;
  let repo: ReturnType<typeof makeFakeRepo>;

  beforeEach(() => {
    repo = makeFakeRepo();
    service = new TripsService(repo as unknown as TripsRepository);
  });

  // --- createTrip ---

  it('createTrip returns the trip and inserts an owner membership for the creator', async () => {
    const dto: CreateTripDto = { name: 'Trip', destination: 'Paris', startDate: '2025-01-01', endDate: '2025-01-10' };
    const trip = makeTrip();
    const membership = makeMember({ userId: 42, role: 'owner' });

    repo.create.mockResolvedValue(trip);
    repo.addMember.mockResolvedValue(membership);

    const result = await service.createTrip(dto, 42);

    expect(result).toEqual(trip);
    expect(repo.create).toHaveBeenCalledWith({
      name: 'Trip',
      destination: 'Paris',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-01-10'),
    });
    expect(repo.addMember).toHaveBeenCalledWith(1, 42, 'owner');
  });

  it('createTrip raises invalid_date_range when startDate equals endDate', async () => {
    const dto: CreateTripDto = { name: 'Trip', destination: 'Paris', startDate: '2025-01-10', endDate: '2025-01-10' };

    await expect(service.createTrip(dto, 42)).rejects.toMatchObject({ code: 'invalid_date_range' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  // --- inviteToTrip ---

  it('inviteToTrip on a non-existent trip raises trip_not_found', async () => {
    const dto: InviteTripDto = { email: 'a@b.com' };
    repo.findById.mockResolvedValue(null);

    await expect(service.inviteToTrip(99, dto, 1)).rejects.toMatchObject({ code: 'trip_not_found' });
    expect(repo.createInvite).not.toHaveBeenCalled();
  });

  it('inviteToTrip by a non-owner raises not_the_owner', async () => {
    const dto: InviteTripDto = { email: 'a@b.com' };
    repo.findById.mockResolvedValue(makeTrip());
    repo.getMembers.mockResolvedValue([makeMember({ userId: 1, role: 'owner' })]);

    await expect(service.inviteToTrip(1, dto, 2)).rejects.toMatchObject({ code: 'not_the_owner' });
    expect(repo.createInvite).not.toHaveBeenCalled();
  });

  it('inviteToTrip by the owner creates a pending invite with a token', async () => {
    const dto: InviteTripDto = { email: 'a@b.com' };
    repo.findById.mockResolvedValue(makeTrip());
    repo.getMembers.mockResolvedValue([makeMember({ userId: 1, role: 'owner' })]);
    repo.findPendingInviteByTripAndEmail.mockResolvedValue(null);
    const invite = makeInvite({ token: 'generated-token' });
    repo.createInvite.mockResolvedValue(invite);

    const result = await service.inviteToTrip(1, dto, 1);

    expect(result).toEqual(invite);
    expect(repo.createInvite).toHaveBeenCalledOnce();
    const [tripId, email, token, invitedBy] = repo.createInvite.mock.calls[0];
    expect(tripId).toBe(1);
    expect(email).toBe('a@b.com');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(invitedBy).toBe(1);
  });

  it('inviteToTrip with the same email twice returns the existing pending invite (no second row)', async () => {
    const dto: InviteTripDto = { email: 'a@b.com' };
    repo.findById.mockResolvedValue(makeTrip());
    repo.getMembers.mockResolvedValue([makeMember({ userId: 1, role: 'owner' })]);
    const existing = makeInvite({ token: 'existing-token' });
    repo.findPendingInviteByTripAndEmail.mockResolvedValue(existing);

    const result = await service.inviteToTrip(1, dto, 1);

    expect(result).toEqual(existing);
    expect(repo.createInvite).not.toHaveBeenCalled();
  });

  // --- acceptInvite ---

  it('acceptInvite with an unknown token raises invite_not_found', async () => {
    repo.findInviteByToken.mockResolvedValue(null);

    await expect(service.acceptInvite('unknown-token', 42)).rejects.toMatchObject({ code: 'invite_not_found' });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it('acceptInvite for a valid pending invite marks it accepted and inserts a member row', async () => {
    const invite = makeInvite({ status: 'pending' });
    repo.findInviteByToken.mockResolvedValue(invite);
    repo.findUserByEmail.mockResolvedValue({ id: 42, email: 'a@b.com' });
    const updatedInvite = makeInvite({ status: 'accepted' });
    repo.updateInviteStatus.mockResolvedValue(updatedInvite);
    const membership = makeMember({ userId: 42, role: 'member' });
    repo.addMember.mockResolvedValue(membership);

    const result = await service.acceptInvite('tok123', 42);

    expect(result).toEqual(membership);
    expect(repo.updateInviteStatus).toHaveBeenCalledWith(1, 'accepted');
    expect(repo.addMember).toHaveBeenCalledWith(1, 42, 'member');
  });

  it('acceptInvite for an already-accepted invite is a no-op returning the existing membership', async () => {
    const invite = makeInvite({ status: 'accepted' });
    repo.findInviteByToken.mockResolvedValue(invite);
    repo.findUserByEmail.mockResolvedValue({ id: 42, email: 'a@b.com' });
    const membership = makeMember({ userId: 42, role: 'member' });
    repo.getMembers.mockResolvedValue([membership]);

    const result = await service.acceptInvite('tok123', 42);

    expect(result).toEqual(membership);
    expect(repo.updateInviteStatus).not.toHaveBeenCalled();
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it('acceptInvite by a user whose email does not match the invite raises invite_not_found', async () => {
    const invite = makeInvite({ email: 'a@b.com', status: 'pending' });
    repo.findInviteByToken.mockResolvedValue(invite);
    // The user with email 'a@b.com' has id 99, but the current user is 42
    repo.findUserByEmail.mockResolvedValue({ id: 99, email: 'a@b.com' });

    await expect(service.acceptInvite('tok123', 42)).rejects.toMatchObject({ code: 'invite_not_found' });
    expect(repo.updateInviteStatus).not.toHaveBeenCalled();
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  // --- getTrip ---

  it('getTrip for a non-member raises not_a_member', async () => {
    repo.findById.mockResolvedValue(makeTrip());
    repo.isMember.mockResolvedValue(false);

    await expect(service.getTrip(1, 42)).rejects.toMatchObject({ code: 'not_a_member' });
  });

  it('getTrip for a member returns trip fields, members array, and only pending invites', async () => {
    const trip = makeTrip();
    repo.findById.mockResolvedValue(trip);
    repo.isMember.mockResolvedValue(true);
    const members = [
      makeMember({ id: 1, userId: 1, role: 'owner' }),
      makeMember({ id: 2, userId: 42, role: 'member' }),
    ];
    repo.getMembers.mockResolvedValue(members);
    const pendingInvites = [makeInvite({ id: 1, email: 'a@b.com', token: 'tok-pending' })];
    repo.getPendingInvites.mockResolvedValue(pendingInvites);

    const result = await service.getTrip(1, 42);

    expect(result.id).toBe(1);
    expect(result.name).toBe('Trip');
    expect(result.destination).toBe('Paris');
    expect(result.startDate).toBe(new Date('2025-01-01').toISOString());
    expect(result.endDate).toBe(new Date('2025-01-10').toISOString());
    expect(result.members).toEqual([
      { userId: 1, role: 'owner' },
      { userId: 42, role: 'member' },
    ]);
    expect(result.pendingInvites).toEqual([
      { email: 'a@b.com', token: 'tok-pending' },
    ]);
  });

  it('getTrip for a non-existent trip raises trip_not_found', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(service.getTrip(99, 42)).rejects.toMatchObject({ code: 'trip_not_found' });
    expect(repo.isMember).not.toHaveBeenCalled();
  });
});
```
