import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TripInviteRow, TripRow } from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripMember } from './entities/member.entity.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
import type { MemberRow, TripsRepository } from './trips.repository.js';

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

  private toMember(row: MemberRow): TripMember {
    return {
      id: row.id,
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: TripInviteRow): Invite {
    return {
      id: row.id,
      email: row.email,
      token: row.token,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    if (dto.endsAt <= dto.startsAt) {
      throw AppError.validation('date range is invalid: endsAt must be after startsAt', {
        startsAt: dto.startsAt.toISOString(),
        endsAt: dto.endsAt.toISOString(),
      });
    }
    const id = randomUUID();
    const trip = await this.repo.insertTrip({
      id,
      name: dto.name,
      destination: dto.destination,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    // The creator joins as owner in the same call that creates the trip.
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: id,
      userId: user.id,
      role: 'owner',
    });
    return this.toTrip(trip);
  }

  async invite(tripId: string, dto: CreateInviteDto, user: CurrentUserPayload): Promise<Invite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const owner = await this.repo.findMembership(tripId, user.id);
    if (!owner || owner.role !== 'owner') {
      throw new AppError('forbidden', 'only the trip owner can send invites', {
        tripId,
        userId: user.id,
      });
    }

    // Inviting the same email again returns the pending invite, not a new row.
    const pending = await this.repo.findPendingInvite(tripId, dto.email);
    if (pending) return this.toInvite(pending);

    const created = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
      status: 'pending',
      invitedBy: user.id,
    });
    return this.toInvite(created);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });
    if (invite.status === 'declined') {
      throw AppError.conflict('invite was already declined', { token });
    }
    // Only the account the invite was sent to may accept it.
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError('forbidden', 'this invite was not sent to your account', {
        invitedEmail: invite.email,
      });
    }

    // Second accept: the membership already exists, so return it unchanged.
    const existing = await this.repo.findMembership(invite.tripId, user.id);
    if (existing) return this.toMember(existing);

    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    });
    await this.repo.markInviteAccepted(invite.id);
    return this.toMember(member);
  }

  async get(tripId: string, user: CurrentUserPayload): Promise<TripDetail> {
    const membership = await this.repo.findMembership(tripId, user.id);
    const trip = await this.repo.findTripById(tripId);
    // Non-members get the same not-found a missing trip gets, so the API does
    // not reveal which trips exist.
    if (!membership || !trip) throw AppError.notFound('trip not found', { tripId });

    const [members, invites] = await Promise.all([
      this.repo.findMembers(tripId),
      this.repo.findPendingInvites(tripId),
    ]);

    return {
      trip: this.toTrip(trip),
      members: members.map((m) => this.toMember(m)),
      invites: invites.map((i) => this.toInvite(i)),
    };
  }
}
