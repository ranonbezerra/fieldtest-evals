import { describe, expect, it } from 'vitest';
import type {
  InviteRow,
  NewInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

function fakeRepo(opts: {
  trips?: TripRow[];
  members?: TripMemberRow[];
  invites?: InviteRow[];
} = {}): TripsRepository {
  const trips = [...(opts.trips ?? [])];
  const members = [...(opts.members ?? [])];
  const invites = [...(opts.invites ?? [])];

  return {
    async insertTrip(row: NewTripRow) {
      const created = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripRow;
      trips.push(created);
      return created;
    },
    async findTripById(id: string) {
      return trips.find((r) => r.id === id) ?? null;
    },
    async findMembersByTripId(tripId: string) {
      return members.filter((r) => r.tripId === tripId);
    },
    async findMember(tripId: string, userId: string) {
      return members.find((r) => r.tripId === tripId && r.userId === userId) ?? null;
    },
    async insertMember(row: NewTripMemberRow) {
      const created = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as TripMemberRow;
      members.push(created);
      return created;
    },
    async insertInvite(row: NewInviteRow) {
      const created = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as InviteRow;
      invites.push(created);
      return created;
    },
    async findPendingInvite(tripId: string, email: string) {
      return (
        invites.find(
          (r) => r.tripId === tripId && r.email === email && r.status === 'pending',
        ) ?? null
      );
    },
    async findPendingInvitesByTripId(tripId: string) {
      return invites.filter((r) => r.tripId === tripId && r.status === 'pending');
    },
    async findInviteByToken(token: string) {
      return invites.find((r) => r.token === token) ?? null;
    },
    async updateInviteStatus(id: string, status: InviteRow['status']) {
      const idx = invites.findIndex((r) => r.id === id);
      if (idx === -1) throw AppError.notFound('invite not found', { id });
      invites[idx] = { ...invites[idx], status };
      return invites[idx];
    },
  } as unknown as TripsRepository;
}

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Berlin Trip',
    destination: 'Berlin',
    startsAt: new Date('2025-06-01T00:00:00Z'),
    endsAt: new Date('2025-06-07T00:00:00Z'),
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
    email: 'ada@example.com',
    token: 'tok1',
    status: 'pending',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  }) as InviteRow;

describe('TripsService', () => {
  it('creates a trip and the creator becomes an owner member', async () => {
    const svc = new TripsService(fakeRepo());
    const trip = await svc.create(
      { name: 'Berlin', destination: 'Berlin', startsAt: '2025-06-01T00:00:00Z', endsAt: '2025-06-07T00:00:00Z' },
      'creator1',
    );
    expect(trip.name).toBe('Berlin');
    expect(trip.destination).toBe('Berlin');
  });

  it('returns trip detail with members and pending invites for a member', async () => {
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ userId: 'u1' }), memberRow({ id: 'm2', userId: 'u2', role: 'member' })],
      invites: [inviteRow()],
    });
    const svc = new TripsService(repo);
    const detail = await svc.getById('t1', 'u1');
    expect(detail.name).toBe('Berlin Trip');
    expect(detail.members.length).toBe(2);
    expect(detail.pendingInvites.length).toBe(1);
    expect(detail.pendingInvites[0].email).toBe('ada@example.com');
  });

  it('raises not_found for a nonexistent trip', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.getById('nope', 'u1')).rejects.toThrow(AppError);
  });

  it('raises not_found for a non-member viewing a trip', async () => {
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ userId: 'u2' })],
    });
    const svc = new TripsService(repo);
    await expect(svc.getById('t1', 'u1')).rejects.toThrow(AppError);
  });

  it('owner can invite by email and gets back an invite', async () => {
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ userId: 'u1', role: 'owner' })],
    });
    const svc = new TripsService(repo);
    const invite = await svc.invite('t1', 'u1', 'new@example.com');
    expect(invite.email).toBe('new@example.com');
    expect(invite.status).toBe('pending');
  });

  it('inviting the same email twice returns the existing pending invite', async () => {
    const existing = inviteRow();
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ userId: 'u1', role: 'owner' })],
      invites: [existing],
    });
    const svc = new TripsService(repo);
    const first = await svc.invite('t1', 'u1', 'ada@example.com');
    const second = await svc.invite('t1', 'u1', 'ada@example.com');
    expect(first.id).toBe(second.id);
    expect(first.id).toBe(existing.id);
  });

  it('non-owner inviting receives forbidden', async () => {
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ userId: 'u1', role: 'member' })],
    });
    const svc = new TripsService(repo);
    await expect(svc.invite('t1', 'u1', 'test@test.com')).rejects.toThrow(AppError);
  });

  it('accepting an invite adds the user as a member', async () => {
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ userId: 'owner1', role: 'owner' })],
      invites: [inviteRow({ tripId: 't1', email: 'joiner@example.com', token: 'tok1' })],
    });
    const svc = new TripsService(repo);
    const member = await svc.acceptInvite('tok1', 'joiner1');
    expect(member.role).toBe('member');
    expect(member.userId).toBe('joiner1');
  });

  it('accepting the same token twice returns the same membership (no-op)', async () => {
    const repo = fakeRepo({
      trips: [tripRow()],
      members: [memberRow({ id: 'm-existing', userId: 'joiner1', role: 'member', tripId: 't1' })],
      invites: [inviteRow({ tripId: 't1', email: 'joiner@example.com', token: 'tok1', status: 'accepted' })],
    });
    const svc = new TripsService(repo);
    const first = await svc.acceptInvite('tok1', 'joiner1');
    const second = await svc.acceptInvite('tok1', 'joiner1');
    expect(first.id).toBe(second.id);
    expect(first.id).toBe('m-existing');
  });

  it('accepting an invalid token raises not_found', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.acceptInvite('bad-token', 'u1')).rejects.toThrow(AppError);
  });

  it('accepting an invite on a nonexistent trip raises not_found', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.acceptInvite('bad-token', 'u1')).rejects.toThrow(AppError);
  });
});
