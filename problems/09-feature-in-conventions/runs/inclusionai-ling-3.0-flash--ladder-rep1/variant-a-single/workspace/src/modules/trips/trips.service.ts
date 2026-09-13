import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InviteRow, MemberRow, TripRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteMemberDto } from './dto/invite-member.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { Member } from './entities/member.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  // ---- row -> entity mappers ----

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

  private toMember(row: MemberRow): Member {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      role: row.role as 'owner' | 'member',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: InviteRow): Invite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status as 'pending' | 'accepted' | 'declined',
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- trip creation ----

  async create(dto: CreateTripDto, currentUser: CurrentUserPayload): Promise<{ trip: Trip; members: Member[] }> {
    const tripRow = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: new Date(dto.startDate),
      endsAt: new Date(dto.endDate),
    });

    await this.repo.insertMember({
      id: randomUUID(),
      tripId: tripRow.id,
      userId: currentUser.id,
      role: 'owner',
    });

    const members = await this.repo.findMembersByTripId(tripRow.id);

    return { trip: this.toTrip(tripRow), members: members.map((m) => this.toMember(m)) };
  }

  // ---- invites ----

  async invite(tripId: string, dto: InviteMemberDto, currentUser: CurrentUserPayload): Promise<Invite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const membership = await this.repo.findMember(tripId, currentUser.id);
    if (!membership || membership.role !== 'owner') {
      throw AppError.unauthorized('only the trip owner can invite members', { tripId });
    }

    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) {
      return this.toInvite(existing);
    }

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
      status: 'pending',
    });

    return this.toInvite(invite);
  }

  async acceptInvite(token: string, currentUser: CurrentUserPayload): Promise<Member> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    const existing = await this.repo.findMember(invite.tripId, currentUser.id);
    if (existing) {
      return this.toMember(existing);
    }

    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: currentUser.id,
      role: 'member',
    });

    if (invite.status === 'pending') {
      await this.repo.updateInviteStatus(token, 'accepted');
    }

    return this.toMember(member);
  }

  // ---- lookup ----

  async getById(tripId: string, currentUser: CurrentUserPayload) {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const membership = await this.repo.findMember(tripId, currentUser.id);
    if (!membership) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const members = await this.repo.findMembersByTripId(tripId);
    const pendingInvites = await this.repo.findPendingInvitesByTripId(tripId);

    return {
      trip: this.toTrip(trip),
      members: members.map((m) => this.toMember(m)),
      pendingInvites: pendingInvites.map((i) => this.toInvite(i)),
    };
  }
}
