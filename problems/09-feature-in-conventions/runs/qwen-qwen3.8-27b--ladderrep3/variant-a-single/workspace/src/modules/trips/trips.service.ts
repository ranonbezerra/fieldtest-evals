import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { TripInviteRow, TripRow } from '../../../drizzle/schema.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
import type { TripInvite } from './entities/trip-invite.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
import { TripsRepository, type TripMembershipRow } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toTrip(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMember(row: TripMembershipRow): TripMember {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: TripInviteRow): TripInvite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** The creator joins the new trip as `owner`. */
  async createTrip(dto: CreateTripDto, creator: CurrentUserPayload): Promise<Trip> {
    const id = randomUUID();
    const trip = await this.repo.createTrip({
      id,
      name: dto.name,
      destination: dto.destination,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: id,
      userId: creator.id,
      role: 'owner',
    });
    return this.toTrip(trip);
  }

  async inviteTrip(tripId: string, dto: InviteTripDto, inviter: CurrentUserPayload): Promise<TripInvite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const membership = await this.repo.findMember(tripId, inviter.id);
    // A non-member gets not_found, not forbidden: the trip is invisible to them.
    if (!membership) throw AppError.notFound('trip not found', { tripId });
    if (membership.role !== 'owner') {
      throw new AppError('forbidden', 'only the trip owner can send invites', {
        tripId,
        userId: inviter.id,
      });
    }

    // Inviting the same email while one is still pending returns the existing
    // invite instead of creating a second row.
    const pending = await this.repo.findPendingInviteByEmail(tripId, dto.email);
    if (pending) return this.toInvite(pending);

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
    });
    return this.toInvite(invite);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });
    if (invite.status === 'declined') {
      throw AppError.conflict('invite already declined', { token });
    }

    // Re-accepting is a structural no-op: the unique (trip, user) index makes a
    // duplicate insert lose the race instead of creating a second row, and the
    // read below resolves whichever membership won.
    let member = await this.repo.findMember(invite.tripId, user.id);
    if (!member) {
      await this.repo.insertMember({
        id: randomUUID(),
        tripId: invite.tripId,
        userId: user.id,
        role: 'member',
      });
      member = await this.repo.findMember(invite.tripId, user.id);
      if (!member) {
        throw new AppError('internal', 'membership could not be resolved', {
          tripId: invite.tripId,
          userId: user.id,
        });
      }
    }

    if (invite.status === 'pending') {
      await this.repo.markInviteStatus(invite.id, 'accepted');
    }
    return this.toMember(member);
  }

  async getTrip(tripId: string, viewer: CurrentUserPayload): Promise<TripDetail> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    // Only members may see a trip; a non-member gets exactly the same
    // not_found a missing trip would.
    const membership = await this.repo.findMember(tripId, viewer.id);
    if (!membership) throw AppError.notFound('trip not found', { tripId });

    const [members, pendingInvites] = await Promise.all([
      this.repo.findMembers(tripId),
      this.repo.findPendingInvites(tripId),
    ]);

    return {
      ...this.toTrip(trip),
      members: members.map((row) => this.toMember(row)),
      pendingInvites: pendingInvites.map((row) => this.toInvite(row)),
    };
  }
}
