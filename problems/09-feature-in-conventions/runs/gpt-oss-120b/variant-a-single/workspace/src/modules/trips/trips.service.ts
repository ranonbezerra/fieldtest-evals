import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { NewTripRow, TripRow, InviteRow, NewInviteRow, MemberRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteDto } from './dto/invite.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { User } from '../users/entities/user.entity.js';
import { TripsRepository } from './trips.repository.js';
import { UsersRepository } from '../users/users.repository.js';

@Injectable()
export class TripsService {
  constructor(
    private readonly repo: TripsRepository,
    private readonly usersRepo: UsersRepository,
  ) {}

  private toTripEntity(row: TripRow, members: User[], pendingInvites: Invite[]): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startDate: row.startDate,
      endDate: row.endDate,
      ownerId: row.ownerId,
      createdAt: row.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  async create(dto: CreateTripDto, ownerId: string): Promise<Trip> {
    const tripRow = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
      ownerId,
    });

    // Owner automatically becomes a member
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: tripRow.id,
      userId: ownerId,
    });

    const owner = await this.usersRepo.findById(ownerId);
    if (!owner) throw AppError.notFound('owner not found', { ownerId });

    return this.toTripEntity(tripRow, [this.mapUser(owner)], []);
  }

  async invite(tripId: string, email: string, requesterId: string): Promise<Invite> {
    // Verify requester is owner
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });
    if (trip.ownerId !== requesterId) {
      throw AppError.forbidden('only owner can invite', { tripId });
    }

    // Check for existing pending invite
    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return this.mapInvite(existing);
    }

    const token = randomUUID();
    const inviteRow = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email,
      token,
      status: 'pending',
    });

    return this.mapInvite(inviteRow);
  }

  async acceptInvite(token: string, userId: string): Promise<User> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });

    if (invite.status === 'accepted') {
      // Find existing member
      const member = await this.repo.findMemberByTripAndUser(invite.tripId, userId);
      if (member) return this.mapUser(await this.usersRepo.findById(userId) as any);
    }

    // Update status
    await this.repo.updateInviteStatus(invite.id, 'accepted');

    // Add member
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId,
    });

    const user = await this.usersRepo.findById(userId);
    if (!user) throw AppError.notFound('user not found', { userId });
    return this.mapUser(user);
  }

  async getTrip(tripId: string, requesterId: string): Promise<Trip> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    // Ensure requester is a member
    const isMember = await this.repo.isMember(tripId, requesterId);
    if (!isMember) throw AppError.forbidden('not a member of this trip', { tripId });

    const membersRows = await this.repo.findMembers(tripId);
    const members = await Promise.all(
      membersRows.map(async (m) => {
        const user = await this.usersRepo.findById(m.userId);
        return this.mapUser(user as any);
      }),
    );

    const pendingInvitesRows = await this.repo.findPendingInvites(tripId);
    const pendingInvites = pendingInvitesRows.map(this.mapInvite.bind(this));

    return this.toTripEntity(trip, members, pendingInvites);
  }

  private mapUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapInvite(row: InviteRow): Invite {
    return {
      id: row.id,
      email: row.email,
      token: row.token,
      status: row.status,
    };
  }
}
