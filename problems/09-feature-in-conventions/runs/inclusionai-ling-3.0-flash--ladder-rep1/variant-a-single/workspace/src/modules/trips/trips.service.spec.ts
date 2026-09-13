import { describe, expect, it } from 'vitest';
import type { InviteRow, MemberRow, TripRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';

function now(): Date {
  return new Date('2024-01-01T00:00:00Z');
}

function fakeRepo(
  trips: TripRow[] = [],
  members: MemberRow[] = [],
  invites: InviteRow[] = [],
): TripsRepository {
  return {
    async insertTrip(row: TripRow) {
      const created = { ...row, createdAt: now(), updatedAt: now() } as TripRow;
      trips.push(created);
      return created;
    },
    async findTripById(id: string) {
      return trips.find((r) => r.id === id) ?? null;
    },
    async insertMember(row: MemberRow) {
      const created = { ...row, createdAt: now(), updatedAt: now() } as MemberRow;
      members.push(created);
      return created;
    },
    async findMember(tripId: string, userId: string) {
      return members.find((r) => r.tripId === tripId && r.userId === userId) ?? null;
    },
    async findMembersByTripId(tripId: string) {
      return members.filter((r) => r.tripId === tripId);
    },
    async insertInvite(row: InviteRow) {
      const created = { ...row, createdAt: now(), updatedAt: now() } as InviteRow;
      invites.push(created);
      return created;
    },
    async findPendingInvite(tripId: string, email: string) {
      return invites.find(
        (r) => r.tripId === tripId && r.email === email && r.status === 'pending',
      ) ?? null;
    },
    async findInviteByToken(token: string) {
      return invites.find((r) => r.token === token) ?? null;
    },
    async findPendingInvitesByTripId(tripId: string) {
      return invites.filter((r) => r.tripId === tripId && r.status === 'pending');
    },
    async updateInviteStatus(token: string, status: string) {
      const invite = invites.find((r) => r.token === token);
      if (invite) {
        invite.status = status as InviteRow['status'];
      }
    },
  } as unknown as TripsRepository;
}

const tripRow = (over: Partial<TripRow> = {}): TripRow =>
  ({
    id: 't1',
    name: 'Trip',
    destination: 'Paris',
    startsAt: new Date('2025-06-01T00:00:00Z'),
    endsAt: new Date('2025-06-10T00:00:00Z'),
    createdAt: now(),
    updatedAt: now(),
    ...over,
  }) as TripRow;

const memberRow = (over: Partial<MemberRow> = {}): MemberRow =>
  ({
    id: 'm1',
    tripId: 't1',
    userId: 'u1',
    role: 'member',
    createdAt: now(),
    updatedAt: now(),
    ...over,
  }) as MemberRow;

const inviteRow = (over: Partial<InviteRow> = {}): InviteRow =>
  ({
    id: 'i1',
    tripId: 't1',
    email: 'ada@example.com',
    token: 'tok-1',
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
    ...over,
  }) as InviteRow;

const ownerUser = { id: 'u1', email: 'owner@example.com' };
const memberUser = { id: 'u2', email: 'member@example.com' };

describe('TripsService', () => {
  // ---- create ----

  it('creates a trip and adds the caller as owner', async () => {
    const svc = new TripsService(fakeRepo());
    const result = await svc.create(
      {
        name: 'Bali Trip',
        destination: 'Bali',
        startDate: '2025-07-01T00:00:00Z',
        endDate: '2025-07-10T00:00:00Z',
      },
      ownerUser,
    );
    expect(result.trip.name).toBe('Bali Trip');
    expect(result.members).toHaveLength(1);
    expect(result.members[0].role).toBe('owner');
    expect(result.members[0].userId).toBe(ownerUser.id);
  });

  // ---- invite ----

  it('creates an invite when owner invites by email', async () => {
    const svc = new TripsService(fakeRepo([tripRow()]));
    const invite = await svc.invite('t1', { email: 'new@example.com' }, ownerUser);
    expect(invite.email).toBe('new@example.com');
    expect(invite.status).toBe('pending');
  });

  it('inviting the same email twice returns the existing pending invite', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [], [inviteRow()]));
    const first = await svc.invite('t1', { email: 'ada@example.com' }, ownerUser);
    const second = await svc.invite('t1', { email: 'ada@example.com' }, ownerUser);
    expect(first.id).toBe(second.id);
    expect(second.status).toBe('pending');
  });

  it('rejects invite from non-owner with forbidden', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], []));
    await expect(svc.invite('t1', { email: 'x@example.com' }, memberUser)).rejects.toThrow(
      AppError,
    );
  });

  it('rejects invite when trip does not exist', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.invite('nope', { email: 'x@example.com' }, ownerUser)).rejects.toThrow(
      AppError,
    );
  });

  // ---- accept ----

  it('accepts an invite and adds the user as a member', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [], [inviteRow()]));
    const member = await svc.acceptInvite('tok-1', memberUser);
    expect(member.userId).toBe(memberUser.id);
    expect(member.role).toBe('member');
  });

  it('accepting the same token twice is a no-op returning the membership', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], [inviteRow()]));
    const first = await svc.acceptInvite('tok-1', memberUser);
    const second = await svc.acceptInvite('tok-1', memberUser);
    expect(first.id).toBe(second.id);
    expect(first.id).toBe(memberRow().id);
  });

  it('rejects accept for a nonexistent invite', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.acceptInvite('no-token', memberUser)).rejects.toThrow(AppError);
  });

  // ---- get by id ----

  it('returns trip detail for a member', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], []));
    const detail = await svc.getById('t1', memberUser);
    expect(detail.trip.id).toBe('t1');
    expect(detail.members).toHaveLength(1);
  });

  it('rejects get by id for a non-member with not_found', async () => {
    const svc = new TripsService(fakeRepo([tripRow()], [memberRow()], []));
    await expect(svc.getById('t1', { id: 'nope', email: 'nobody@example.com' })).rejects.toThrow(
      AppError,
    );
  });

  it('rejects get by id for a nonexistent trip with not_found', async () => {
    const svc = new TripsService(fakeRepo());
    await expect(svc.getById('nope', ownerUser)).rejects.toThrow(AppError);
  });
});
