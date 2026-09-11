import { describe, expect, it } from 'vitest';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { TripsService } from './trips.service.js';
import { TripsRepository, type TripMemberWithUser } from './trips.repository.js';

/**
 * The repository is faked at its interface, with the same state semantics the
 * unique (trip, user) constraint gives in Postgres: one membership per pair,
 * ever.
 */

const NOW = new Date('2024-01-01T00:00:00Z');

interface FakeState {
  trips: TripRow[];
  memberships: TripMemberRow[];
  invites: TripInviteRow[];
  users: Array<{ id: string; email: string }>;
}

function fakeRepo(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    trips: initial.trips ?? [],
    memberships: initial.memberships ?? [],
    invites: initial.invites ?? [],
    users: initial.users ?? [],
  };

  const repo = {
    async createTrip(row: NewTripRow): Promise<TripRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      state.trips.push(created);
      return created;
    },
    async findTripById(id: string): Promise<TripRow | null> {
      return state.trips.find((t) => t.id === id) ?? null;
    },
    async findMembership(tripId: string, userId: string): Promise<TripMemberRow | null> {
      return state.memberships.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async insertMembershipIfAbsent(row: NewTripMemberRow): Promise<TripMemberRow> {
      const existing = state.memberships.find((m) => m.tripId === row.tripId && m.userId === row.userId);
      if (existing) return existing;
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripMemberRow;
      state.memberships.push(created);
      return created;
    },
    async findMembers(tripId: string): Promise<TripMemberWithUser[]> {
      return state.memberships
        .filter((m) => m.tripId === tripId)
        .map((m) => ({
          id: m.id,
          tripId: m.tripId,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
          email: state.users.find((u) => u.id === m.userId)?.email ?? 'unknown@example.com',
        }));
    },
    async createInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      state.invites.push(created);
      return created;
    },
    async findInviteByToken(token: string): Promise<TripInviteRow | null> {
      return state.invites.find((i) => i.token === token) ?? null;
    },
    async findPendingInviteByEmail(tripId: string, email: string): Promise<TripInviteRow | null> {
      return (
        state.invites.find((i) => i.tripId === tripId && i.email === email && i.status === 'pending') ??
        null
      );
    },
    async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
      return state.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async markInviteAccepted(id: string): Promise<void> {
      const invite = state.invites.find((i) => i.id === id);
      if (invite) invite.status = 'accepted';
    },
  };

  return { repo: repo as unknown as TripsRepository, state };
}

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Lisbon in June',
    destination: 'Lisbon',
    startsAt: new Date('2024-06-10T00:00:00Z'),
    endsAt: new Date('2024-06-14T00:00:00Z'),
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
    email: 'grace@example.com',
    token: 'tok-1',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripInviteRow;

const ada: CurrentUserPayload = { id: 'u1', email: 'ada@example.com' };
const grace: CurrentUserPayload = { id: 'u2', email: 'grace@example.com' };

const newTrip = {
  name: 'Lisbon in June',
  destination: 'Lisbon',
  startsAt: new Date('2024-06-10T00:00:00Z'),
  endsAt: new Date('2024-06-14T00:00:00Z'),
};

describe('TripsService.create', () => {
  it('creates the trip and makes the creator the owner member', async () => {
    const { repo, state } = fakeRepo();
    const svc = new TripsService(repo);

    const trip = await svc.create(newTrip, ada);

    expect(trip.name).toBe('Lisbon in June');
    expect(trip.destination).toBe('Lisbon');
    expect(typeof trip.id).toBe('string');
    expect(trip.startsAt).toBe('2024-06-10T00:00:00.000Z');
    expect(trip.endsAt).toBe('2024-06-14T00:00:00.000Z');
    expect(typeof trip.createdAt).toBe('string');

    expect(state.trips).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({ tripId: trip.id, userId: ada.id, role: 'owner' });
  });
});

describe('TripsService.invite', () => {
  const ownerState = (): Partial<FakeState> => ({
    trips: [tripRow()],
    memberships: [memberRow({ tripId: 't1', userId: 'u1', role: 'owner' })],
    users: [{ id: 'u1', email: 'ada@example.com' }],
  });

  it('creates a pending invite carrying a token when the owner invites by email', async () => {
    const { repo, state } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    const invite = await svc.invite('t1', { email: 'grace@example.com' }, ada);

    expect(invite.email).toBe('grace@example.com');
    expect(invite.status).toBe('pending');
    expect(invite.token).toBeTruthy();
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0].tripId).toBe('t1');
  });

  it('returns the existing pending invite when the same email is invited twice', async () => {
    const { repo, state } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    const first = await svc.invite('t1', { email: 'grace@example.com' }, ada);
    const second = await svc.invite('t1', { email: 'grace@example.com' }, ada);

    expect(second.id).toBe(first.id);
    expect(second.token).toBe(first.token);
    expect(second.status).toBe('pending');
    expect(state.invites).toHaveLength(1);
  });

  it('creates a separate invite for a different email', async () => {
    const { repo, state } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    const first = await svc.invite('t1', { email: 'grace@example.com' }, ada);
    const second = await svc.invite('t1', { email: 'lin@example.com' }, ada);

    expect(second.id).not.toBe(first.id);
    expect(second.email).toBe('lin@example.com');
    expect(state.invites).toHaveLength(2);
  });

  it('rejects a non-owner with forbidden and creates no invite', async () => {
    const { repo, state } = fakeRepo({
      ...ownerState(),
      memberships: [memberRow({ tripId: 't1', userId: 'u2', role: 'member' })],
      users: [
        { id: 'u1', email: 'ada@example.com' },
        { id: 'u2', email: 'grace@example.com' },
      ],
    });
    const svc = new TripsService(repo);

    await expect(svc.invite('t1', { email: 'ada@example.com' }, grace)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(state.invites).toHaveLength(0);
  });

  it('raises not_found for an unknown trip', async () => {
    const { repo } = fakeRepo(ownerState());
    const svc = new TripsService(repo);

    await expect(svc.invite('nope', { email: 'grace@example.com' }, ada)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('TripsService.accept', () => {
  const invitedState = (): Partial<FakeState> => ({
    trips: [tripRow()],
    memberships: [memberRow({ id: 'm1', tripId: 't1', userId: 'u1', role: 'owner' })],
    invites: [inviteRow({ tripId: 't1', email: 'grace@example.com', token: 'tok-1', status: 'pending' })],
    users: [
      { id: 'u1', email: 'ada@example.com' },
      { id: 'u2', email: 'grace@example.com' },
    ],
  });

  it('adds the invitee as a member and marks the invite accepted', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    const membership = await svc.accept('tok-1', grace);

    expect(membership.tripId).toBe('t1');
    expect(membership.userId).toBe('u2');
    expect(membership.email).toBe('grace@example.com');
    expect(membership.role).toBe('member');
    expect(state.invites[0].status).toBe('accepted');
    expect(state.memberships.filter((m) => m.userId === 'u2')).toHaveLength(1);

    const detail = await svc.getById('t1', grace);
    expect(detail.members.some((m) => m.userId === 'u2' && m.role === 'member')).toBe(true);
    expect(detail.pendingInvites).toHaveLength(0);
  });

  it('treats a second accept of the same token as a no-op returning the same membership', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    const first = await svc.accept('tok-1', grace);
    const second = await svc.accept('tok-1', grace);

    expect(second.id).toBe(first.id);
    expect(second.userId).toBe('u2');
    expect(second.role).toBe('member');
    expect(state.memberships.filter((m) => m.userId === 'u2')).toHaveLength(1);
    expect(state.invites).toHaveLength(1);
  });

  it('raises not_found for an unknown token', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    await expect(svc.accept('nope', grace)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.memberships).toHaveLength(1);
    expect(state.invites[0].status).toBe('pending');
  });

  it('rejects a user the invite is not addressed to with forbidden', async () => {
    const { repo, state } = fakeRepo(invitedState());
    const svc = new TripsService(repo);

    await expect(svc.accept('tok-1', ada)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.memberships.filter((m) => m.userId === 'u1' && m.role === 'member')).toHaveLength(0);
    expect(state.invites[0].status).toBe('pending');
  });
});

describe('TripsService.get', () => {
  const fullState = (): Partial<FakeState> => ({
    trips: [tripRow()],
    memberships: [
      memberRow({ id: 'm1', tripId: 't1', userId: 'u1', role: 'owner' }),
      memberRow({ id: 'm2', tripId: 't1', userId: 'u2', role: 'member' }),
    ],
    invites: [
      inviteRow({ id: 'i1', tripId: 't1', email: 'grace@example.com', token: 'tok-1', status: 'accepted' }),
      inviteRow({ id: 'i2', tripId: 't1', email: 'lin@example.com', token: 'tok-2', status: 'pending' }),
    ],
    users: [
      { id: 'u1', email: 'ada@example.com' },
      { id: 'u2', email: 'grace@example.com' },
    ],
  });

  it('returns the trip with its members and pending invites to a member', async () => {
    const { repo } = fakeRepo(fullState());
    const svc = new TripsService(repo);

    const detail = await svc.getById('t1', ada);

    expect(detail.id).toBe('t1');
    expect(detail.name).toBe('Lisbon in June');
    expect(detail.members).toHaveLength(2);
    expect(detail.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
    expect(detail.members.find((m) => m.userId === 'u1')?.email).toBe('ada@example.com');
    expect(detail.members.find((m) => m.userId === 'u2')?.email).toBe('grace@example.com');
    expect(detail.pendingInvites).toHaveLength(1);
    expect(detail.pendingInvites[0]).toMatchObject({ email: 'lin@example.com', status: 'pending' });
    // Invite tokens never leak through the trip view.
    expect(JSON.stringify(detail)).not.toContain('tok-');
  });

  it('answers a non-member with not_found, exactly as for a missing trip', async () => {
    const { repo } = fakeRepo(fullState());
    const svc = new TripsService(repo);
    const stranger: CurrentUserPayload = { id: 'u9', email: 'stranger@example.com' };

    await expect(svc.getById('t1', stranger)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.getById('does-not-exist', stranger)).rejects.toMatchObject({ code: 'not_found' });
  });
});
