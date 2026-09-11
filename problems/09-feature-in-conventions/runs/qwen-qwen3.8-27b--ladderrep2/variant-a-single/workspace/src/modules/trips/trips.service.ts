import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TripInviteRow, TripMemberRow, TripRow } from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripDetail } from './entities/trip-detail.entity.js';
import type { TripInvite, TripInviteWithToken } from './entities/trip-invite.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
import { TripsRepository } from './trips.repository.js';

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

  private toMember(
    row: Pick<TripMemberRow, 'id' | 'tripId' | 'userId' | 'role' | 'createdAt'>,
    email: string,
  ): TripMember {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      email,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: TripInviteRow): TripInvite {
    return {
      id: row.id,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInviteWithToken(row: TripInviteRow): TripInviteWithToken {
    return { ...this.toInvite(row), token: row.token };
  }

  async create(dto: CreateTripDto, creator: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.createTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    // The creator is the trip's owner from the first write.
    await this.repo.insertMembershipIfAbsent({
      id: randomUUID(),
      tripId: trip.id,
      userId: creator.id,
      role: 'owner',
    });
    return this.toTrip(trip);
  }

  async getById(tripId: string, viewer: CurrentUserPayload): Promise<TripDetail> {
    // The access gate: a non-member gets the exact same not-found a
    // nonexistent trip would, so membership is not disclosed.
    const membership = await this.repo.findMembership(tripId, viewer.id);
    if (!membership) throw AppError.notFound('trip not found', { tripId });

    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const [members, pendingInvites] = await Promise.all([
      this.repo.findMembers(tripId),
      this.repo.findPendingInvites(tripId),
    ]);

    return {
      ...this.toTrip(trip),
      members: members.map((m) => this.toMember(m, m.email)),
      // Tokens are never listed; the owner re-fetches one via the invite
      // endpoint if it needs to be re-sent.
      pendingInvites: pendingInvites.map((i) => this.toInvite(i)),
    };
  }

  async invite(tripId: string, dto: InviteTripDto, inviter: CurrentUserPayload): Promise<TripInviteWithToken> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const membership = await this.repo.findMembership(tripId, inviter.id);
    if (!membership || membership.role !== 'owner') {
      throw new AppError('forbidden', 'only the trip owner can send invites', { tripId });
    }

    // Re-inviting an email that already has a pending invite returns that
    // invite instead of creating a second one.
    const existing = await this.repo.findPendingInviteByEmail(tripId, dto.email);
    if (existing) return this.toInviteWithToken(existing);

    const created = await this.repo.createInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
      status: 'pending',
    });
    return this.toInviteWithToken(created);
  }

  async accept(token: string, current: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });

    if (invite.email !== current.email) {
      throw new AppError('forbidden', 'this invite is not addressed to you');
    }

    const existing = await this.repo.findMembership(invite.tripId, current.id);
    if (existing) {
      // Already a member: accepting again is a no-op that returns the
      // membership.
      if (invite.status === 'pending') {
        await this.repo.markInviteAccepted(invite.id);
      }
      return this.toMember(existing, current.email);
    }

    // The unique (trip, user) constraint makes this race-safe: concurrent
    // accepts converge on the same row instead of a duplicate.
    const membership = await this.repo.insertMembershipIfAbsent({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: current.id,
      role: 'member',
    });
    await this.repo.markInviteAccepted(invite.id);
    return this.toMember(membership, current.email);
  }
}
