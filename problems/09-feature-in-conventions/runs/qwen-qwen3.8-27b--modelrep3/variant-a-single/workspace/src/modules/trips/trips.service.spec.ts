import { describe, expect, it } from 'vitest';
import type { CurrentUserPayload } from '../../auth/types.js';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

/**
 * The repository is faked at its interface. Services are tested against a fake
 * repository, never against a mocked Drizzle -- one spec per module, named
 * `<name>.service.spec.ts`.
 */
const NOW = new Date('2024-06-01T00:00:00Z');
const NOW_ISO = NOW.toISOString();

interface FakeState {
  trips: TripRow[];
  members: TripMemberRow[];
  invites: TripInviteRow[];
}

function fakeRepo(seed: Partial<FakeState> = {}) {
  const state: FakeState = {
    trips: [...(seed.trips ?? [])],
    members: [...(seed.members ?? [])],
    invites: [...(seed.invites ?? [])],
  };
  const repo = {
    async insertTrip(row: NewTripRow): Promise<TripRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      state.trips.push(created);
      return created;
    },
    async findById(id: string): Promise<TripRow | null> {
      return state.trips.find((t) => t.id === id) ?? null;
    },
    async insertMember(row: NewTripMemberRow): Promise<TripMemberRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripMemberRow;
      state.members.push(created);
      return created;
    },
    async findMember(tripId: string, userId: string): Promise<TripMemberRow | null> {
      return state.members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async findMembers(tripId: string): Promise<TripMemberRow[]> {
      return state.members.filter((m) => m.tripId === tripId);
    },
    async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      state.invites.push(created);
      return created;
    },
    async findInviteByToken(token: string): Promise<TripInviteRow | null> {
      return state.invites.find((i) => i.token === token) ?? null;
    },
    async findPendingInvite(tripId: string, email: string): Promise<TripInviteRow | null> {
      return (
        state.invites.find(
          (i) => i.tripId === tripId && i.email === email && i.status === 'pending',
        ) ?? null
      );
    },
    async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
      return state.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async updateInviteStatus(id: string, status: string): Promise<void> {
      const invite = state.invites.find((i) => i.id === id);
      if (invite) {
        invite.status = status;
        invite.updatedAt = NOW;
      }
    },
  } as unknown as TripsRepository;
  return { repo, state };
}

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Lisbon Weekend',
    destination: 'Lisbon, PT',
    startDate: new Date('2024-06-01T00:00:00Z'),
    endDate: new Date('2024-06-10T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripRow;

const memberRow = (over: Partial<TripMemberRow> = {}): TripMemberRow =>
  ({
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    role: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripMemberRow;

const inviteRow = (over: Partial<TripInviteRow> = {}): TripInviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'bob@example.com',
    token: 'tok-1',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripInviteRow;

const ada: CurrentUserPayload = { id: 'u1', email: 'ada@example.com' };
const bob: CurrentUserPayload = { id: 'u2', email: 'bob@example.com' };
const stranger: CurrentUserPayload = { id: 'u9', email: 'stranger@example.com' };

describe('TripsService', () => {
  describe('createTrip', () => {
    it('creates the trip and records the creator as the owner member', async () => {
      const { repo } = fakeRepo();
      const svc = new TripsService(repo);
      const trip = await svc.createTrip(
        {
          name: 'Lisbon Weekend',
          destination: 'Lisbon, PT',
          startDate: new Date('2024-06-01T00:00:00Z'),
          endDate: new Date('2024-06-10T00:00:00Z'),
        },
        ada,
      );

      expect(trip.name).toBe('Lisbon Weekend');
      expect(trip.destination).toBe('Lisbon, PT');
      expect(trip.startDate).toBe('2024-06-01T00:00:00.000Z');
      expect(trip.endDate).toBe('2024-06-10T00:00:00.000Z');
      expect(trip.members).toEqual([{ userId: 'u1', role: 'owner', joinedAt: NOW_ISO }]);
      expect(trip.pendingInvites).toEqual([]);
    });
  });

  describe('invite', () => {
    it('creates a pending invite with a token when the owner invites', async () => {
      const { repo } = fakeRepo({ trips: [tripRow()], members: [memberRow()] });
      const svc = new TripsService(repo);
      const invite = await svc.invite('t1', { email: 'Bob@Example.com' }, ada);

      expect(invite.tripId).toBe('t1');
      expect(invite.email).toBe('bob@example.com');
      expect(invite.status).toBe('pending');
      expect(typeof invite.token).toBe('string');
      expect(invite.token.length).toBeGreaterThan(0);
    });

    it('returns the existing pending invite when the same email is invited again', async () => {
      const { repo, state } = fakeRepo({ trips: [tripRow()], members: [memberRow()] });
      const svc = new TripsService(repo);
      const first = await svc.invite('t1', { email: 'bob@example.com' }, ada);
      const second = await svc.invite('t1', { email: 'bob@example.com' }, ada);

      expect(second.id).toBe(first.id);
      expect(second.token).toBe(first.token);
      expect(second.status).toBe('pending');
      expect(state.invites).toHaveLength(1);
    });

    it('rejects with not_found when the trip does not exist', async () => {
      const { repo } = fakeRepo();
      const svc = new TripsService(repo);
      await expect(svc.invite('nope', { email: 'bob@example.com' }, ada)).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('rejects with forbidden when the caller is not a member', async () => {
      const { repo } = fakeRepo({ trips: [tripRow()], members: [memberRow()] });
      const svc = new TripsService(repo);
      await expect(svc.invite('t1', { email: 'stranger@example.com' }, stranger)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('rejects with forbidden when the caller is a member but not the owner', async () => {
      const { repo } = fakeRepo({
        trips: [tripRow()],
        members: [memberRow(), memberRow({ id: 'm2', userId: 'u2', role: 'member' })],
      });
      const svc = new TripsService(repo);
      await expect(svc.invite('t1', { email: 'bob@example.com' }, bob)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });
  });

  describe('acceptInvite', () => {
    it('adds the invited user as a member and marks the invite accepted', async () => {
      const { repo, state } = fakeRepo({ trips: [tripRow()], invites: [inviteRow()] });
      const svc = new TripsService(repo);
      const membership = await svc.acceptInvite('tok-1', bob);

      expect(membership.tripId).toBe('t1');
      expect(membership.userId).toBe('u2');
      expect(membership.role).toBe('member');
      expect(membership.joinedAt).toBe(NOW_ISO);
      expect(state.invites[0].status).toBe('accepted');
      expect(state.members).toHaveLength(1);
    });

    it('accepting twice is a no-op returning the same membership', async () => {
      const { repo, state } = fakeRepo({ trips: [tripRow()], invites: [inviteRow()] });
      const svc = new TripsService(repo);
      const first = await svc.acceptInvite('tok-1', bob);
      const second = await svc.acceptInvite('tok-1', bob);

      expect(second.id).toBe(first.id);
      expect(second.role).toBe('member');
      expect(state.members).toHaveLength(1);
      expect(state.invites[0].status).toBe('accepted');
    });

    it('rejects with not_found for an unknown token', async () => {
      const { repo } = fakeRepo({ trips: [tripRow()] });
      const svc = new TripsService(repo);
      await expect(svc.acceptInvite('missing', bob)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('rejects with forbidden when the accepting user is not the invited email', async () => {
      const { repo, state } = fakeRepo({ trips: [tripRow()], invites: [inviteRow()] });
      const svc = new TripsService(repo);
      await expect(svc.acceptInvite('tok-1', ada)).rejects.toMatchObject({ code: 'forbidden' });
      expect(state.members).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('returns the trip with its members and only pending invites to a member', async () => {
      const { repo } = fakeRepo({
        trips: [tripRow()],
        members: [memberRow(), memberRow({ id: 'm2', userId: 'u2', role: 'member' })],
        invites: [
          inviteRow(),
          inviteRow({ id: 'i2', email: 'carol@example.com', token: 'tok-2', status: 'accepted' }),
        ],
      });
      const svc = new TripsService(repo);
      const trip = await svc.getById('t1', ada);

      expect(trip.name).toBe('Lisbon Weekend');
      expect(trip.destination).toBe('Lisbon, PT');
      expect(trip.members).toHaveLength(2);
      expect(trip.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
      expect(trip.pendingInvites).toEqual([
        { id: 'i1', email: 'bob@example.com', status: 'pending', createdAt: NOW_ISO },
      ]);
    });

    it('rejects with not_found when the trip does not exist', async () => {
      const { repo } = fakeRepo({ members: [memberRow()] });
      const svc = new TripsService(repo);
      await expect(svc.getById('nope', ada)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('rejects with forbidden when the caller is not a member', async () => {
      const { repo } = fakeRepo({ trips: [tripRow()], members: [memberRow()] });
      const svc = new TripsService(repo);
      await expect(svc.getById('t1', stranger)).rejects.toMatchObject({ code: 'forbidden' });
    });
  });
});
