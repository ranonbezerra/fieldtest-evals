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
