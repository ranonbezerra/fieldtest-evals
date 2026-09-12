import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { TripInviteRow, TripMemberRow, TripRow, UserRow } from '../../../drizzle/schema.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { PendingInvite, Trip, TripInvite, TripMember } from './entities/trip.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toMember(member: TripMemberRow, user: UserRow): TripMember {
    return {
      id: member.id,
      userId: member.userId,
      email: user.email,
      displayName: user.displayName,
      role: member.role as TripMember['role'],
      createdAt: member.createdAt.toISOString(),
    };
  }

  private toInvite(invite: TripInviteRow): TripInvite {
    return {
      id: invite.id,
      email: invite.email,
      token: invite.token,
      status: invite.status as TripInvite['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toPendingInvite(invite: TripInviteRow): PendingInvite {
    return {
      id: invite.id,
      email: invite.email,
      status: invite.status as PendingInvite['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toTrip(trip: TripRow, members: TripMember[], pendingInvites: PendingInvite[]): Trip {
    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startsAt: trip.startsAt.toISOString(),
      endsAt: trip.endsAt.toISOString(),
      createdAt: trip.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  /** The stub auth passes ids the database may not know; surface a 404 instead of an FK 500. */
  private async requireUserRow(userId: string): Promise<UserRow> {
    const user = await this.repo.findUserRow(userId);
    if (!user) throw AppError.notFound('user not found', { id: userId });
    return user;
  }

  private async assemble(trip: TripRow): Promise<Trip> {
    const [membersWithUsers, pendingInvites] = await Promise.all([
      this.repo.findMembersWithUsers(trip.id),
      this.repo.findPendingInvites(trip.id),
    ]);
    return this.toTrip(
      trip,
      membersWithUsers.map(({ member, user }) => this.toMember(member, user)),
      pendingInvites.map((invite) => this.toPendingInvite(invite)),
    );
  }

  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const creator = await this.requireUserRow(user.id);
    const trip = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: creator.id,
      role: 'owner',
    });
    return this.assemble(trip);
  }

  async createInvite(tripId: string, dto: CreateInviteDto, user: CurrentUserPayload): Promise<TripInvite> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const caller = await this.repo.findMember(tripId, user.id);
    if (!caller || caller.role !== 'owner') {
      throw new AppError(403, 'forbidden', 'only the trip owner can send invites');
    }

    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) return this.toInvite(existing);

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomBytes(24).toString('hex'),
      status: 'pending',
    });
    return this.toInvite(invite);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found');

    // ASSUMPTION: the token is the invite credential; the spec does not require
    // the caller's email to match the invite's, so it is not checked.
    const userRow = await this.requireUserRow(user.id);

    const existing = await this.repo.findMember(invite.tripId, user.id);
    if (existing) {
      // Already in: nothing changes; a still-pending invite just settles.
      if (invite.status === 'pending') await this.repo.markInviteAccepted(invite.id);
      return this.toMember(existing, userRow);
    }

    if (invite.status !== 'pending') {
      throw AppError.conflict(
        invite.status === 'declined' ? 'this invite has been declined' : 'this invite has already been accepted',
      );
    }

    await this.repo.markInviteAccepted(invite.id);
    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    });
    return this.toMember(member, userRow);
  }

  async getTrip(tripId: string, user: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership) throw new AppError(403, 'forbidden', 'only members can view this trip');

    return this.assemble(trip);
  }
}
