# repair2-trips.service.spec.ts

## reasoning

```
We need to rewrite trips.service.spec.ts to compile. The errors indicate missing imports, missing file extensions, missing service method `create` (controller expects). We need to adjust imports to include .js extensions because project uses ES modules with node16 moduleResolution.

We must create spec file that imports TripsService, TripRepository, etc. The spec currently probably had wrong paths. We need to write a test file that compiles; it should mock repositories. Use ts-mockito or jest? Vitest uses jest style. We'll write a simple spec focusing on service logic. Should import with .js extensions: e.g., import { TripsService } from './trips.service.js'; but actual file is .ts compiled? In ESM, TS transpiles to .js, but source import should have .js extension for TS with moduleResolution node16. So we need .js extension in imports.

Also need to import other modules similarly.

We need to define mock repositories implementing needed methods used in service: create, findById, findPendingByTripAndEmail, create for invites, findByToken, updateStatus, findByTripAndUser, etc. We'll create simple jest mock objects.

Test cases: createTrip, invite existing pending, invite new, acceptInvite already accepted, acceptInvite new, getTrip unauthorized, getTrip authorized.

But we just need compile; maybe simple test with at least one test and assertions.

Let's write spec:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripsService } from './trips.service.js';
import { TripRepository } from './trip.repository.js';
import { InviteRepository } from './invite.repository.js';
import { MemberRepository } from './member.repository.js';
import { ApiResult } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import {
  NewTripRow,
  TripRow,
  NewInviteRow,
  InviteRow,
  NewMemberRow,
  MemberRow,
} from '../../../drizzle/schema.js';
```

But the schema export likely includes types; we can import .js.

Now create mock repos:

```ts
let tripsRepo: jest.Mocked<TripRepository>;
...
```

But using vitest's vi.fn.

Define beforeEach to instantiate mocks and service.

Implement minimal methods needed with vi.fn returning appropriate values.

Write tests.

Also need to adjust imports for repository files - they likely don't exist yet, but we can assume they exist; the spec imports them.

If repository files don't exist, compile error; but we can mock them by creating interface definitions locally? Actually import will fail if file not present. The repository files are not yet created; we need to reference them but they may not exist. The error says cannot find module './trip.repository' etc. So we need to create those files? However the task is only to rewrite spec, not other files. The spec can avoid importing the repository modules, instead we can define mock classes in spec and use them as dependencies without importing. The service expects types TripRepository etc; we can create dummy classes that match expected shape. We can import the type definitions from the service file? The service file imports them, but the spec could import the service and then use any as type.

Simplest: import TripsService from './trips.service.js' and then create mock objects typed as any. Use `as unknown as TripRepository` etc without import.

Thus we avoid importing non-existent repository modules.

So spec imports only TripsService, ApiResult, AppError, schema types.

Now create mock repos as objects with needed methods.

Implement tests.

Make sure to add .js extensions.

Let's write.
```

## reply

```ts
// src/modules/trips/trips.service.spec.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripsService } from './trips.service.js';
import { ApiResult } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import type {
  NewTripRow,
  TripRow,
  NewInviteRow,
  InviteRow,
  NewMemberRow,
  MemberRow,
} from '../../../drizzle/schema.js';

// ---------------------------------------------------------------------------
// Mock repository interfaces
// ---------------------------------------------------------------------------
// The concrete repository classes are not part of the test scope, therefore we
// define minimal shapes that satisfy the service's expectations.
// ---------------------------------------------------------------------------

type TripRepository = {
  create: (row: NewTripRow) => Promise<TripRow>;
  findById: (id: string) => Promise<TripRow | null>;
};

type InviteRepository = {
  findPendingByTripAndEmail: (tripId: string, email: string) => Promise<InviteRow | null>;
  create: (row: NewInviteRow) => Promise<InviteRow>;
  findByToken: (token: string) => Promise<InviteRow | null>;
  updateStatus: (id: string, status: string) => Promise<void>;
  findPendingByTrip: (tripId: string) => Promise<InviteRow[]>;
};

type MemberRepository = {
  create: (row: NewMemberRow) => Promise<MemberRow>;
  findByTripAndUser: (tripId: string, userId: string) => Promise<MemberRow | null>;
  isMember: (tripId: string, userId: string) => Promise<boolean>;
  findAllByTrip: (tripId: string) => Promise<MemberRow[]>;
};

// ---------------------------------------------------------------------------
// Helper factories for mock data
// ---------------------------------------------------------------------------

const makeTrip = (overrides?: Partial<TripRow>): TripRow => ({
  id: 'trip-1',
  name: 'Test Trip',
  destination: 'Paris',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-10'),
  ownerId: 'owner-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeInvite = (overrides?: Partial<InviteRow>): InviteRow => ({
  id: 'invite-1',
  tripId: 'trip-1',
  email: 'guest@example.com',
  token: 'token-123',
  status: 'pending',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMember = (overrides?: Partial<MemberRow>): MemberRow => ({
  id: 'member-1',
  tripId: 'trip-1',
  userId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TripsService', () => {
  let tripsRepo: TripRepository;
  let invitesRepo: InviteRepository;
  let membersRepo: MemberRepository;
  let service: TripsService;

  beforeEach(() => {
    tripsRepo = {
      create: vi.fn(),
      findById: vi.fn(),
    };

    invitesRepo = {
      findPendingByTripAndEmail: vi.fn(),
      create: vi.fn(),
      findByToken: vi.fn(),
      updateStatus: vi.fn(),
      findPendingByTrip: vi.fn(),
    };

    membersRepo = {
      create: vi.fn(),
      findByTripAndUser: vi.fn(),
      isMember: vi.fn(),
      findAllByTrip: vi.fn(),
    };

    service = new TripsService(
      tripsRepo as unknown as any,
      invitesRepo as unknown as any,
      membersRepo as unknown as any,
    );
  });

  // -------------------------------------------------------------------------
  // 1️⃣ createTrip – creator becomes owner and member
  // -------------------------------------------------------------------------
  it('creates a trip and adds the creator as a member', async () => {
    const creatorId = 'owner-1';
    const payload = {
      name: 'Summer Escape',
      destination: 'Hawaii',
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-15'),
    };

    const persistedTrip = makeTrip({ ownerId: creatorId, ...payload });
    (tripsRepo.create as any).mockResolvedValue(persistedTrip);
    (membersRepo.create as any).mockResolvedValue(makeMember({ userId: creatorId }));

    const result = await service.createTrip(creatorId, payload);
    expect(ApiResult.isOk(result)).toBe(true);
    if (ApiResult.isOk(result)) {
      expect(result.data).toMatchObject(persistedTrip);
    }

    expect(tripsRepo.create).toHaveBeenCalledOnce();
    expect(membersRepo.create).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 2️⃣ invite – creates a new pending invite or returns existing one
  // -------------------------------------------------------------------------
  it('creates a new invite when none exists', async () => {
    const ownerId = 'owner-1';
    const tripId = 'trip-1';
    const email = 'guest@example.com';

    (tripsRepo.findById as any).mockResolvedValue(makeTrip({ id: tripId, ownerId }));
    (invitesRepo.findPendingByTripAndEmail as any).mockResolvedValue(null);
    (invitesRepo.create as any).mockImplementation(async (row: NewInviteRow) =>
      makeInvite({ ...row, id: 'invite-2' } as Partial<InviteRow>),
    );

    const result = await service.invite(ownerId, tripId, email);
    expect(ApiResult.isOk(result)).toBe(true);
    if (ApiResult.isOk(result)) {
      expect(result.data.email).toBe(email);
      expect(result.data.status).toBe('pending');
    }

    expect(invitesRepo.create).toHaveBeenCalledOnce();
  });

  it('returns the existing pending invite if one already exists', async () => {
    const ownerId = 'owner-1';
    const tripId = 'trip-1';
    const email = 'guest@example.com';
    const existingInvite = makeInvite({ email, tripId });

    (tripsRepo.findById as any).mockResolvedValue(makeTrip({ id: tripId, ownerId }));
    (invitesRepo.findPendingByTripAndEmail as any).mockResolvedValue(existingInvite);

    const result = await service.invite(ownerId, tripId, email);
    expect(ApiResult.isOk(result)).toBe(true);
    if (ApiResult.isOk(result)) {
      expect(result.data.id).toBe(existingInvite.id);
    }

    expect(invitesRepo.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3️⃣ acceptInvite – idempotent acceptance
  // -------------------------------------------------------------------------
  it('accepts a pending invite and creates membership', async () => {
    const token = 'token-123';
    const userId = 'user-2';
    const invite = makeInvite({ token, status: 'pending' });

    (invitesRepo.findByToken as any).mockResolvedValue(invite);
    (membersRepo.create as any).mockResolvedValue(makeMember({ userId }));
    (invitesRepo.updateStatus as any).mockResolvedValue(undefined);

    const result = await service.acceptInvite(token, userId);
    expect(ApiResult.isOk(result)).toBe(true);
    if (ApiResult.isOk(result)) {
      expect(result.data.userId).toBe(userId);
    }

    expect(invitesRepo.updateStatus).toHaveBeenCalledOnce();
    expect(membersRepo.create).toHaveBeenCalledOnce();
  });

  it('returns existing membership when invite already accepted', async () => {
    const token = 'token-123';
    const userId = 'user-2';
    const invite = makeInvite({ token, status: 'accepted' });
    const existingMember = makeMember({ userId });

    (invitesRepo.findByToken as any).mockResolvedValue(invite);
    (membersRepo.findByTripAndUser as any).mockResolvedValue(existingMember);

    const result = await service.acceptInvite(token, userId);
    expect(ApiResult.isOk(result)).toBe(true);
    if (ApiResult.isOk(result)) {
      expect(result.data.id).toBe(existingMember.id);
    }

    expect(invitesRepo.updateStatus).not.toHaveBeenCalled();
    expect(membersRepo.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4️⃣ getTrip – only members can view trip details
  // -------------------------------------------------------------------------
  it('returns trip details for a member', async () => {
    const requesterId = 'member-1';
    const tripId = 'trip-1';
    const trip = makeTrip({ id: tripId });
    const members = [makeMember({ userId: requesterId })];
    const pendingInvites = [makeInvite({ tripId })];

    (tripsRepo.findById as any).mockResolvedValue(trip);
    (membersRepo.isMember as any).mockResolvedValue(true);
    (membersRepo.findAllByTrip as any).mockResolvedValue(members);
    (invitesRepo.findPendingByTrip as any).mockResolvedValue(pendingInvites);

    const result = await service.getTrip(requesterId, tripId);
    expect(ApiResult.isOk(result)).toBe(true);
    if (ApiResult.isOk(result)) {
      expect(result.data.trip.id).toBe(tripId);
      expect(result.data.members).toEqual(members);
      expect(result.data.pendingInvites).toEqual(pendingInvites);
    }
  });

  it('fails when requester is not a member', async () => {
    const requesterId = 'stranger';
    const tripId = 'trip-1';
    (tripsRepo.findById as any).mockResolvedValue(makeTrip({ id: tripId }));
    (membersRepo.isMember as any).mockResolvedValue(false);

    const result = await service.getTrip(requesterId, tripId);
    expect(ApiResult.isError(result)).toBe(true);
    if (ApiResult.isError(result)) {
      expect(result.error.code).toBe('trip_forbidden');
    }
  });
});
```
