import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { TripInviteRow, TripMemberRow, TripRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { Invite, InviteStatus } from './entities/invite.entity.js';
import type { Membership, PendingInvite, Trip, TripMember, TripRole } from './entities/trip.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toTripMember(row: TripMemberRow): TripMember {
    return {
      userId: row.userId,
      role: row.role as TripRole,
      joinedAt: row.createdAt.toISOString(),
    };
  }

  private toMembership(row: TripMemberRow): Membership {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      role: row.role as TripRole,
      joinedAt: row.createdAt.toISOString(),
    };
  }

  private toPendingInvite(row: TripInviteRow): PendingInvite {
    return {
      id: row.id,
      email: row.email,
      status: row.status as InviteStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: TripInviteRow): Invite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status as InviteStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toTrip(row: TripRow, members: TripMemberRow[], pendingInvites: TripInviteRow[]): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      members: members.map((m) => this.toTripMember(m)),
      pendingInvites: pendingInvites.map((i) => this.toPendingInvite(i)),
    };
  }

  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    const owner = await this.repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: user.id,
      role: 'owner',
    });
    return this.toTrip(trip, [owner], []);
  }

  async invite(tripId: string, dto: CreateInviteDto, user: CurrentUserPayload): Promise<Invite> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { id: tripId });

    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership) {
      throw new AppError('forbidden', 'only trip members can send invites', { id: tripId });
    }
    if (membership.role !== 'owner') {
      throw new AppError('forbidden', 'only the trip owner can send invites', { id: tripId });
    }

    const email = dto.email.toLowerCase();
    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) return this.toInvite(existing);

    const row = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email,
      token: randomUUID(),
      status: 'pending',
    });
    return this.toInvite(row);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<Membership> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });

    // ASSUMPTION: an invite is addressed to one email, so only that user may
    // accept it; any other authenticated user is rejected.
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError('forbidden', 'this invite was issued to a different email address');
    }

    // Accepting twice is a no-op that returns the existing membership.
    const existing = await this.repo.findMember(invite.tripId, user.id);
    if (existing) {
      if (invite.status === 'pending') {
        await this.repo.updateInviteStatus(invite.id, 'accepted');
      }
      return this.toMembership(existing);
    }

    const membership = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    });
    await this.repo.updateInviteStatus(invite.id, 'accepted');
    return this.toMembership(membership);
  }

  async getById(tripId: string, user: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { id: tripId });

    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership) {
      throw new AppError('forbidden', 'only trip members can view this trip', { id: tripId });
    }

    const [members, pendingInvites] = await Promise.all([
      this.repo.findMembers(tripId),
      this.repo.findPendingInvites(tripId),
    ]);
    return this.toTrip(trip, members, pendingInvites);
  }
}
