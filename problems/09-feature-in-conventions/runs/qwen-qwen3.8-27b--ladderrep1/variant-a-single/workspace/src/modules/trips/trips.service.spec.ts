import { describe, expect, it } from 'vitest';
import type { CurrentUserPayload } from '../../auth/types.js';
import {
  type NewTripInviteRow,
  type NewTripMemberRow,
  type NewTripRow,
  type TripInviteRow,
  type TripMemberRow,
  type TripRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { createTripSchema } from './dto/create-trip.dto.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

/**
 * The repository is faked at its interface: an in-memory store that honours
 * the (trip, user) uniqueness the real table enforces.
 */
interface FakeDb {
  trips: TripRow[];
  members: TripMemberRow[];
  invites: TripInviteRow[];
}

const NOW = new Date('2024-01-01T00:00:00Z');

function fakeDb(): FakeDb {
  return { trips: [], members: [], invites: [] };
}

function fakeRepo(db: FakeDb): TripsRepository {
  const createMember = (row: NewTripMemberRow): Promise<TripMemberRow> => {
    if (db.members.some((m) => m.tripId === row.tripId && m.userId === row.userId)) {
      const err = new Error('duplicate key value violates unique constraint');
      (err as { code?: string }).code = '23505';
      return Promise.reject(err);
    }
    const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripMemberRow;
    db.members.push(created);
    return Promise.resolve(created);
  };

  return {
    async createTrip(row: NewTripRow) {
      const created = { ...row, createdAt: NOW, updatedAt: NOW } as TripRow;
      db.trips.push(created);
      return created;
    },
    async findTripById(id: string) {
      return db.trips.find((t) => t.id === id) ?? null;
    },
    createMember,
    async upsertMember(tripId: string, userId: string, role: NewTripMemberRow['role']) {
      const existing = db.members.find((m) => m.tripId === tripId && m.userId === userId);
      if (existing) return existing;
      return createMember({ tripId, userId, role });
    },
    async findMember(tripId: string, userId: string) {
      return db.members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async listMembers(tripId: string) {
      return db.members.filter((m) => m.tripId === tripId);
    },
    async createInvite(row: NewTripInviteRow) {
      const created = { ...row, status: 'pending', createdAt: NOW, updatedAt: NOW } as TripInviteRow;
      db.invites.push(created);
      return created;
    },
    async findInviteByToken(token: string) {
      return db.invites.find((i) => i.token === token) ?? null;
    },
    async findPendingInvite(tripId: string, email: string) {
      return (
        db.invites.find(
          (i) => i.tripId === tripId && i.email === email && i.status === 'pending',
        ) ?? null
      );
    },
    async listPendingInvites(tripId: string) {
      return db.invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async markInviteAccepted(id: string) {
      const invite = db.invites.find((i) => i.id === id);
      if (invite) {
        invite.status = 'accepted';
        invite.updatedAt = NOW;
      }
    },
  } as unknown as TripsRepository;
}

const trip = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Summer trip',
    destination: 'Lisbon',
    startsAt: new Date('2024-06-01T00:00:00Z'),
    endsAt: new Date('2024-06-10T00:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripRow;

const member = (over: Partial<TripMemberRow> = {}): TripMemberRow =>
  ({
    tripId: 't1',
    userId: 'u1',
    role: 'owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripMemberRow;

const invite = (over: Partial<TripInviteRow> = {}): TripInviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'ada@example.com',
    token: 'tok-1',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as TripInviteRow;

const owner: CurrentUserPayload = { id: 'u1', email: 'owner@example.com' };
const outsider: CurrentUserPayload = { id: 'u9', email: 'outsider@example.com' };
const invitee: CurrentUserPayload = { id: 'u2', email: 'ada@example.com' };

const createDto = {
  name: 'Summer trip',
  destination: 'Lisbon',
  startsAt: '2024-06-01T00:00:00Z',
  endsAt: '2024-06-10T00:00:00Z',
};

describe('TripsService', () => {
  it('creates a trip and makes the creator an owner member', async () => {
    const db = fakeDb();
    const svc = new TripsService(fakeRepo(db));

    const created = await svc.createTrip(createDto, owner);

    expect(created.name).toBe('Summer trip');
    expect(created.destination).toBe('Lisbon');
    expect(created.startsAt).toBe('2024-06-01T00:00:00.000Z');
    expect(created.endsAt).toBe('2024-06-10T00:00:00.000Z');
    expect(db.members).toHaveLength(1);
    expect(db.members[0]).toMatchObject({ tripId: created.id, userId: owner.id, role: 'owner' });
  });

  it('lets the creator read back the trip as an owner with no invites', async () => {
    const db = fakeDb();
    const svc = new TripsService(fakeRepo(db));

    const created = await svc.createTrip(createDto, owner);
    const fetched = await svc.getTrip(created.id, owner);

    expect(fetched.id).toBe(created.id);
    expect(fetched.members).toEqual([expect.objectContaining({ userId: owner.id, role: 'owner' })]);
    expect(fetched.invites).toEqual([]);
  });

  it('returns a trip with its members and only its pending invites', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member(), member({ userId: 'u2', role: 'member' }));
    db.invites.push(
      invite(),
      invite({ id: 'i2', email: 'bob@example.com', token: 'tok-2', status: 'accepted' }),
    );
    const svc = new TripsService(fakeRepo(db));

    const fetched = await svc.getTrip('t1', owner);

    expect(fetched.members).toHaveLength(2);
    expect(fetched.invites).toHaveLength(1);
    expect(fetched.invites[0]).toMatchObject({ email: 'ada@example.com', status: 'pending' });
  });

  it('answers a non-member with the same not-found as a missing trip', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    const svc = new TripsService(fakeRepo(db));

    const asOutsider = await svc.getTrip('t1', outsider).then(
      () => null,
      (err: unknown) => err,
    );
    const asMissing = await svc.getTrip('no-such-trip', owner).then(
      () => null,
      (err: unknown) => err,
    );

    expect(asOutsider).toBeInstanceOf(AppError);
    expect((asOutsider as AppError).code).toBe('not_found');
    expect((asOutsider as AppError).message).toBe((asMissing as AppError).message);
  });

  it('lets the owner invite by email and returns a pending invite with a token', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    const svc = new TripsService(fakeRepo(db));

    const created = await svc.invite('t1', { email: 'ada@example.com' }, owner);

    expect(created.email).toBe('ada@example.com');
    expect(created.status).toBe('pending');
    expect(created.token).toBeTruthy();
    expect(db.invites).toHaveLength(1);
  });

  it('returns the existing pending invite instead of creating a second one', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    db.invites.push(invite());
    const svc = new TripsService(fakeRepo(db));

    const again = await svc.invite('t1', { email: 'ada@example.com' }, owner);

    expect(again.id).toBe('i1');
    expect(db.invites).toHaveLength(1);
  });

  it('re-invites an email whose earlier invite was already accepted', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    db.invites.push(invite({ status: 'accepted' }));
    const svc = new TripsService(fakeRepo(db));

    const created = await svc.invite('t1', { email: 'ada@example.com' }, owner);

    expect(created.id).not.toBe('i1');
    expect(created.status).toBe('pending');
    expect(db.invites).toHaveLength(2);
  });

  it('rejects an invite from a non-owner member with forbidden', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member({ userId: 'u2', role: 'member' }));
    const svc = new TripsService(fakeRepo(db));

    await expect(svc.invite('t1', { email: 'ada@example.com' }, invitee)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(db.invites).toHaveLength(0);
  });

  it('rejects an invite from a non-member with not-found', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    const svc = new TripsService(fakeRepo(db));

    await expect(svc.invite('t1', { email: 'ada@example.com' }, outsider)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('adds the invitee as a member and marks the invite accepted', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    db.invites.push(invite());
    const svc = new TripsService(fakeRepo(db));

    const joined = await svc.acceptInvite('tok-1', invitee);

    expect(joined).toMatchObject({ userId: invitee.id, role: 'member' });
    expect(db.members.filter((m) => m.userId === invitee.id)).toHaveLength(1);
    expect(db.invites[0].status).toBe('accepted');
  });

  it('makes accepting the same token twice a no-op that returns the membership', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    db.invites.push(invite());
    const svc = new TripsService(fakeRepo(db));

    const first = await svc.acceptInvite('tok-1', invitee);
    const second = await svc.acceptInvite('tok-1', invitee);

    expect(second).toMatchObject(first);
    expect(db.members.filter((m) => m.userId === invitee.id)).toHaveLength(1);
  });

  it('answers an unknown token with not-found', async () => {
    const svc = new TripsService(fakeRepo(fakeDb()));

    await expect(svc.acceptInvite('nope', invitee)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects acceptance by an email the invite was not sent to', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    db.invites.push(invite());
    const svc = new TripsService(fakeRepo(db));

    await expect(
      svc.acceptInvite('tok-1', { id: 'u3', email: 'eve@example.com' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(db.members).toHaveLength(1);
  });

  it('rejects acceptance of a declined invite with conflict', async () => {
    const db = fakeDb();
    db.trips.push(trip());
    db.members.push(member());
    db.invites.push(invite({ status: 'declined' }));
    const svc = new TripsService(fakeRepo(db));

    await expect(svc.acceptInvite('tok-1', invitee)).rejects.toMatchObject({ code: 'conflict' });
    expect(db.members).toHaveLength(1);
  });
});

describe('createTripSchema', () => {
  it('accepts a valid trip payload', () => {
    const parsed = createTripSchema.safeParse(createDto);
    expect(parsed.success).toBe(true);
  });

  it('rejects a date range that ends before it starts', () => {
    const parsed = createTripSchema.safeParse({
      ...createDto,
      startsAt: '2024-06-10T00:00:00Z',
      endsAt: '2024-06-01T00:00:00Z',
    });
    expect(parsed.success).toBe(false);
  });
});
