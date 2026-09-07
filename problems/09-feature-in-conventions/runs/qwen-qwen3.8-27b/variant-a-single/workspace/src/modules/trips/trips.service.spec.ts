import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripsService } from './trips.service';
import { TripsRepository, Trip, TripMember, TripInvite } from './trips.repository';
import { AppError } from '../../common/app-error';

// ASSUMPTION: service.createTrip takes (name, destination, startDate, endDate, userId) as separate string args.
// ASSUMPTION: service.inviteMember takes (tripId, inviterId, email) where email is a plain string (InviteMemberDto = string).
// ASSUMPTION: service.acceptInvite takes (token, userId).
// ASSUMPTION: service.getTrip takes (tripId, userId).

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    name: 'Summer Trip',
    destination: 'Lisbon',
    startDate: '2025-06-01',
    endDate: '2025-06-07',
    ...overrides,
  };
}

function makeMember(overrides: Partial<TripMember> = {}): TripMember {
  return {
    id: 'member-1',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    tripId: 'trip-1',
    userId: 'user-1',
    role: 'owner',
    ...overrides,
  };
}

function makeInvite(overrides: Partial<TripInvite> = {}): TripInvite {
  return {
    id: 'invite-1',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    tripId: 'trip-1',
    email: 'friend@example.com',
    token: 'token-abc',
    status: 'pending',
    ...overrides,
  };
}

function makeRepo() {
  return {
    createTrip: vi.fn(),
    addMember: vi.fn(),
    findTrip: vi.fn(),
    isOwner: vi.fn(),
    findMembership: vi.fn(),
    getMembers: vi.fn(),
    getPendingInvites: vi.fn(),
    findPendingInvite: vi.fn(),
    createInvite: vi.fn(),
    findInviteByToken: vi.fn(),
    updateInviteStatus: vi.fn(),
  };
}

describe('TripsService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: TripsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new TripsService(repo as unknown as TripsRepository);
  });

  describe('createTrip', () => {
    it('creates a trip and adds the creator as owner', async () => {
      const trip = makeTrip();
      repo.createTrip.mockResolvedValue(trip);
      repo.addMember.mockResolvedValue(undefined);

      const result = await service.createTrip('Summer Trip', 'Lisbon', '2025-06-01', '2025-06-07', 'user-1');

      expect(repo.createTrip).toHaveBeenCalledWith({
        name: 'Summer Trip',
        destination: 'Lisbon',
        startDate: '2025-06-01',
        endDate: '2025-06-07',
      });
      expect(repo.addMember).toHaveBeenCalledWith('trip-1', 'user-1', 'owner');
      expect(result).toEqual(trip);
    });
  });

  describe('inviteMember', () => {
    it('creates a new pending invite when no pending invite exists for that email', async () => {
      const trip = makeTrip();
      const invite = makeInvite();
      repo.findTrip.mockResolvedValue(trip);
      repo.isOwner.mockResolvedValue(true);
      repo.findPendingInvite.mockResolvedValue(null);
      repo.createInvite.mockResolvedValue(invite);

      const result = await service.inviteMember('trip-1', 'user-1', 'friend@example.com');

      expect(repo.findPendingInvite).toHaveBeenCalledWith('trip-1', 'friend@example.com');
      expect(repo.createInvite).toHaveBeenCalledWith('trip-1', 'friend@example.com', expect.any(String));
      expect(result).toEqual(invite);
    });

    it('returns the existing pending invite without creating a new one', async () => {
      const trip = makeTrip();
      const existing = makeInvite();
      repo.findTrip.mockResolvedValue(trip);
      repo.isOwner.mockResolvedValue(true);
      repo.findPendingInvite.mockResolvedValue(existing);

      const result = await service.inviteMember('trip-1', 'user-1', 'friend@example.com');

      expect(repo.createInvite).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('throws not_found when the trip does not exist', async () => {
      repo.findTrip.mockResolvedValue(null);

      await expect(
        service.inviteMember('nope', 'user-1', 'friend@example.com'),
      ).rejects.toThrow(AppError);
    });

    it('throws forbidden when the inviter is not the owner', async () => {
      const trip = makeTrip();
      repo.findTrip.mockResolvedValue(trip);
      repo.isOwner.mockResolvedValue(false);

      await expect(
        service.inviteMember('trip-1', 'user-2', 'friend@example.com'),
      ).rejects.toThrow(AppError);
    });
  });

  describe('acceptInvite', () => {
    it('accepts a pending invite and adds the user as a member', async () => {
      const invite = makeInvite();
      const membership = makeMember({ role: 'member', userId: 'user-2' });
      repo.findInviteByToken.mockResolvedValue(invite);
      repo.updateInviteStatus.mockResolvedValue({ ...invite, status: 'accepted' as const });
      repo.findMembership.mockResolvedValue(null);
      repo.addMember.mockResolvedValue(undefined);

      const result = await service.acceptInvite('token-abc', 'user-2');

      expect(repo.updateInviteStatus).toHaveBeenCalledWith('invite-1', 'accepted');
      expect(repo.addMember).toHaveBeenCalledWith('trip-1', 'user-2', 'member');
      expect(result).toEqual(membership);
    });

    it('is a no-op returning the existing membership when the invite was already accepted', async () => {
      const invite = makeInvite({ status: 'accepted' });
      const existing = makeMember({ role: 'member', userId: 'user-2' });
      repo.findInviteByToken.mockResolvedValue(invite);
      repo.findMembership.mockResolvedValue(existing);

      const result = await service.acceptInvite('token-abc', 'user-2');

      expect(repo.updateInviteStatus).not.toHaveBeenCalled();
      expect(repo.addMember).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('throws not_found when the token does not match any invite', async () => {
      repo.findInviteByToken.mockResolvedValue(null);

      await expect(service.acceptInvite('bad-token', 'user-2')).rejects.toThrow(AppError);
    });
  });

  describe('getTrip', () => {
    it('returns the trip with members and pending invites for a member', async () => {
      const trip = makeTrip();
      const members = [
        makeMember(),
        makeMember({ id: 'member-2', userId: 'user-2', role: 'member' }),
      ];
      const invites = [makeInvite()];
      repo.findTrip.mockResolvedValue(trip);
      repo.findMembership.mockResolvedValue(members[0]);
      repo.getMembers.mockResolvedValue(members);
      repo.getPendingInvites.mockResolvedValue(invites);

      const result = await service.getTrip('trip-1', 'user-1');

      expect(result).toMatchObject({
        id: 'trip-1',
        name: 'Summer Trip',
        destination: 'Lisbon',
        startDate: '2025-06-01',
        endDate: '2025-06-07',
      });
      expect(result).toHaveProperty('members');
      expect(result).toHaveProperty('invites');
    });

    it('throws not_found when the trip does not exist', async () => {
      repo.findTrip.mockResolvedValue(null);

      await expect(service.getTrip('nope', 'user-1')).rejects.toThrow(AppError);
    });

    it('throws forbidden when the requesting user is not a member of the trip', async () => {
      const trip = makeTrip();
      repo.findTrip.mockResolvedValue(trip);
      repo.findMembership.mockResolvedValue(null);

      await expect(service.getTrip('trip-1', 'user-3')).rejects.toThrow(AppError);
    });
  });
});
