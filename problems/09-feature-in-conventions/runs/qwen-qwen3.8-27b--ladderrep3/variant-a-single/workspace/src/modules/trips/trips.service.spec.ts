import { describe, expect, it } from 'vitest';
import type {
  NewTripInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripInviteRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository, TripMembershipRow } from './trips.repository.js';

/**
 * The repository is faked at its interface. Services are tested against a fake
 * repository, never against a mocked Drizzle -- one spec per module, named
 * `<name>.service.spec.ts`.
 */

const NOW = new Date('2024-01-01T00:00:00Z');

const CREATOR = { id: 'u1', email: 'ada@example.com' };
const ALAN = { id: 'u2', email: 'alan@example.com' };
const GRACE = { id: 'u3', email: 'grace@example.com' };

interface FakeDb {
  trips: TripRow[];
  members: TripMembershipRow[];
  invites: TripInviteRow[];
  users: { id: string; email: string; displayName: string }[];
}

function freshDb(): FakeDb {
  return {
    trips: [],
    members: [],
    invites: [],
    users: [
      { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
      { id: 'u2', email: 'alan@example.com', displayName: 'Alan' },
      { id: 'u3', email: 'grace@example.com', displayName: 'Grace' },
    ],
  };
}

function makeRepo(db: FakeDb): TripsRepository {
  return {
    async createTrip(row: NewTripRow): Promise<TripRow> {
      const created: TripRow = { ...row, createdAt: NOW, updatedAt: NOW };
      db.trips.push(created);
      return created;
    },
    async findTripById(id: string): Promise<TripRow | null> {
      return db.trips.find((t) => t.id === id) ?? null;
    },
    async findMembers(tripId: string): Promise<TripMembershipRow[]> {
      return db.members.filter((m) => m.tripId === tripId);
    },
    async findMember(tripId: string, userId: string): Promise<TripMembershipRow | null> {
      return db.members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async insertMember(row: NewTripMemberRow): Promise<TripMemberRow | null> {
      if (db.members.some((m) => m.tripId === row.tripId && m.userId === row.userId)) {
        return null;
      }
      const user = db.users.find((u) => u.id === row.userId);
      const created: TripMemberRow = { ...row, createdAt: NOW, updatedAt: NOW };
      db.members.push({
        ...created,
        email: user?.email ?? 'unknown@example.com',
        displayName: user?.displayName ?? 'Unknown',
      });
      return created;
    },
    async findPendingInviteByEmail(tripId: string, email: string): Promise<TripInviteRow | null> {
      return db.invites.find((i) => i.tripId === tripId && i.email === email && i.status === 'pending') ?? null;
    },
    async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
      return db.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async findInviteByToken(token: string): Promise<TripInviteRow | null> {
      return db.invites.find((i) => i.token === token) ?? null;
    },
    async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
      const created: TripInviteRow = { ...row, status: 'pending', createdAt: NOW, updatedAt: NOW };
      db.invites.push(created);
      return created;
    },
    async markInviteStatus(id: string, status: TripInviteRow['status']): Promise<void> {
      const invite = db.invites.find((i) => i.id === id);
      if (invite) {
        invite.status = status;
        invite.updatedAt = NOW;
      }
    },
  } as unknown as TripsRepository;
}

async function seedTrip(db: FakeDb): Promise<string> {
  const tripId = 't1';
  db.trips.push({
    id: tripId,
    name: 'Lisbon long weekend',
    destination: 'Lisbon, PT',
    startsAt: NOW,
    endsAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.members.push({
    id: 'm1',
    tripId,
    userId: 'u1',
    role: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    email: 'ada@example.com',
    displayName: 'Ada',
  });
  return tripId;
}

function seedInvite(
  db: FakeDb,
  tripId: string,
  email: string,
  token: string,
  status: TripInviteRow['status'] = 'pending',
): void {
  db.invites.push({
    id: `i-${token}`,
    tripId,
    email,
    token,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('TripsService.createTrip', () => {
  it('creates the trip and records the creator as an owner member', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));

    const trip = await svc.createTrip(
      {
        name: 'Lisbon long weekend',
        destination: 'Lisbon, PT',
        startsAt: new Date('2024-06-01T00:00:00Z'),
        endsAt: new Date('2024-06-08T00:00:00Z'),
      },
      CREATOR,
    );

    expect(trip.name).toBe('Lisbon long weekend');
    expect(trip.destination).toBe('Lisbon, PT');
    expect(trip.startsAt).toBe('2024-06-01T00:00:00.000Z');
    expect(trip.endsAt).toBe('2024-06-08T00:00:00.000Z');
    expect(typeof trip.id).toBe('string');
    expect(db.members).toHaveLength(1);
    expect(db.members[0]).toMatchObject({ tripId: trip.id, userId: 'u1', role: 'owner' });
  });
});

describe('TripsService.inviteTrip', () => {
  it('returns the existing pending invite when the same email is invited twice', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);

    const first = await svc.inviteTrip(tripId, { email: ALAN.email }, CREATOR);
    const second = await svc.inviteTrip(tripId, { email: ALAN.email }, CREATOR);

    expect(second.id).toBe(first.id);
    expect(second.token).toBe(first.token);
    expect(second.status).toBe('pending');
    expect(db.invites.filter((i) => i.email === ALAN.email)).toHaveLength(1);
  });

  it('refuses a member who is not the owner without creating an invite', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);
    db.members.push({
      id: 'm2',
      tripId,
      userId: 'u2',
      role: 'member',
      createdAt: NOW,
      updatedAt: NOW,
      email: ALAN.email,
      displayName: 'Alan',
    });

    await expect(svc.inviteTrip(tripId, { email: GRACE.email }, ALAN)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(db.invites).toHaveLength(0);
  });

  it('treats a non-member inviter the same as a missing trip', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);

    await expect(svc.inviteTrip(tripId, { email: GRACE.email }, GRACE)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(svc.inviteTrip('nope', { email: GRACE.email }, CREATOR)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('TripsService.acceptInvite', () => {
  it('adds the accepting user as a member and marks the invite accepted', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);
    seedInvite(db, tripId, ALAN.email, 'tok-alan');

    const member = await svc.acceptInvite('tok-alan', ALAN);

    expect(member).toMatchObject({ tripId, userId: 'u2', role: 'member', email: ALAN.email });
    expect(db.members.filter((m) => m.tripId === tripId)).toHaveLength(2);
    expect(db.invites.find((i) => i.token === 'tok-alan')?.status).toBe('accepted');
  });

  it('accepting the same token twice is a no-op that returns the same membership', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);
    seedInvite(db, tripId, ALAN.email, 'tok-alan');

    const first = await svc.acceptInvite('tok-alan', ALAN);
    const second = await svc.acceptInvite('tok-alan', ALAN);

    expect(second.id).toBe(first.id);
    expect(db.members.filter((m) => m.tripId === tripId && m.userId === 'u2')).toHaveLength(1);
  });

  it('returns the existing membership when the user is already a member', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);
    seedInvite(db, tripId, CREATOR.email, 'tok-creator');

    const member = await svc.acceptInvite('tok-creator', CREATOR);

    expect(member).toMatchObject({ tripId, userId: 'u1', role: 'owner' });
    expect(db.members.filter((m) => m.tripId === tripId && m.userId === 'u1')).toHaveLength(1);
    expect(db.invites.find((i) => i.token === 'tok-creator')?.status).toBe('accepted');
  });

  it('rejects an unknown token with not_found', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));

    await expect(svc.acceptInvite('nope', ALAN)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects accepting a declined invite with conflict', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);
    seedInvite(db, tripId, ALAN.email, 'tok-declined', 'declined');

    await expect(svc.acceptInvite('tok-declined', ALAN)).rejects.toMatchObject({ code: 'conflict' });
    expect(db.members.filter((m) => m.userId === 'u2')).toHaveLength(0);
  });
});

describe('TripsService.getTrip', () => {
  it('returns the trip with its members and pending invites to a member', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);
    db.members.push({
      id: 'm2',
      tripId,
      userId: 'u2',
      role: 'member',
      createdAt: NOW,
      updatedAt: NOW,
      email: ALAN.email,
      displayName: 'Alan',
    });
    seedInvite(db, tripId, GRACE.email, 'tok-grace');
    seedInvite(db, tripId, ALAN.email, 'tok-alan', 'accepted');

    const detail = await svc.getTrip(tripId, CREATOR);

    expect(detail.name).toBe('Lisbon long weekend');
    expect(detail.startsAt).toBe(NOW.toISOString());
    expect(detail.members).toHaveLength(2);
    expect(detail.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
    expect(detail.members.find((m) => m.userId === 'u2')).toMatchObject({
      email: ALAN.email,
      displayName: 'Alan',
    });
    expect(detail.pendingInvites).toHaveLength(1);
    expect(detail.pendingInvites[0]).toMatchObject({ email: GRACE.email, status: 'pending' });
  });

  it('answers a non-member with the same not_found a missing trip gets', async () => {
    const db = freshDb();
    const svc = new TripsService(makeRepo(db));
    const tripId = await seedTrip(db);

    await expect(svc.getTrip(tripId, GRACE)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.getTrip('missing', GRACE)).rejects.toMatchObject({ code: 'not_found' });
  });
});
