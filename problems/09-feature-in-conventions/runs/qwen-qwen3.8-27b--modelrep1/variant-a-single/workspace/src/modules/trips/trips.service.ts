import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { TripInviteRow, TripRow } from '../../../drizzle/schema.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteTripDto } from './dto/invite-trip.dto.js';
import type { TripInvite, TripInviteStatus } from './entities/invite.entity.js';
import type { TripMember, TripMemberRole } from './entities/member.entity.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
import { TripsRepository, type MemberWithUserRow } from './trips.repository.js';

const ROLE_OWNER: TripMemberRole = 'owner';
const ROLE_MEMBER: TripMemberRole = 'member';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toTrip(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate.toISOString().slice(0, 10),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMember(row: MemberWithUserRow): TripMember {
    return {
      id: row.id,
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      // the repository only ever persists 'owner' | 'member'
      role: row.role as TripMemberRole,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: TripInviteRow): TripInvite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      // the repository only ever persists 'pending' | 'accepted' | 'declined'
      status: row.status as TripInviteStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Creates the trip and records the creator as its owner member. */
  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const row = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: row.id,
      userId: user.id,
      role: ROLE_OWNER,
    });
    return this.toTrip(row);
  }

  /** The trip with its members and pending invites. Members only. */
  async getTrip(id: string, user: CurrentUserPayload): Promise<TripDetail> {
    const row = await this.repo.findTripById(id);
    if (!row) throw AppError.notFound('trip not found', { tripId: id });
    const membership = await this.repo.findMember(id, user.id);
    if (!membership) {
      throw new AppError('forbidden', 'only members can view this trip', { tripId: id });
    }
    const [members, pendingInvites] = await Promise.all([
      this.repo.findMembersWithUsers(id),
      this.repo.findPendingInvites(id),
    ]);
    return {
      ...this.toTrip(row),
      members: members.map((m) => this.toMember(m)),
      pendingInvites: pendingInvites.map((i) => this.toInvite(i)),
    };
  }

  /**
   * Owner-only. Inviting an email that already has a pending invite returns
   * that invite instead of issuing a duplicate.
   */
  async invite(tripId: string, dto: InviteTripDto, user: CurrentUserPayload): Promise<TripInvite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });
    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership || membership.role !== ROLE_OWNER) {
      throw new AppError('forbidden', 'only the trip owner can invite', { tripId });
    }
    const existing = await this.repo.findLatestInviteByEmail(tripId, dto.email);
    if (existing && existing.status === 'pending') return this.toInvite(existing);
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

  /**
   * The invite token is the credential: accepting adds the caller as a
   * `member` and marks the invite accepted. Accepting twice (or accepting
   * when already a member) is a no-op that returns the membership.
   */
  async accept(token: string, user: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });
    let membership = await this.repo.findMemberWithUser(invite.tripId, user.id);
    if (!membership) {
      await this.repo.insertMember({
        id: randomUUID(),
        tripId: invite.tripId,
        userId: user.id,
        role: ROLE_MEMBER,
      });
      const refreshed = await this.repo.findMemberWithUser(invite.tripId, user.id);
      if (!refreshed) throw new AppError('internal', 'membership created but could not be read back');
      membership = refreshed;
    }
    if (invite.status !== 'accepted') {
      await this.repo.updateInviteStatus(invite.id, 'accepted');
    }
    return this.toMember(membership);
  }
}
