import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { TripInviteRow, TripMemberRow, TripRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { Invite } from './entities/invite.entity.js';
import type { Member } from './entities/member.entity.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
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

  private toMember(row: TripMemberRow): Member {
    return {
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: TripInviteRow): Invite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const id = randomUUID();
    const row = await this.repo.createTrip({
      id,
      name: dto.name,
      destination: dto.destination,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
    });
    await this.repo.createMember({ tripId: id, userId: user.id, role: 'owner' });
    return this.toTrip(row);
  }

  async getTrip(id: string, user: CurrentUserPayload): Promise<TripDetail> {
    const [trip, actor] = await Promise.all([
      this.repo.findTripById(id),
      this.repo.findMember(id, user.id),
    ]);
    // A trip the caller is not a member of is indistinguishable from a trip
    // that does not exist: same code, same message, same details.
    if (!trip || !actor) {
      throw AppError.notFound('trip not found', { id });
    }
    const [members, invites] = await Promise.all([
      this.repo.listMembers(id),
      this.repo.listPendingInvites(id),
    ]);
    return {
      ...this.toTrip(trip),
      members: members.map((m) => this.toMember(m)),
      invites: invites.map((i) => this.toInvite(i)),
    };
  }

  async invite(tripId: string, dto: InviteTripDto, user: CurrentUserPayload): Promise<Invite> {
    const [trip, actor] = await Promise.all([
      this.repo.findTripById(tripId),
      this.repo.findMember(tripId, user.id),
    ]);
    // ASSUMPTION: the spec only fixes the owner case; a non-member gets
    // not_found (the trip is hidden from them) and a non-owner member
    // gets forbidden.
    if (!trip || !actor) {
      throw AppError.notFound('trip not found', { id: tripId });
    }
    if (actor.role !== 'owner') {
      throw new AppError('forbidden', 'only the trip owner can invite', { id: tripId });
    }
    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) {
      return this.toInvite(existing);
    }
    const row = await this.repo.createInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
    });
    return this.toInvite(row);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<Member> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }
    // ASSUMPTION: an invite is addressed to exactly one email, and only that
    // email may accept it.
    if (invite.email !== user.email) {
      throw new AppError('forbidden', 'this invite was sent to a different email', {
        email: invite.email,
      });
    }
    // ASSUMPTION: a declined invite is terminal; re-accepting an accepted
    // invite is the specified no-op.
    if (invite.status === 'declined') {
      throw AppError.conflict('invite was declined', { token });
    }
    // The (trip, user) primary key makes a repeat or concurrent accept
    // collapse onto the single existing membership instead of racing.
    const member = await this.repo.upsertMember(invite.tripId, user.id, 'member');
    if (invite.status === 'pending') {
      await this.repo.markInviteAccepted(invite.id);
    }
    return this.toMember(member);
  }
}
