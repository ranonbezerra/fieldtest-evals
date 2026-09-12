import { describe, expect, it } from 'vitest';
import type {
  TripRow,
  TripMemberRow,
  TripInviteRow,
  NewTripRow,
  NewTripMemberRow,
  NewTripInviteRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';

function fakeRepo(): TripsRepository {
  const trips: TripRow[] = [];
  const members: TripMemberRow[] = [];
  const invites: TripInviteRow[] = [];

  return {
    async insertTrip(row: NewTripRow) {
      const created = {
        ...row,
        startDate: new Date(row.startDate),
        endDate: new Date(row.endDate),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripRow;
      trips.push(created);
      return created;
    },
    async findTripById(id: string) {
      return trips.find((t) => t.id === id) ?? null;
    },
    async insertMember(row: NewTripMemberRow) {
      const existing = members.find((m) => m.tripId === row.tripId && m.userId === row.userId);
      if (existing) return existing;
      const created = {
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
    async findMembers(tripId: string) {
      return members.filter((m) => m.tripId === tripId);
    },
    async findInviteByToken(token: string) {
      return invites.find((i) => i.token === token) ?? null;
    },
    async findPendingInvite(tripId: string, email: string) {
      return (
        invites.find(
          (i) => i.tripId === tripId && i.email === email && i.status === 'pending',
        ) ?? null
      );
    },
    async insertInvite(row: NewTripInviteRow) {
      const created = {
        ...row,
        status: 'pending',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripInviteRow;
      invites.push(created);
      return created;
    },
    async updateInviteStatus(id: string, status: 'pending' | 'accepted' | 'declined') {
      const invite = invites.find((i) => i.id === id);
      if (!invite) throw new Error('invite not found');
      invite.status = status;
      invite.updatedAt = new Date('2024-01-02T00:00:00Z');
      return invite;
    },
    async findPendingInvites(tripId: string) {
      return invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
  } as unknown as TripsRepository;
}

describe('TripsService', () => {
  it('creates a trip and owner becomes member', async () => {
    const svc = new TripsService(fakeRepo());
    const dto: CreateTripDto = {
      name: 'Beach Vacation',
      destination: 'Hawaii',
      startDate: '2024-06-01',
      endDate: '2024-06-10',
    };
    const trip = await svc.create(dto, 'user-1');
    expect(trip.name).toBe('Beach Vacation');
    expect(trip.members).toHaveLength(1);
    expect(trip.members[0].role).toBe('owner');
    expect(trip.members[0].userId).toBe('user-1');
  });

  it('inviting same email twice returns existing pending invite', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const dto: CreateTripDto = {
      name: 'Trip',
      destination: 'Paris',
      startDate: '2024-07-01',
      endDate: '2024-07-05',
    };
    const trip = await svc.create(dto, 'owner-id');
    const invite1 = await svc.invite(trip.id, 'bob@example.com', 'owner-id');
    const invite2 = await svc.invite(trip.id, 'bob@example.com', 'owner-id');
    expect(invite1.id).toBe(invite2.id);
    expect(invite1.status).toBe('pending');
  });

  it('accepting same token twice returns same membership', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const dto: CreateTripDto = {
      name: 'Trip',
      destination: 'Rome',
      startDate: '2024-08-01',
      endDate: '2024-08-07',
    };
    const trip = await svc.create(dto, 'owner-id');
    const invite = await svc.invite(trip.id, 'alice@example.com', 'owner-id');
    const member1 = await svc.acceptInvite(invite.token, 'alice-id');
    const member2 = await svc.acceptInvite(invite.token, 'alice-id');
    expect(member1.id).toBe(member2.id);
    expect(member1.role).toBe('member');
  });

  it('non‑member cannot fetch trip (not found)', async () => {
    const repo = fakeRepo();
    const svc = new TripsService(repo);
    const dto: CreateTripDto = {
      name: 'Secret',
      destination: 'Island',
      startDate: '2024-09-01',
      endDate: '2024-09-03',
    };
    const trip = await svc.create(dto, 'owner-id');
    await expect(svc.getTrip(trip.id, 'random-user')).rejects.toThrow(AppError);
  });
});
