# 12-trips.service.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. A unit test file `src/modules/trips/trips.service.spec.ts` for `TripsService`
2. The repository is faked at the interface level (hand-written object implementing `TripsRepository`)
3. I need to implement all 17 test cases listed in the cases file

Let me look at the test cases from `12-trips.service.spec.ts-cases.txt`:

1. `createTrip returns the trip and passes creatorId to the repository`
2. `createTrip rejects when startDate is after endDate`
3. `createTrip rejects when startDate equals endDate (boundary)`
4. `inviteToTrip on a non-existent trip throws trip_not_found`
5. `inviteToTrip by a non-owner throws not_the_owner`
6. `inviteToTrip by the owner with a new email creates a pending invite with a non-empty token`
7. `inviteToTrip with an already-pending email returns the existing invite without creating a second row`
8. `inviteToTrip after an invite was declined creates a fresh pending invite`
9. `acceptInvite with an unknown token throws invite_not_found`
10. `acceptInvite when the inviting email has no registered user throws invite_not_found`
11. `acceptInvite by a user whose id differs from the invitee's user throws invite_not_found`
12. `acceptInvite on a valid pending invite marks it accepted and returns the new member row with role 'member'`
13. `acceptInvite on an already-accepted invite is a no-op returning the existing membership`
14. `acceptInvite on a declined invite throws invite_not_found (does not create membership)`
15. `getTrip on a non-existent trip throws trip_not_found`
16. `getTrip by a non-member throws not_a_member`
17. `getTrip by a member returns trip fields, all members, and only pending invites`

Now let me look at the service implementation to understand what methods are called:

- `createTrip(dto, creatorId)`: validates dates, calls `repo.create({name, destination, startDate, endDate, creatorId})`
- `inviteToTrip(tripId, dto, ownerId)`: calls `repo.findById`, `repo.getMembers`, checks owner role, `repo.findPendingInviteByTripAndEmail`, generates token, calls `repo.createInvite`
- `acceptInvite(token, userId)`: calls `repo.findInviteByToken`, `repo.findUserByEmail`, if pending: `repo.updateInviteStatus` + `repo.addMember`; if not pending: `repo.getMembers`, find membership
- `getTrip(tripId, requesterId)`: calls `repo.findById`, `repo.isMember`, `repo.getMembers`, `repo.getPendingInvites`

The `TripsRepository` interface from the repository file:
```ts
export interface TripsRepository {
  create(data: { name: string; destination: string; startDate: Date; endDate: Date; creatorId: number }): Promise<Trip>;
  findById(id: number): Promise<Trip | null>;
  addMember(tripId: number, userId: number, role: MemberRole): Promise<TripMember>;
  isMember(tripId: number, userId: number): Promise<boolean>;
  getMembers(tripId: number): Promise<TripMember[]>;
  findPendingInviteByTripAndEmail(tripId: number, email: string): Promise<TripInvite | null>;
  createInvite(tripId: number, email: string, token: string, invitedBy: number): Promise<TripInvite>;
  findInviteByToken(token: string): Promise<TripInvite | null>;
  updateInviteStatus(id: number, status: InviteStatus): Promise<TripInvite>;
  getPendingInvites(tripId: number): Promise<TripInvite[]>;
  findUserByEmail(email: string): Promise<{ id: number; email: string } | null>;
}
```

Now let me look at the `AppError` class. The plan says: "The existing `AppError` class accepts `(code: string, message: string, details?: Record<string, unknown>)`"

From the service code: `import { AppError } from '../../common/app-error';`

So in tests I'll need to import `AppError` from the same path or just check the error code property.

Let me look at the conventions: "Tests in `<name>.service.spec.ts` per module, repository faked at interface."

Now let me write the test file. I'll use Vitest (`describe`, `it`, `expect`, `vi`).

For the faked repository, I'll create a helper function that returns an object implementing `TripsRepository` with mutable state.

Let me think about how to structure the fake:

```ts
function createFakeRepo() {
  const repo = {
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
  return repo;
}
```

Then I'll set up the mock implementations per test.

Let me also think about the `AppError`. From the service, it's imported from `'../../common/app-error'`. The plan says it accepts `(code, message, details?)`. I'll assume it has a `code` property.

Actually, looking more carefully at the conventions section: "All endpoints return the shared envelope `{ ok, data | error }` via the existing `ApiResult<T>` helpers; errors use the existing `AppError` codes."

The error envelope is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So `AppError` likely has a `code` property. Let me just check for the `code` property in tests.

Actually, I need to be careful. The service throws `AppError` instances. In tests, I'll catch them and check the `code` property.

Let me write the complete test file now:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TripsService } from './trips.service';
import { TripsRepository } from './trips.repository';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteTripDto } from './dto/invite-trip.dto';
import { Trip } from './entities/trip.entity';
import { TripMember, MemberRole } from './entities/trip-member.entity';
import { TripInvite, InviteStatus } from './entities/trip-invite.entity';

// ... test cases
```

Wait, I need to think about what `AppError` looks like. The service imports it from `'../../common/app-error'`. In tests, I should import it the same way to check `instanceof` or just check the `code` property.

Actually, for unit tests, it's cleaner to just check the error code on the thrown error. I'll use `expect(...).rejects.toMatchObject({ code: '...' })` or catch and check.

Let me think about whether to use `rejects.toThrow` or `rejects.toMatchObject`. Since `AppError` is a custom class, I'll just check the `code` property.

Actually, looking at the error envelope format: `{ "error": { "code": "...", "message": "...", "details": {} } }`. The `AppError` class likely has these as properties: `code`, `message`, `details`.

I'll use a pattern like:
```ts
await expect(service.createTrip(dto, userId)).rejects.toMatchObject({ code: 'invalid_date_range' });
```

Or I could do:
```ts
try {
  await service.createTrip(dto, userId);
  expect.unreachable();
} catch (e) {
  expect(e).toBeInstanceOf(AppError);
  expect(e.code).toBe('invalid_date_range');
}
```

The `rejects.toMatchObject` approach is cleaner. Let me use that.

Now let me write the full file:

For test 8 (`inviteToTrip after an invite was declined creates a fresh pending invite`): This tests that when there's a prior invite with status 'declined', calling `findPendingInviteByTripAndEmail` returns null (because it only matches pending ones), so a new invite is created. I need to set up `findPendingInviteByTripAndEmail` to return null in this case.

Wait, actually the test name says "after an invite was declined creates a fresh pending invite". The key insight is that `findPendingInviteByTripAndEmail` should only return pending invites. So if the prior invite was declined, this method returns null, and the service creates a new one. The test proves that only pending invites are deduplicated.

In the fake repo, I just need `findPendingInviteByTripAndEmail` to return null (simulating that no pending invite exists because the prior one was declined). Then verify `createInvite` is called.

Actually, to make the test more meaningful, I should perhaps show that there IS a declined invite in the system but `findPendingInviteByTripAndEmail` correctly returns null. But since we're faking at the interface level, the fake just returns what we tell it to. The point is: if `findPendingInviteByTripAndEmail` returns null (because the only invite is declined, not pending), then a new invite should be created.

Let me structure this properly. I'll set `findPendingInviteByTripAndEmail` to return null and verify that `createInvite` is called with the correct args.

Now let me write the complete file. I'll be thorough with each test case.
```

## reply

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TripsService } from './trips.service';
import type { TripsRepository } from './trips.repository';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteTripDto } from './dto/invite-trip.dto';
import type { Trip } from './entities/trip.entity';
import type { TripMember, MemberRole } from './entities/trip-member.entity';
import type { TripInvite, InviteStatus } from './entities/trip-invite.entity';

function createFakeRepo(): vi.Mocked<TripsRepository> {
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
  } as unknown as vi.Mocked<TripsRepository>;
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    name: 'Summer Trip',
    destination: 'Lisbon',
    startDate: new Date('2025-07-01T00:00:00Z'),
    endDate: new Date('2025-07-14T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMember(overrides: Partial<TripMember> = {}): TripMember {
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

function makeInvite(overrides: Partial<TripInvite> = {}): TripInvite {
  return {
    id: 1,
    tripId: 1,
    email: 'friend@example.com',
    token: 'abc123',
    status: 'pending',
    invitedBy: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('TripsService', () => {
  let repo: vi.Mocked<TripsRepository>;
  let service: TripsService;

  beforeEach(() => {
    repo = createFakeRepo();
    service = new TripsService(repo as unknown as TripsRepository);
  });

  // ── createTrip ──────────────────────────────────────────────────────────────

  describe('createTrip', () => {
    it('returns the trip and passes creatorId to the repository', async () => {
      const trip = makeTrip({ id: 42 });
      repo.create.mockResolvedValue(trip);

      const dto = {
        name: 'Summer Trip',
        destination: 'Lisbon',
        startDate: '2025-07-01T00:00:00Z',
        endDate: '2025-07-14T00:00:00Z',
      } as CreateTripDto;

      const result = await service.createTrip(dto, 7);

      expect(result).toBe(trip);
      expect(repo.create).toHaveBeenCalledWith({
        name: 'Summer Trip',
        destination: 'Lisbon',
        startDate: new Date('2025-07-01T00:00:00Z'),
        endDate: new Date('2025-07-14T00:00:00Z'),
        creatorId: 7,
      });
    });

    it('rejects when startDate is after endDate', async () => {
      const dto = {
        name: 'Bad Trip',
        destination: 'Nowhere',
        startDate: '2025-07-14T00:00:00Z',
        endDate: '2025-07-01T00:00:00Z',
      } as CreateTripDto;

      await expect(service.createTrip(dto, 1)).rejects.toMatchObject({
        code: 'invalid_date_range',
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects when startDate equals endDate (boundary)', async () => {
      const dto = {
        name: 'Zero Trip',
        destination: 'Nowhere',
        startDate: '2025-07-01T00:00:00Z',
        endDate: '2025-07-01T00:00:00Z',
      } as CreateTripDto;

      await expect(service.createTrip(dto, 1)).rejects.toMatchObject({
        code: 'invalid_date_range',
      });
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── inviteToTrip ────────────────────────────────────────────────────────────

  describe('inviteToTrip', () => {
    it('on a non-existent trip throws trip_not_found', async () => {
      repo.findById.mockResolvedValue(null);

      const dto = { email: 'friend@example.com' } as InviteTripDto;

      await expect(service.inviteToTrip(99, dto, 1)).rejects.toMatchObject({
        code: 'trip_not_found',
      });
    });

    it('by a non-owner throws not_the_owner', async () => {
      const trip = makeTrip();
      repo.findById.mockResolvedValue(trip);

      const members: TripMember[] = [
        makeMember({ userId: 1, role: 'owner' }),
        makeMember({ id: 2, userId: 2, role: 'member' }),
      ];
      repo.getMembers.mockResolvedValue(members);

      const dto = { email: 'friend@example.com' } as InviteTripDto;

      // User 2 is a member but not the owner
      await expect(service.inviteToTrip(1, dto, 2)).rejects.toMatchObject({
        code: 'not_the_owner',
      });
    });

    it('by the owner with a new email creates a pending invite with a non-empty token', async () => {
      const trip = makeTrip();
      repo.findById.mockResolvedValue(trip);

      const members: TripMember[] = [makeMember({ userId: 1, role: 'owner' })];
      repo.getMembers.mockResolvedValue(members);

      repo.findPendingInviteByTripAndEmail.mockResolvedValue(null);

      const newInvite = makeInvite({
        id: 10,
        email: 'friend@example.com',
        token: 'generated-token-here',
        status: 'pending',
        invitedBy: 1,
      });
      repo.createInvite.mockResolvedValue(newInvite);

      const dto = { email: 'friend@example.com' } as InviteTripDto;
      const result = await service.inviteToTrip(1, dto, 1);

      expect(result).toBe(newInvite);
      expect(repo.createInvite).toHaveBeenCalledTimes(1);
      const [calledTripId, calledEmail, calledToken, calledInvitedBy] =
        repo.createInvite.mock.calls[0];
      expect(calledTripId).toBe(1);
      expect(calledEmail).toBe('friend@example.com');
      expect(typeof calledToken).toBe('string');
      expect(calledToken.length).toBeGreaterThan(0);
      expect(calledInvitedBy).toBe(1);
    });

    it('with an already-pending email returns the existing invite without creating a second row', async () => {
      const trip = makeTrip();
      repo.findById.mockResolvedValue(trip);

      const members: TripMember[] = [makeMember({ userId: 1, role: 'owner' })];
      repo.getMembers.mockResolvedValue(members);

      const existingInvite = makeInvite({
        id: 5,
        email: 'friend@example.com',
        token: 'existing-token',
        status: 'pending',
      });
      repo.findPendingInviteByTripAndEmail.mockResolvedValue(existingInvite);

      const dto = { email: 'friend@example.com' } as InviteTripDto;
      const result = await service.inviteToTrip(1, dto, 1);

      expect(result).toBe(existingInvite);
      expect(repo.createInvite).not.toHaveBeenCalled();
    });

    it('after an invite was declined creates a fresh pending invite', async () => {
      const trip = makeTrip();
      repo.findById.mockResolvedValue(trip);

      const members: TripMember[] = [makeMember({ userId: 1, role: 'owner' })];
      repo.getMembers.mockResolvedValue(members);

      // No pending invite exists (the prior one was declined), so the dedup query returns null
      repo.findPendingInviteByTripAndEmail.mockResolvedValue(null);

      const freshInvite = makeInvite({
        id: 20,
        email: 'friend@example.com',
        token: 'fresh-token',
        status: 'pending',
      });
      repo.createInvite.mockResolvedValue(freshInvite);

      const dto = { email: 'friend@example.com' } as InviteTripDto;
      const result = await service.inviteToTrip(1, dto, 1);

      expect(result).toBe(freshInvite);
      expect(repo.createInvite).toHaveBeenCalledTimes(1);
    });
  });

  // ── acceptInvite ────────────────────────────────────────────────────────────

  describe('acceptInvite', () => {
    it('with an unknown token throws invite_not_found', async () => {
      repo.findInviteByToken.mockResolvedValue(null);

      await expect(service.acceptInvite('bad-token', 1)).rejects.toMatchObject({
        code: 'invite_not_found',
      });
    });

    it('when the inviting email has no registered user throws invite_not_found', async () => {
      const invite = makeInvite({ email: 'ghost@example.com' });
      repo.findInviteByToken.mockResolvedValue(invite);
      repo.findUserByEmail.mockResolvedValue(null);

      await expect(service.acceptInvite(invite.token, 1)).rejects.toMatchObject({
        code: 'invite_not_found',
      });
    });

    it("by a user whose id differs from the invitee's user throws invite_not_found", async () => {
      const invite = makeInvite({ email: 'friend@example.com' });
      repo.findInviteByToken.mockResolvedValue(invite);

      // The invitee's registered user has id 5, but the requester is user 3
      repo.findUserByEmail.mockResolvedValue({ id: 5, email: 'friend@example.com' });

      await expect(service.acceptInvite(invite.token, 3)).rejects.toMatchObject({
        code: 'invite_not_found',
      });
    });

    it("on a valid pending invite marks it accepted and returns the new member row with role 'member'", async () => {
      const invite = makeInvite({
        email: 'friend@example.com',
        token: 'valid-token',
        status: 'pending',
      });
      repo.findInviteByToken.mockResolvedValue(invite);
      repo.findUserByEmail.mockResolvedValue({ id: 5, email: 'friend@example.com' });

      const updatedInvite = { ...invite, status: 'accepted' as InviteStatus };
      repo.updateInviteStatus.mockResolvedValue(updatedInvite);

      const newMember = makeMember({
        id: 100,
        tripId: invite.tripId,
        userId: 5,
        role: 'member',
      });
      repo.addMember.mockResolvedValue(newMember);

      const result = await service.acceptInvite('valid-token', 5);

      expect(repo.updateInviteStatus).toHaveBeenCalledWith(invite.id, 'accepted');
      expect(repo.addMember).toHaveBeenCalledWith(invite.tripId, 5, 'member');
      expect(result).toBe(newMember);
      expect(result.role).toBe('member');
    });

    it('on an already-accepted invite is a no-op returning the existing membership', async () => {
      const invite = makeInvite({
        email: 'friend@example.com',
        token: 'accepted-token',
        status: 'accepted',
      });
      repo.findInviteByToken.mockResolvedValue(invite);
      repo.findUserByEmail.mockResolvedValue({ id: 5, email: 'friend@example.com' });

      const existingMembership = makeMember({
        id: 100,
        tripId: invite.tripId,
        userId: 5,
        role: 'member',
      });
      repo.getMembers.mockResolvedValue([existingMembership]);

      const result = await service.acceptInvite('accepted-token', 5);

      expect(result).toBe(existingMembership);
      expect(repo.updateInviteStatus).not.toHaveBeenCalled();
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('on a declined invite throws invite_not_found (does not create membership)', async () => {
      const invite = makeInvite({
        email: 'friend@example.com',
        token: 'declined-token',
        status: 'declined',
      });
      repo.findInviteByToken.mockResolvedValue(invite);
      repo.findUserByEmail.mockResolvedValue({ id: 5, email: 'friend@example.com' });

      // No membership exists for this user (invite was declined, never accepted)
      repo.getMembers.mockResolvedValue([]);

      await expect(service.acceptInvite('declined-token', 5)).rejects.toMatchObject({
        code: 'invite_not_found',
      });
      expect(repo.addMember).not.toHaveBeenCalled();
    });
  });

  // ── getTrip ─────────────────────────────────────────────────────────────────

  describe('getTrip', () => {
    it('on a non-existent trip throws trip_not_found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getTrip(99, 1)).rejects.toMatchObject({
        code: 'trip_not_found',
      });
    });

    it('by a non-member throws not_a_member', async () => {
      const trip = makeTrip();
      repo.findById.mockResolvedValue(trip);
      repo.isMember.mockResolvedValue(false);

      await expect(service.getTrip(1, 99)).rejects.toMatchObject({
        code: 'not_a_member',
      });
    });

    it('by a member returns trip fields, all members, and only pending invites', async () => {
      const trip = makeTrip({
        id: 1,
        name: 'Summer Trip',
        destination: 'Lisbon',
        startDate: new Date('2025-07-01T00:00:00Z'),
        endDate: new Date('2025-07-14T00:00:00Z'),
      });
      repo.findById.mockResolvedValue(trip);
      repo.isMember.mockResolvedValue(true);

      const members: TripMember[] = [
        makeMember({ id: 1, userId: 1, role: 'owner' }),
        makeMember({ id: 2, userId: 2, role: 'member' }),
      ];
      repo.getMembers.mockResolvedValue(members);

      const pendingInvites: TripInvite[] = [
        makeInvite({ id: 10, email: 'a@example.com', token: 'tok-a', status: 'pending' }),
        makeInvite({ id: 11, email: 'b@example.com', token: 'tok-b', status: 'pending' }),
      ];
      repo.getPendingInvites.mockResolvedValue(pendingInvites);

      const result = await service.getTrip(1, 1);

      expect(result.id).toBe(1);
      expect(result.name).toBe('Summer Trip');
      expect(result.destination).toBe('Lisbon');
      expect(result.startDate).toBe('2025-07-01T00:00:00.000Z');
      expect(result.endDate).toBe('2025-07-14T00:00:00.000Z');

      expect(result.members).toEqual([
        { userId: 1, role: 'owner' },
        { userId: 2, role: 'member' },
      ]);

      expect(result.pendingInvites).toEqual([
        { email: 'a@example.com', token: 'tok-a' },
        { email: 'b@example.com', token: 'tok-b' },
      ]);
    });
  });
});
```
