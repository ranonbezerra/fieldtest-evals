import { describe, expect, it } from 'vitest';
import type {
  TripRow,
  NewTripRow,
  TripMemberRow,
  NewTripMemberRow,
  InviteRow,
  NewInviteRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import { randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';

/**
 * Fake repository that keeps in‑memory arrays.
 */
function fakeRepo(
  trips: TripRow[] = [],
  members: TripMemberRow[] = [],
  invites: InviteRow[] = [],
): TripsRepository & { trips: TripRow[]; members: TripMemberRow[]; invites: InviteRow[] } {
  return {
    // Trips
    async insertTrip(row: NewTripRow) {
      const created: TripRow = {
        ...row,
        startDate: row.startDate,
        endDate: row.endDate,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripRow;
      trips.push(created);
      return created;
    },
    async findTripById(id: string) {
      return trips.find((t) => t.id === id) ?? null;
    },

    // Members
    async insertMember(row: NewTripMemberRow) {
      const created: TripMemberRow = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripMemberRow;
      members.push(created);
      return created;
    },
    async findMember(tripId: string, userId: string) {
      return members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async findMembersByTripId(tripId: string) {
      return members.filter((m) => m.tripId === tripId);
    },

    // Invites
    async insertInvite(row: NewInviteRow) {
      const created: InviteRow = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as InviteRow;
      invites.push(created);
      return created;
    },
    async findPendingInvite(tripId: string, email: string) {
      return (
        invites.find((i) => i.tripId === tripId && i.email === email && i.status === 'pending') ?? null
      );
    },
    async findInviteByToken(token: string) {
      return invites.find((i) => i.token === token) ?? null;
    },
    async findPendingInvitesByTripId(tripId: string) {
      return invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
    async updateInviteStatus(id: string, status: string) {
      const inv = invites.find((i) => i.id === id);
      if (!inv) throw new Error('invite not found');
      inv.status = status as any;
      return inv as InviteRow;
    },

    // expose arrays for assertions
    trips,
    members,
    invites,
  } as unknown as TripsRepository & { trips: TripRow[]; members: TripMemberRow[]; invites: InviteRow[] };
}

const owner: CurrentUserPayload = { id: 'u1', email: 'owner@example.com' };
const memberUser: CurrentUserPayload = { id: 'u2', email: 'member@example.com' };
const otherUser: CurrentUserPayload = { id: 'u3', email: 'other@example.com' };

describe('TripsService', () => {
  it('creates a trip and adds the owner member', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const trip = await svc.create(
      {
        name: 'Adventure',
        destination: 'Mars',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-10T00:00:00Z',
      },
      owner,
    );
    expect(trip.name).toBe('Adventure');
    expect(repo.members).toHaveLength(1);
    expect(repo.members[0].userId).toBe(owner.id);
    expect(repo.members[0].role).toBe('owner');
  });

  it('owner can invite and duplicate pending invites return the same record', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const trip = await svc.create(
      {
        name: 'Beach',
        destination: 'Hawaii',
        startDate: '2025-06-01T00:00:00Z',
        endDate: '2025-06-07T00:00:00Z',
      },
      owner,
    );
    const invite1 = await svc.invite(trip.id, 'bob@example.com', owner);
    const invite2 = await svc.invite(trip.id, 'bob@example.com', owner);
    expect(invite1.id).toBe(invite2.id);
    expect(repo.invites).toHaveLength(1);
  });

  it('non‑owner cannot invite', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const trip = await svc.create(
      {
        name: 'Ski',
        destination: 'Alps',
        startDate: '2025-12-01T00:00:00Z',
        endDate: '2025-12-07T00:00:00Z',
      },
      owner,
    );

    // add a regular member
    await repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: memberUser.id,
      role: 'member',
    });

    await expect(svc.invite(trip.id, 'charlie@example.com', memberUser)).rejects.toThrow(AppError);
  });

  it('accepting an invite creates membership and is idempotent', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const trip = await svc.create(
      {
        name: 'Roadtrip',
        destination: 'Route 66',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-15T00:00:00Z',
      },
      owner,
    );

    const invite = await svc.invite(trip.id, 'bob@example.com', owner);
    const bob: CurrentUserPayload = { id: 'u2', email: 'bob@example.com' };

    const member1 = await svc.acceptInvite(invite.token, bob);
    expect(member1.role).toBe('member');
    expect(repo.members).toHaveLength(2); // owner + bob

    const member2 = await svc.acceptInvite(invite.token, bob);
    expect(member2.id).toBe(member1.id);
    expect(repo.members).toHaveLength(2); // still only one bob membership
  });

  it('member can retrieve trip details, non‑member gets not_found', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const trip = await svc.create(
      {
        name: 'Cruise',
        destination: 'Caribbean',
        startDate: '2025-07-01T00:00:00Z',
        endDate: '2025-07-10T00:00:00Z',
      },
      owner,
    );

    const invite = await svc.invite(trip.id, 'bob@example.com', owner);
    const bob: CurrentUserPayload = { id: 'u2', email: 'bob@example.com' };
    await svc.acceptInvite(invite.token, bob);

    const detail = await svc.getTrip(trip.id, bob);
    expect(detail.members).toHaveLength(2);
    const emails = detail.members.map((m) => m.userId);
    expect(emails).toContain(owner.id);
    expect(emails).toContain(bob.id);
    expect(detail.pendingInvites).toHaveLength(0);

    await expect(svc.getTrip(trip.id, otherUser)).rejects.toThrow(AppError);
  });
});
