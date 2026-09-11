import { describe, expect, it } from 'vitest';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripRow,
} from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { MemberRow, TripsRepository } from './trips.repository.js';
import { TripsService } from './trips.service.js';

const NOW = new Date('2024-06-01T00:00:00Z');

const U1: CurrentUserPayload = { id: 'u1', email: 'ada@example.com' };
const U2: CurrentUserPayload = { id: 'u2', email: 'grace@example.com' };
const U3: CurrentUserPayload = { id: 'u3', email: 'linus@example.com' };

const USERS: Record<string, { email: string; displayName: string }> = {
  u1: { email: 'ada@example.com', displayName: 'Ada' },
  u2: { email: 'grace@example.com', displayName: 'Grace' },
  u3: { email: 'linus@example.com', displayName: 'Linus' },
};

const validCreate = {
  name: 'Siesta Key',
  destination: 'Florida, US',
  startsAt: new Date('2024-07-01T00:00:00Z'),
  endsAt: new Date('2024-07-08T00:00:00Z'),
};

function tripRow(over: Partial<TripRow> = {}): TripRow {
  return {
    id: 't1',
    name: 'Siesta Key',
    destination: 'Florida, US',
    startsAt: new Date('2024-07-01T00:00:00Z'),
    endsAt: new Date('2024-07-08T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as TripRow;
}

function memberRow(over: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    role: 'owner',
    createdAt: NOW,
    ...over,
  } as MemberRow;
}

function inviteRow(over: Partial<TripInviteRow> = {}): TripInviteRow {
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

interface FakeState {
  trips?: TripRow[];
  members?: MemberRow[];
  invites?: TripInviteRow[];
  users?: Record<string, { email: string; displayName: string }>;
}

/**
 * The repository is faked at its interface, never a mocked Drizzle. State
 * lives in plain arrays so assertions can observe what the service did.
 */
function fakeRepo(state: FakeState = {}): TripsRepository {
  const trips = [...(state.trips ?? [])];
  const members = [...(state.members ?? [])];
  const invites = [...(state.invites ?? [])];
  const users = { ...(state.users ?? {}) };

  return {
    async findTripById(id: string) {
      return trips.find((t) => t.id === id) ?? null;
    },
    async insertTrip(row: NewTripRow) {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      trips.push(created);
      return created;
    },
    async insertMember(row: NewTripMemberRow) {
      const user = users[row.userId] ?? { email: 'unknown@example.com', displayName: 'Unknown' };
      const joined: MemberRow = {
        ...row,
        email: user.email,
        displayName: user.displayName,
        createdAt: NOW,
      };
      members.push(joined);
      return joined;
    },
    async findMembership(tripId: string, userId: string) {
      return members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async findMembers(tripId: string) {
      return members.filter((m) => m.tripId === tripId);
    },
    async findPendingInvite(tripId: string, email: string) {
      return (
        invites.find((i) => i.tripId === tripId && i.email === email && i.status === 'pending') ??
        null
      );
    },
    async findPendingInvites(tripId: string) {
      return invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async findInviteByToken(token: string) {
      return invites.find((i) => i.token === token) ?? null;
    },
    async insertInvite(row: NewTripInviteRow) {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      invites.push(created);
      return created;
    },
    async markInviteAccepted(id: string) {
      const invite = invites.find((i) => i.id === id);
      if (invite) {
        invite.status = 'accepted';
        invite.updatedAt = NOW;
      }
    },
  } as unknown as TripsRepository;
}

describe('TripsService', () => {
  describe('create', () => {
    it('creates the trip and records the creator as owner', async () => {
      const svc = new TripsService(fakeRepo({ users: USERS }));
      const trip = await svc.create(validCreate, U1);

      expect(trip.name).toBe('Siesta Key');
      expect(trip.destination).toBe('Florida, US');
      expect(trip.startsAt).toBe('2024-07-01T00:00:00.000Z');
      expect(trip.endsAt).toBe('2024-07-08T00:00:00.000Z');
      expect(typeof trip.createdAt).toBe('string');

      const detail = await svc.get(trip.id, U1);
      expect(detail.members).toHaveLength(1);
      expect(detail.members[0]).toMatchObject({ userId: 'u1', role: 'owner', email: 'ada@example.com' });
    });

    it('rejects a date range that does not run forward', async () => {
      const svc = new TripsService(fakeRepo({ users: USERS }));
      await expect(
        svc.create(
          { ...validCreate, startsAt: new Date('2024-07-08T00:00:00Z'), endsAt: new Date('2024-07-01T00:00:00Z') },
          U1,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });
  });

  describe('invite', () => {
    const seedOwner = () =>
      fakeRepo({
        trips: [tripRow()],
        members: [
          memberRow(),
          memberRow({
            id: 'm2',
            userId: 'u2',
            email: 'grace@example.com',
            displayName: 'Grace',
            role: 'member',
          }),
        ],
        users: USERS,
      });

    it('creates a pending invite carrying a token', async () => {
      const svc = new TripsService(seedOwner());
      const invite = await svc.invite('t1', { email: 'linus@example.com' }, U1);
      expect(invite.email).toBe('linus@example.com');
      expect(invite.status).toBe('pending');
      expect(invite.token).toBeTruthy();
    });

    it('returns the existing pending invite when the same email is invited twice', async () => {
      const svc = new TripsService(seedOwner());
      const first = await svc.invite('t1', { email: 'linus@example.com' }, U1);
      const second = await svc.invite('t1', { email: 'linus@example.com' }, U1);
      expect(second.id).toBe(first.id);
      expect(second.token).toBe(first.token);
      expect(second.status).toBe('pending');
    });

    it('creates a fresh invite when the earlier one is no longer pending', async () => {
      const svc = new TripsService(
        fakeRepo({
          trips: [tripRow()],
          members: [memberRow()],
          invites: [inviteRow({ status: 'declined' })],
          users: USERS,
        }),
      );
      const invite = await svc.invite('t1', { email: 'grace@example.com' }, U1);
      expect(invite.id).not.toBe('i1');
      expect(invite.status).toBe('pending');
    });

    it('forbids a member who is not the owner from inviting', async () => {
      const svc = new TripsService(seedOwner());
      await expect(svc.invite('t1', { email: 'linus@example.com' }, U2)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('raises not_found for an unknown trip', async () => {
      const svc = new TripsService(seedOwner());
      await expect(svc.invite('nope', { email: 'linus@example.com' }, U1)).rejects.toMatchObject({
        code: 'not_found',
      });
    });
  });

  describe('acceptInvite', () => {
    const seedPending = () =>
      fakeRepo({ trips: [tripRow()], members: [memberRow()], invites: [inviteRow()], users: USERS });

    it('adds the invited user as a member and clears the pending invite', async () => {
      const svc = new TripsService(seedPending());
      const member = await svc.acceptInvite('tok-1', U2);

      expect(member).toMatchObject({ userId: 'u2', role: 'member', email: 'grace@example.com' });
      const detail = await svc.get('t1', U2);
      expect(detail.members).toHaveLength(2);
      expect(detail.invites).toHaveLength(0);
    });

    it('accepting the same token twice is a no-op returning the same membership', async () => {
      const svc = new TripsService(seedPending());
      const first = await svc.acceptInvite('tok-1', U2);
      const second = await svc.acceptInvite('tok-1', U2);
      expect(second.id).toBe(first.id);
      const detail = await svc.get('t1', U2);
      expect(detail.members.filter((m) => m.userId === 'u2')).toHaveLength(1);
    });

    it('raises not_found for an unknown token', async () => {
      const svc = new TripsService(seedPending());
      await expect(svc.acceptInvite('nope', U2)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('forbids a user the invite was not sent to', async () => {
      const svc = new TripsService(seedPending());
      await expect(svc.acceptInvite('tok-1', U3)).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('rejects accepting a declined invite with a conflict', async () => {
      const svc = new TripsService(
        fakeRepo({
          trips: [tripRow()],
          members: [memberRow()],
          invites: [inviteRow({ status: 'declined' })],
          users: USERS,
        }),
      );
      await expect(svc.acceptInvite('tok-1', U2)).rejects.toMatchObject({ code: 'conflict' });
    });
  });

  describe('get', () => {
    it('returns the trip with its members and pending invites to a member', async () => {
      const svc = new TripsService(
        fakeRepo({
          trips: [tripRow()],
          members: [
            memberRow(),
            memberRow({
              id: 'm2',
              userId: 'u2',
              email: 'grace@example.com',
              displayName: 'Grace',
              role: 'member',
            }),
          ],
          invites: [inviteRow(), inviteRow({ id: 'i2', token: 'tok-2', status: 'accepted' })],
          users: USERS,
        }),
      );
      const detail = await svc.get('t1', U1);

      expect(detail.trip).toMatchObject({ id: 't1', name: 'Siesta Key', destination: 'Florida, US' });
      expect(detail.members).toHaveLength(2);
      expect(detail.invites).toHaveLength(1);
      expect(detail.invites[0]).toMatchObject({ email: 'grace@example.com', status: 'pending' });
    });

    it('gives a non-member the same not-found a missing trip gets', async () => {
      const svc = new TripsService(
        fakeRepo({ trips: [tripRow()], members: [memberRow()], users: USERS }),
      );
      const missing = await svc.get('missing', U3).catch((e: unknown) => e);
      const nonMember = await svc.get('t1', U3).catch((e: unknown) => e);
      expect(nonMember).toMatchObject({ code: 'not_found', message: 'trip not found' });
      expect(missing).toMatchObject({ code: 'not_found', message: 'trip not found' });
    });
  });
});
