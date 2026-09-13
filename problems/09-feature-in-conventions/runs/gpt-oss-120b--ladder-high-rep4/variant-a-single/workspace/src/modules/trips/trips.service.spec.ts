import { describe, expect, it } from 'vitest';
import type {
  NewInviteRow,
  InviteRow,
  NewTripMemberRow,
  TripMemberRow,
  NewTripRow,
  TripRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

/**
 * Fake repository implementing the TripsRepository interface.
 */
function fakeRepo(
  trips: TripRow[] = [],
  members: TripMemberRow[] = [],
  invites: InviteRow[] = [],
): TripsRepository {
  return {
    async createTrip(row: NewTripRow) {
      const created: TripRow = {
        ...row,
        startDate: row.startDate instanceof Date ? row.startDate : new Date(row.startDate),
        endDate: row.endDate instanceof Date ? row.endDate : new Date(row.endDate),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripRow;
      trips.push(created);
      return created;
    },

    async findTripById(id: string) {
      return trips.find((t) => t.id === id) ?? null;
    },

    async addMember(row: NewTripMemberRow) {
      const existing = members.find((m) => m.tripId === row.tripId && m.userId === row.userId);
      if (existing) {
        return existing as TripMemberRow;
      }
      const created: TripMemberRow = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripMemberRow;
      members.push(created);
      return created;
    },

    async findMemberByTripAndUser(tripId: string, userId: string) {
      return members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },

    async findMembersByTrip(tripId: string) {
      return members.filter((m) => m.tripId === tripId);
    },

    async findPendingInviteByTripAndEmail(tripId: string, email: string) {
      return (
        invites.find(
          (i) => i.tripId === tripId && i.email === email && i.status === 'pending',
        ) ?? null
      );
    },

    async findInviteByTripAndEmail(tripId: string, email: string) {
      return invites.find((i) => i.tripId === tripId && i.email === email) ?? null;
    },

    async findInviteByToken(token: string) {
      return invites.find((i) => i.token === token) ?? null;
    },

    async createInvite(row: NewInviteRow) {
      const created: InviteRow = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as InviteRow;
      invites.push(created);
      return created;
    },

    async updateInviteStatus(id: string, status: InviteRow['status']) {
      const invite = invites.find((i) => i.id === id);
      if (!invite) throw new Error('invite not found');
      (invite as any).status = status;
      return invite as InviteRow;
    },

    async findPendingInvitesByTrip(tripId: string) {
      return invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
  } as unknown as TripsRepository;
}

/* Helper factories */
const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Trip',
    destination: 'Paris',
    startDate: new Date('2024-02-01T00:00:00Z'),
    endDate: new Date('2024-02-07T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  }) as TripRow;

const memberRow = (over: Partial<TripMemberRow> = {}): TripMemberRow =>
  ({
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    role: 'owner',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  }) as TripMemberRow;

const inviteRow = (over: Partial<InviteRow> = {}): InviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'bob@example.com',
    token: 'token-123',
    status: 'pending',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  }) as InviteRow;

describe('TripsService', () => {
  it('creates a trip and adds owner membership', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const trip = await svc.create(
      {
        name: 'Trip to Paris',
        destination: 'Paris',
        startDate: '2024-02-01T00:00:00Z',
        endDate: '2024-02-07T00:00:00Z',
      },
      'u1',
    );
    expect(trip.name).toBe('Trip to Paris');
    const owner = await repo.findMemberByTripAndUser(trip.id, 'u1');
    expect(owner).not.toBeNull();
    expect(owner?.role).toBe('owner');
  });

  it('owner invites a user and returns pending invite', async () => {
    const repo = fakeRepo([tripRow()], [memberRow()], []);
    const svc = new TripsService(repo);
    const invite = await svc.invite('t1', 'bob@example.com', 'u1');
    expect(invite.email).toBe('bob@example.com');
    expect(invite.status).toBe('pending');
  });

  it('inviting same email twice returns existing pending invite', async () => {
    const repo = fakeRepo([tripRow()], [memberRow()], []);
    const svc = new TripsService(repo);
    const invite1 = await svc.invite('t1', 'bob@example.com', 'u1');
    const invite2 = await svc.invite('t1', 'bob@example.com', 'u1');
    expect(invite1.id).toBe(invite2.id);
  });

  it('accepting invite adds membership; second accept returns same membership', async () => {
    const repo = fakeRepo([tripRow()], [memberRow()], [inviteRow()]);
    const svc = new TripsService(repo);
    const member1 = await svc.acceptInvite('token-123', 'u2', 'bob@example.com');
    expect(member1.userId).toBe('u2');
    expect(member1.role).toBe('member');

    const member2 = await svc.acceptInvite('token-123', 'u2', 'bob@example.com');
    expect(member2.id).toBe(member1.id);
  });

  it('non-member cannot view trip details', async () => {
    const repo = fakeRepo([tripRow()], [memberRow()], []);
    const svc = new TripsService(repo);
    await expect(svc.getDetails('t1', 'u2')).rejects.toThrow(AppError);
  });
});
