import { describe, expect, it } from 'vitest';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripMemberRow,
  TripRow,
  UserRow,
} from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { TripsService } from './trips.service.js';
import type { MemberWithUserRow, TripsRepository } from './trips.repository.js';

/**
 * The repository is faked at its interface. Services are tested against a fake
 * repository, never against a mocked Drizzle — one spec per module, named
 * `<name>.service.spec.ts`.
 */

const NOW = new Date('2024-06-01T00:00:00Z');

const adaUser: CurrentUserPayload = { id: 'u1', email: 'ada@example.com' };
const graceUser: CurrentUserPayload = { id: 'u2', email: 'grace@example.com' };
const malloryUser: CurrentUserPayload = { id: 'u3', email: 'mallory@example.com' };

function user(over: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as UserRow;
}

function trip(over: Partial<TripRow> = {}): TripRow {
  return {
    id: 't1',
    name: 'Lisbon in June',
    destination: 'Lisbon, PT',
    startDate: new Date('2024-06-05T00:00:00Z'),
    endDate: new Date('2024-06-12T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as TripRow;
}

function member(over: Partial<TripMemberRow> = {}): TripMemberRow {
  return {
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    role: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as TripMemberRow;
}

function invite(over: Partial<TripInviteRow> = {}): TripInviteRow {
  return {
    id: 'i1',
    tripId: 't1',
    email: 'grace@example.com',
    token: 'tok-1',
    status: 'pending',
    invitedBy: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as TripInviteRow;
}

function fakeRepo(data: {
  trips?: TripRow[];
  members?: TripMemberRow[];
  invites?: TripInviteRow[];
  users?: UserRow[];
} = {}): TripsRepository {
  const trips = data.trips ?? [];
  const members = data.members ?? [];
  const invites = data.invites ?? [];
  const users = data.users ?? [];

  const withUser = (m: TripMemberRow): MemberWithUserRow | null => {
    const u = users.find((x) => x.id === m.userId);
    if (!u) return null;
    return {
      id: m.id,
      tripId: m.tripId,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
      email: u.email,
      displayName: u.displayName,
    };
  };

  return {
    async insertTrip(row: NewTripRow): Promise<TripRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      trips.push(created);
      return created;
    },
    async findTripById(id: string): Promise<TripRow | null> {
      return trips.find((t) => t.id === id) ?? null;
    },
    async insertMember(row: NewTripMemberRow): Promise<TripMemberRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripMemberRow;
      members.push(created);
      return created;
    },
    async findMember(tripId: string, userId: string): Promise<TripMemberRow | null> {
      return members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async findMemberWithUser(tripId: string, userId: string): Promise<MemberWithUserRow | null> {
      const m = members.find((x) => x.tripId === tripId && x.userId === userId);
      return m ? withUser(m) : null;
    },
    async findMembersWithUsers(tripId: string): Promise<MemberWithUserRow[]> {
      return members
        .filter((m) => m.tripId === tripId)
        .map(withUser)
        .filter((m): m is MemberWithUserRow => m !== null);
    },
    async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      invites.push(created);
      return created;
    },
    async findInviteByToken(token: string): Promise<TripInviteRow | null> {
      return invites.find((i) => i.token === token) ?? null;
    },
    async findLatestInviteByEmail(tripId: string, email: string): Promise<TripInviteRow | null> {
      const list = invites.filter((i) => i.tripId === tripId && i.email === email);
      return list.length > 0 ? list[list.length - 1] : null;
    },
    async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
      return invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async updateInviteStatus(id: string, status: string): Promise<TripInviteRow> {
      const i = invites.find((x) => x.id === id);
      if (!i) throw new Error(`invite ${id} not found`);
      i.status = status;
      i.updatedAt = NOW;
      return i;
    },
  } as unknown as TripsRepository;
}

const ada = user();
const grace = user({ id: 'u2', email: 'grace@example.com', displayName: 'Grace' });

describe('TripsService', () => {
  describe('createTrip', () => {
    it('creates the trip and records the creator as the owner member', async () => {
      const svc = new TripsService(fakeRepo({ users: [ada] }));
      const created = await svc.createTrip(
        { name: 'Lisbon in June', destination: 'Lisbon, PT', startDate: '2024-06-05', endDate: '2024-06-12' },
        adaUser,
      );
      expect(created.name).toBe('Lisbon in June');
      expect(created.destination).toBe('Lisbon, PT');
      expect(created.startDate).toBe('2024-06-05');
      expect(created.endDate).toBe('2024-06-12');
      const detail = await svc.getTrip(created.id, adaUser);
      expect(detail.members).toHaveLength(1);
      expect(detail.members[0]).toMatchObject({ userId: 'u1', role: 'owner', email: 'ada@example.com' });
    });
  });

  describe('getTrip', () => {
    it('returns the trip with its members and only the pending invites', async () => {
      const svc = new TripsService(
        fakeRepo({
          trips: [trip()],
          users: [ada, grace],
          members: [member(), member({ id: 'm2', userId: 'u2', role: 'member' })],
          invites: [invite(), invite({ id: 'i2', email: 'hopper@example.com', token: 'tok-2', status: 'accepted' })],
        }),
      );
      const detail = await svc.getTrip('t1', graceUser);
      expect(detail.id).toBe('t1');
      expect(detail.members).toHaveLength(2);
      expect(detail.members.map((m) => m.role)).toEqual(['owner', 'member']);
      expect(detail.pendingInvites).toHaveLength(1);
      expect(detail.pendingInvites[0]).toMatchObject({ email: 'grace@example.com', status: 'pending', token: 'tok-1' });
    });

    it('raises forbidden for a user who is not a member', async () => {
      const svc = new TripsService(fakeRepo({ trips: [trip()], users: [ada] }));
      await expect(svc.getTrip('t1', malloryUser)).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('raises not_found for an unknown trip', async () => {
      const svc = new TripsService(fakeRepo({ users: [ada] }));
      await expect(svc.getTrip('nope', adaUser)).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('invite', () => {
    it('lets the owner invite by email; the invite is pending and carries a token', async () => {
      const svc = new TripsService(fakeRepo({ trips: [trip()], users: [ada] }));
      const created = await svc.invite('t1', { email: 'grace@example.com' }, adaUser);
      expect(created.tripId).toBe('t1');
      expect(created.email).toBe('grace@example.com');
      expect(created.status).toBe('pending');
      expect(created.token).toBeTruthy();
    });

    it('inviting the same email twice returns the existing pending invite', async () => {
      const svc = new TripsService(fakeRepo({ trips: [trip()], users: [ada] }));
      const first = await svc.invite('t1', { email: 'grace@example.com' }, adaUser);
      const second = await svc.invite('t1', { email: 'grace@example.com' }, adaUser);
      expect(second.id).toBe(first.id);
      expect(second.token).toBe(first.token);
    });

    it('issues a fresh invite when the latest invite for that email was already accepted', async () => {
      const svc = new TripsService(
        fakeRepo({
          trips: [trip()],
          users: [ada, grace],
          members: [member(), member({ id: 'm2', userId: 'u2', role: 'member' })],
          invites: [invite({ status: 'accepted' })],
        }),
      );
      const reInvite = await svc.invite('t1', { email: 'grace@example.com' }, adaUser);
      expect(reInvite.id).not.toBe('i1');
      expect(reInvite.token).not.toBe('tok-1');
      expect(reInvite.status).toBe('pending');
    });

    it('raises forbidden when a non-owner member invites', async () => {
      const svc = new TripsService(
        fakeRepo({
          trips: [trip()],
          users: [ada, grace],
          members: [member(), member({ id: 'm2', userId: 'u2', role: 'member' })],
        }),
      );
      await expect(svc.invite('t1', { email: 'hopper@example.com' }, graceUser)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('raises forbidden when a non-member invites', async () => {
      const svc = new TripsService(fakeRepo({ trips: [trip()], users: [ada] }));
      await expect(svc.invite('t1', { email: 'grace@example.com' }, malloryUser)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('raises not_found for an unknown trip', async () => {
      const svc = new TripsService(fakeRepo({ users: [ada] }));
      await expect(svc.invite('nope', { email: 'grace@example.com' }, adaUser)).rejects.toMatchObject({
        code: 'not_found',
      });
    });
  });

  describe('accept', () => {
    it('adds the accepting user as a member and marks the invite accepted', async () => {
      const svc = new TripsService(
        fakeRepo({ trips: [trip()], users: [ada, grace], members: [member()], invites: [invite()] }),
      );
      const membership = await svc.accept('tok-1', graceUser);
      expect(membership).toMatchObject({ userId: 'u2', role: 'member', email: 'grace@example.com' });
      const detail = await svc.getTrip('t1', graceUser);
      expect(detail.members).toHaveLength(2);
      expect(detail.pendingInvites).toHaveLength(0);
    });

    it('accepting twice is a no-op returning the same membership', async () => {
      const svc = new TripsService(
        fakeRepo({ trips: [trip()], users: [ada, grace], members: [member()], invites: [invite()] }),
      );
      const first = await svc.accept('tok-1', graceUser);
      const second = await svc.accept('tok-1', graceUser);
      expect(second.id).toBe(first.id);
      expect(second.role).toBe('member');
      const detail = await svc.getTrip('t1', graceUser);
      expect(detail.members.filter((m) => m.userId === 'u2')).toHaveLength(1);
    });

    it('raises not_found for an unknown token', async () => {
      const svc = new TripsService(fakeRepo({ trips: [trip()], users: [ada] }));
      await expect(svc.accept('nope', graceUser)).rejects.toMatchObject({ code: 'not_found' });
    });
  });
});
