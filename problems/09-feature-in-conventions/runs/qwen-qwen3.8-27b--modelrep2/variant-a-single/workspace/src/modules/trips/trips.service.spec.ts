import { describe, expect, it } from 'vitest';
import { AppError, type AppErrorCode } from '../../common/app-error.js';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripMemberRow,
  TripRow,
  UserRow,
} from '../../../drizzle/schema.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

/**
 * The repository is faked at its interface. Services are tested against a fake
 * repository, never against a mocked Drizzle -- one spec per module, named
 * `<name>.service.spec.ts`.
 */

const NOW = new Date('2024-01-01T00:00:00Z');

const ownerCaller = { id: 'u-owner', email: 'owner@example.com' };
const adaCaller = { id: 'u-ada', email: 'ada@example.com' };
const eveCaller = { id: 'u-eve', email: 'eve@example.com' };
const ghostCaller = { id: 'u-ghost', email: 'ghost@example.com' };

const createTripDto = {
  name: 'Lisbon weekend',
  destination: 'Lisbon, Portugal',
  startsAt: new Date('2024-06-01T00:00:00Z'),
  endsAt: new Date('2024-06-03T00:00:00Z'),
};

const userRow = (over: Partial<UserRow> = {}): UserRow =>
  ({
    id: 'u-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as UserRow;

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Lisbon weekend',
    destination: 'Lisbon, Portugal',
    startsAt: new Date('2024-06-01T00:00:00Z'),
    endsAt: new Date('2024-06-03T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripRow;

const memberRow = (over: Partial<TripMemberRow> = {}): TripMemberRow =>
  ({
    id: 'm-owner',
    tripId: 't1',
    userId: 'u-owner',
    role: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripMemberRow;

const inviteRow = (over: Partial<TripInviteRow> = {}): TripInviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'ada@example.com',
    token: 'tok-ada',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripInviteRow;

function fakeRepo(seed: {
  users?: UserRow[];
  trips?: TripRow[];
  members?: TripMemberRow[];
  invites?: TripInviteRow[];
} = {}) {
  const state = {
    users: seed.users ?? [],
    trips: seed.trips ?? [],
    members: seed.members ?? [],
    invites: seed.invites ?? [],
  };

  const repo = {
    async findUserRow(id: string) {
      return state.users.find((u) => u.id === id) ?? null;
    },
    async insertTrip(row: NewTripRow): Promise<TripRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      state.trips.push(created);
      return created;
    },
    async findById(id: string) {
      return state.trips.find((t) => t.id === id) ?? null;
    },
    async insertMember(row: NewTripMemberRow): Promise<TripMemberRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripMemberRow;
      state.members.push(created);
      return created;
    },
    async findMember(tripId: string, userId: string) {
      return state.members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async findMembersWithUsers(tripId: string) {
      return state.members
        .filter((m) => m.tripId === tripId)
        .map((m) => ({ member: m, user: state.users.find((u) => u.id === m.userId)! }));
    },
    async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      state.invites.push(created);
      return created;
    },
    async findPendingInvite(tripId: string, email: string) {
      return state.invites.find((i) => i.tripId === tripId && i.email === email && i.status === 'pending') ?? null;
    },
    async findInviteByToken(token: string) {
      return state.invites.find((i) => i.token === token) ?? null;
    },
    async markInviteAccepted(id: string) {
      const invite = state.invites.find((i) => i.id === id);
      if (invite) invite.status = 'accepted';
    },
    async findPendingInvites(tripId: string) {
      return state.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
  };

  return { repo: repo as unknown as TripsRepository, state };
}

async function expectCode(promise: Promise<unknown>, code: AppErrorCode): Promise<void> {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe('TripsService', () => {
  describe('createTrip', () => {
    it('creates the trip and adds the creator as the owner member', async () => {
      const { repo } = fakeRepo({ users: [userRow()] });
      const service = new TripsService(repo);

      const trip = await service.createTrip(createTripDto, ownerCaller);

      expect(trip).toMatchObject({
        name: 'Lisbon weekend',
        destination: 'Lisbon, Portugal',
        startsAt: '2024-06-01T00:00:00.000Z',
        endsAt: '2024-06-03T00:00:00.000Z',
      });
      expect(trip.members).toHaveLength(1);
      expect(trip.members[0]).toMatchObject({ userId: 'u-owner', role: 'owner', email: 'owner@example.com' });
      expect(trip.pendingInvites).toEqual([]);
    });

    it('does not create anything when the creator has no user row', async () => {
      const { repo, state } = fakeRepo();
      const service = new TripsService(repo);

      await expectCode(service.createTrip(createTripDto, ghostCaller), 'not_found');
      expect(state.trips).toEqual([]);
      expect(state.members).toEqual([]);
    });
  });

  describe('createInvite', () => {
    const seeded = () =>
      fakeRepo({
        users: [userRow(), userRow({ id: 'u-ada', email: 'ada@example.com', displayName: 'Ada' })],
        trips: [tripRow()],
        members: [memberRow()],
      });

    it('lets the owner invite a new email and returns a pending invite with a token', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      const invite = await service.createInvite('t1', { email: 'ada@example.com' }, ownerCaller);

      expect(invite).toMatchObject({ email: 'ada@example.com', status: 'pending' });
      expect(invite.token).toMatch(/^[0-9a-f]{48}$/);
      expect(state.invites).toHaveLength(1);
    });

    it('returns the existing pending invite when the same email is invited twice', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      const first = await service.createInvite('t1', { email: 'ada@example.com' }, ownerCaller);
      const second = await service.createInvite('t1', { email: 'ada@example.com' }, ownerCaller);

      expect(second).toEqual(first);
      expect(state.invites).toHaveLength(1);
      expect(state.invites[0].token).toBe(first.token);
    });

    it('forbids anyone but the owner from inviting', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);
      state.members.push(memberRow({ id: 'm-ada', userId: 'u-ada', role: 'member' }));

      await expectCode(service.createInvite('t1', { email: 'eve@example.com' }, adaCaller), 'forbidden');
      expect(state.invites).toEqual([]);
    });

    it('raises not_found for an unknown trip', async () => {
      const { repo } = seeded();
      const service = new TripsService(repo);

      await expectCode(service.createInvite('nope', { email: 'ada@example.com' }, ownerCaller), 'not_found');
    });
  });

  describe('acceptInvite', () => {
    const seeded = () =>
      fakeRepo({
        users: [
          userRow(),
          userRow({ id: 'u-ada', email: 'ada@example.com', displayName: 'Ada' }),
          userRow({ id: 'u-eve', email: 'eve@example.com', displayName: 'Eve' }),
        ],
        trips: [tripRow()],
        members: [memberRow()],
        invites: [inviteRow()],
      });

    it('adds the caller as a member and marks the invite accepted', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      const membership = await service.acceptInvite('tok-ada', adaCaller);

      expect(membership).toMatchObject({ userId: 'u-ada', role: 'member', email: 'ada@example.com' });
      expect(state.invites[0].status).toBe('accepted');
      expect(state.members).toHaveLength(2);
    });

    it('treats a second accept as a no-op returning the same membership', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      const first = await service.acceptInvite('tok-ada', adaCaller);
      const second = await service.acceptInvite('tok-ada', adaCaller);

      expect(second).toEqual(first);
      expect(state.members).toHaveLength(2);
      expect(state.invites).toHaveLength(1);
    });

    it('raises not_found for an unknown token', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      await expectCode(service.acceptInvite('nope', adaCaller), 'not_found');
      expect(state.invites[0].status).toBe('pending');
    });

    it('refuses another user once the invite has been taken', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      await service.acceptInvite('tok-ada', adaCaller);
      await expectCode(service.acceptInvite('tok-ada', eveCaller), 'conflict');
      expect(state.members).toHaveLength(2);
      expect(state.members.find((m) => m.userId === 'u-eve')).toBeUndefined();
    });

    it('does nothing for a caller without a user row', async () => {
      const { repo, state } = seeded();
      const service = new TripsService(repo);

      await expectCode(service.acceptInvite('tok-ada', ghostCaller), 'not_found');
      expect(state.members).toHaveLength(1);
      expect(state.invites[0].status).toBe('pending');
    });
  });

  describe('getTrip', () => {
    it('returns the trip with its members and only pending invites', async () => {
      const { repo } = fakeRepo({
        users: [userRow(), userRow({ id: 'u-ada', email: 'ada@example.com', displayName: 'Ada' })],
        trips: [tripRow()],
        members: [memberRow(), memberRow({ id: 'm-ada', userId: 'u-ada', role: 'member' })],
        invites: [
          inviteRow({ id: 'i1', email: 'ada@example.com', token: 'tok-ada', status: 'accepted' }),
          inviteRow({ id: 'i2', email: 'eve@example.com', token: 'tok-eve', status: 'pending' }),
        ],
      });
      const service = new TripsService(repo);

      const trip = await service.getTrip('t1', adaCaller);

      expect(trip).toMatchObject({ id: 't1', name: 'Lisbon weekend' });
      expect(trip.members).toHaveLength(2);
      expect(trip.members).toContainEqual(expect.objectContaining({ userId: 'u-owner', role: 'owner' }));
      expect(trip.members).toContainEqual(
        expect.objectContaining({ userId: 'u-ada', role: 'member', displayName: 'Ada' }),
      );
      expect(trip.pendingInvites).toEqual([expect.objectContaining({ email: 'eve@example.com', status: 'pending' })]);
    });

    it('raises not_found for an unknown trip', async () => {
      const { repo } = fakeRepo({ users: [userRow()] });
      const service = new TripsService(repo);

      await expectCode(service.getTrip('nope', ownerCaller), 'not_found');
    });

    it('forbids a non-member from viewing the trip', async () => {
      const { repo } = fakeRepo({
        users: [userRow(), userRow({ id: 'u-ada', email: 'ada@example.com', displayName: 'Ada' })],
        trips: [tripRow()],
        members: [memberRow()],
      });
      const service = new TripsService(repo);

      await expectCode(service.getTrip('t1', adaCaller), 'forbidden');
    });
  });
});
