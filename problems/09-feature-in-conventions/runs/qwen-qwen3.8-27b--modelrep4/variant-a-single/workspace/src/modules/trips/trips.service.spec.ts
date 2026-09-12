import { describe, expect, it } from 'vitest';
import type { InviteRow, MembershipRow, TripRow, UserRow } from '../../../drizzle/schema.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

/**
 * The repository is faked at its interface. Services are tested against a fake
 * repository, never against a mocked Drizzle -- one spec per module, named
 * `<name>.service.spec.ts`.
 */

const now = new Date('2024-06-01T00:00:00Z');
const OWNER = { id: 'u1', email: 'ada@example.com' };
const GUEST = { id: 'u2', email: 'grace@example.com' };

const TRIP_DTO = {
  name: 'Alps Hike',
  destination: 'Chamonix, FR',
  startDate: '2024-09-01',
  endDate: '2024-09-08',
};

const userRow = (id: string, email: string, displayName: string): UserRow =>
  ({
    id,
    email,
    displayName,
    createdAt: now,
    updatedAt: now,
  }) as UserRow;

interface FakeState {
  trips: TripRow[];
  members: MembershipRow[];
  invites: InviteRow[];
  users: UserRow[];
}

function fakeRepo(): { repo: TripsRepository; state: FakeState } {
  const state: FakeState = { trips: [], members: [], invites: [], users: [] };
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  const repo = {
    async createTripWithOwner(input: {
      id: string;
      name: string;
      destination: string;
      startDate: string;
      endDate: string;
      ownerId: string;
    }) {
      const trip: TripRow = {
        id: input.id,
        name: input.name,
        destination: input.destination,
        startDate: input.startDate,
        endDate: input.endDate,
        createdAt: now,
        updatedAt: now,
      };
      state.trips.push(trip);
      const owner: MembershipRow = {
        id: nextId('m'),
        tripId: trip.id,
        userId: input.ownerId,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      };
      state.members.push(owner);
      return { trip, owner };
    },
    async findTripById(id: string) {
      return state.trips.find((t) => t.id === id) ?? null;
    },
    async findMembership(tripId: string, userId: string) {
      return state.members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async findMembershipByEmail(tripId: string, email: string) {
      return (
        state.members.find((m) => {
          if (m.tripId !== tripId) return false;
          const user = state.users.find((u) => u.id === m.userId);
          return !!user && user.email.toLowerCase() === email.toLowerCase();
        }) ?? null
      );
    },
    async addMembership(tripId: string, userId: string, role: 'owner' | 'member') {
      const row: MembershipRow = {
        id: nextId('m'),
        tripId,
        userId,
        role,
        createdAt: now,
        updatedAt: now,
      };
      state.members.push(row);
      return row;
    },
    async listMembers(tripId: string) {
      return state.members.flatMap((m) => {
        if (m.tripId !== tripId) return [];
        const user = state.users.find((u) => u.id === m.userId);
        return user ? [{ membership: m, user }] : [];
      });
    },
    async findInviteByToken(token: string) {
      return state.invites.find((i) => i.token === token) ?? null;
    },
    async findInvite(tripId: string, email: string) {
      return (
        state.invites.find((i) => i.tripId === tripId && i.email.toLowerCase() === email.toLowerCase()) ??
        null
      );
    },
    async createInvite(input: { id: string; tripId: string; email: string; token: string }) {
      const row: InviteRow = {
        id: input.id,
        tripId: input.tripId,
        email: input.email,
        token: input.token,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      state.invites.push(row);
      return row;
    },
    async updateInviteStatus(id: string, status: 'pending' | 'accepted' | 'declined') {
      const row = state.invites.find((i) => i.id === id);
      if (!row) throw new Error(`no invite with id ${id}`);
      row.status = status;
      row.updatedAt = now;
      return row;
    },
    async listPendingInvites(tripId: string) {
      return state.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
  };

  return { repo: repo as unknown as TripsRepository, state };
}

/** A repo with a seeded owner user and one already-created trip. */
async function setup() {
  const { repo, state } = fakeRepo();
  state.users.push(userRow(OWNER.id, OWNER.email, 'Ada'));
  const service = new TripsService(repo);
  const trip = await service.create(OWNER, TRIP_DTO);
  return { repo, state, service, trip };
}

describe('TripsService', () => {
  describe('create', () => {
    it('creates the trip and adds the creator as the owner member', async () => {
      const { repo, state } = fakeRepo();
      state.users.push(userRow(OWNER.id, OWNER.email, 'Ada'));
      const service = new TripsService(repo);

      const trip = await service.create(OWNER, TRIP_DTO);

      expect(trip.name).toBe(TRIP_DTO.name);
      expect(trip.destination).toBe(TRIP_DTO.destination);
      expect(trip.startDate).toBe('2024-09-01');
      expect(trip.endDate).toBe('2024-09-08');
      expect(typeof trip.createdAt).toBe('string');
      expect(trip.pendingInvites).toEqual([]);
      expect(trip.members).toEqual([
        {
          userId: OWNER.id,
          email: OWNER.email,
          displayName: 'Ada',
          role: 'owner',
          joinedAt: now.toISOString(),
        },
      ]);
    });
  });

  describe('getById', () => {
    it('returns the trip with its members and pending invites to a member', async () => {
      const { service, trip } = await setup();
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });

      const view = await service.getById(trip.id, OWNER);

      expect(view.name).toBe(TRIP_DTO.name);
      expect(view.members).toEqual([
        {
          userId: OWNER.id,
          email: OWNER.email,
          displayName: 'Ada',
          role: 'owner',
          joinedAt: now.toISOString(),
        },
      ]);
      expect(view.pendingInvites).toEqual([
        {
          id: invite.id,
          email: GUEST.email,
          token: invite.token,
          status: 'pending',
          createdAt: invite.createdAt,
        },
      ]);
    });

    it('forbids a non-member from viewing the trip', async () => {
      const { service, trip } = await setup();
      await expect(service.getById(trip.id, GUEST)).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('raises not_found for an unknown trip id', async () => {
      const { service } = await setup();
      await expect(service.getById('nope', OWNER)).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('invite', () => {
    it('creates a pending invite with a token', async () => {
      const { service, trip } = await setup();

      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });

      expect(invite.email).toBe(GUEST.email);
      expect(invite.status).toBe('pending');
      expect(invite.token).toBeTruthy();
      expect(typeof invite.createdAt).toBe('string');
    });

    it('returns the existing pending invite when inviting the same email twice', async () => {
      const { service, state, trip } = await setup();

      const first = await service.invite(OWNER, trip.id, { email: GUEST.email });
      const second = await service.invite(OWNER, trip.id, { email: GUEST.email });

      expect(second.id).toBe(first.id);
      expect(second.token).toBe(first.token);
      expect(second.status).toBe('pending');
      expect(state.invites).toHaveLength(1);
    });

    it('forbids a member who is not the owner from inviting', async () => {
      const { state, service, trip } = await setup();
      state.users.push(userRow(GUEST.id, GUEST.email, 'Grace'));
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });
      await service.accept(GUEST, invite.token);

      await expect(service.invite(GUEST, trip.id, { email: 'new@example.com' })).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('raises not_found when inviting on an unknown trip', async () => {
      const { service } = await setup();
      await expect(service.invite(OWNER, 'nope', { email: GUEST.email })).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('conflicts when the email is already a member of the trip', async () => {
      const { state, service, trip } = await setup();
      state.users.push(userRow(GUEST.id, GUEST.email, 'Grace'));
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });
      await service.accept(GUEST, invite.token);

      await expect(service.invite(OWNER, trip.id, { email: GUEST.email })).rejects.toMatchObject({
        code: 'conflict',
      });
    });

    it('reissues a declined invite as pending on the same row', async () => {
      const { state, service, trip } = await setup();
      const first = await service.invite(OWNER, trip.id, { email: GUEST.email });
      state.invites[0].status = 'declined';

      const second = await service.invite(OWNER, trip.id, { email: GUEST.email });

      expect(second.id).toBe(first.id);
      expect(second.token).toBe(first.token);
      expect(second.status).toBe('pending');
      expect(state.invites).toHaveLength(1);
    });
  });

  describe('accept', () => {
    it('adds the accepting user as a member and marks the invite accepted', async () => {
      const { state, service, trip } = await setup();
      state.users.push(userRow(GUEST.id, GUEST.email, 'Grace'));
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });

      const membership = await service.accept(GUEST, invite.token);

      expect(membership).toEqual({
        tripId: trip.id,
        userId: GUEST.id,
        role: 'member',
        joinedAt: now.toISOString(),
      });
      expect(state.invites[0].status).toBe('accepted');

      // the new member can now see the trip
      const view = await service.getById(trip.id, GUEST);
      expect(view.members.map((m) => m.userId)).toContain(GUEST.id);
    });

    it('accepting twice is a no-op returning the same membership', async () => {
      const { state, service, trip } = await setup();
      state.users.push(userRow(GUEST.id, GUEST.email, 'Grace'));
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });

      const first = await service.accept(GUEST, invite.token);
      const second = await service.accept(GUEST, invite.token);

      expect(second).toEqual(first);
      expect(state.members.filter((m) => m.tripId === trip.id && m.userId === GUEST.id)).toHaveLength(1);
    });

    it('forbids accepting with an email that does not match the invite', async () => {
      const { state, service, trip } = await setup();
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });

      await expect(service.accept(OWNER, invite.token)).rejects.toMatchObject({ code: 'forbidden' });
      expect(state.members).toHaveLength(1);
      expect(state.invites[0].status).toBe('pending');
    });

    it('raises not_found for an unknown token', async () => {
      const { service } = await setup();
      await expect(service.accept(GUEST, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('conflicts when accepting a declined invite', async () => {
      const { state, service, trip } = await setup();
      state.users.push(userRow(GUEST.id, GUEST.email, 'Grace'));
      const invite = await service.invite(OWNER, trip.id, { email: GUEST.email });
      state.invites[0].status = 'declined';

      await expect(service.accept(GUEST, invite.token)).rejects.toMatchObject({ code: 'conflict' });
      expect(state.members).toHaveLength(1);
    });
  });
});
