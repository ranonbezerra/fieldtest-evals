import { describe, expect, it } from 'vitest';
import { TripsService } from './trips.service.js';
import type { TripsRepository } from './trips.repository.js';
import type { UsersRepository } from '../users/users.repository.js';
import { AppError } from '../../common/app-error.js';
import { randomUUID } from 'node:crypto';

// Simple in‑memory fakes
function fakeTripsRepo(): TripsRepository {
  const trips: any[] = [];
  const members: any[] = [];
  const invites: any[] = [];

  return {
    async insertTrip(row) {
      const created = { ...row, createdAt: new Date(), updatedAt: new Date() };
      trips.push(created);
      return created;
    },
    async findTripById(id) {
      return trips.find((t) => t.id === id) ?? null;
    },
    async insertMember(row) {
      const created = { ...row };
      members.push(created);
      return created;
    },
    async findMemberByTripAndUser(tripId, userId) {
      return members.find((m) => m.tripId === tripId && m.userId === userId) ?? null;
    },
    async isMember(tripId, userId) {
      return !!members.find((m) => m.tripId === tripId && m.userId === userId);
    },
    async findMembers(tripId) {
      return members.filter((m) => m.tripId === tripId);
    },
    async insertInvite(row) {
      const created = { ...row };
      invites.push(created);
      return created;
    },
    async findPendingInvite(tripId, email) {
      return (
        invites.find(
          (i) => i.tripId === tripId && i.email === email && i.status === 'pending',
        ) ?? null
      );
    },
    async findInviteByToken(token) {
      return invites.find((i) => i.token === token) ?? null;
    },
    async updateInviteStatus(id, status) {
      const inv = invites.find((i) => i.id === id);
      if (inv) inv.status = status;
    },
    async findPendingInvites(tripId) {
      return invites.filter((i) => i.tripId === tripId && i.status === 'pending');
    },
  } as unknown as TripsRepository;
}

function fakeUsersRepo(): UsersRepository {
  const users: any[] = [];
  return {
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async findByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },
    async insert(row) {
      const created = { ...row, createdAt: new Date(), updatedAt: new Date() };
      users.push(created);
      return created;
    },
  } as unknown as UsersRepository;
}

describe('TripsService', () => {
  it('creates a trip and makes owner a member', async () => {
    const tripsRepo = fakeTripsRepo();
    const usersRepo = fakeUsersRepo();

    // seed owner
    await usersRepo.insert({ id: 'u1', email: 'owner@example.com', displayName: 'Owner' });

    const svc = new TripsService(tripsRepo, usersRepo);
    const trip = await svc.create(
      {
        name: 'Summer',
        destination: 'Hawaii',
        startDate: '2024-06-01',
        endDate: '2024-06-10',
      },
      'u1',
    );

    expect(trip.name).toBe('Summer');
    expect(trip.members).toHaveLength(1);
    expect(trip.members[0].id).toBe('u1');
  });

  it('owner can invite a new email, creating a pending invite', async () => {
    const tripsRepo = fakeTripsRepo();
    const usersRepo = fakeUsersRepo();

    await usersRepo.insert({ id: 'u1', email: 'owner@example.com', displayName: 'Owner' });

    const svc = new TripsService(tripsRepo, usersRepo);
    const trip = await svc.create(
      {
        name: 'Winter',
        destination: 'Alps',
        startDate: '2024-12-01',
        endDate: '2024-12-07',
      },
      'u1',
    );

    const invite = await svc.invite(trip.id, 'guest@example.com', 'u1');
    expect(invite.email).toBe('guest@example.com');
    expect(invite.status).toBe('pending');
  });

  it('accepting an invite adds the user as member', async () => {
    const tripsRepo = fakeTripsRepo();
    const usersRepo = fakeUsersRepo();

    await usersRepo.insert({ id: 'u1', email: 'owner@example.com', displayName: 'Owner' });
    await usersRepo.insert({ id: 'u2', email: 'guest@example.com', displayName: 'Guest' });

    const svc = new TripsService(tripsRepo, usersRepo);
    const trip = await svc.create(
      {
        name: 'Roadtrip',
        destination: 'Route66',
        startDate: '2024-08-01',
        endDate: '2024-08-15',
      },
      'u1',
    );

    const invite = await svc.invite(trip.id, 'guest@example.com', 'u1');
    const member = await svc.acceptInvite(invite.token, 'u2');

    expect(member.id).toBe('u2');

    const fetchedTrip = await svc.getTrip(trip.id, 'u2');
    expect(fetchedTrip.members.map((m) => m.id)).toContain('u2');
  });

  it('rejects fetching a trip by non‑member', async () => {
    const tripsRepo = fakeTripsRepo();
    const usersRepo = fakeUsersRepo();

    await usersRepo.insert({ id: 'u1', email: 'owner@example.com', displayName: 'Owner' });
    await usersRepo.insert({ id: 'u2', email: 'other@example.com', displayName: 'Other' });

    const svc = new TripsService(tripsRepo, usersRepo);
    const trip = await svc.create(
      {
        name: 'Secret',
        destination: 'Vault',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
      },
      'u1',
    );

    await expect(svc.getTrip(trip.id, 'u2')).rejects.toThrow(AppError);
  });
});
