import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InviteRow, MembershipRow, TripRow, UserRow } from '../../../drizzle/schema.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { Membership } from './entities/membership.entity.js';
import type { InviteStatus, Trip, TripInvite, TripMember, TripRole } from './entities/trip.entity.js';
import type { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** The creator joins the trip as its owner member. */
  async create(user: CurrentUserPayload, dto: CreateTripDto): Promise<Trip> {
    const { trip } = await this.repo.createTripWithOwner({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
      ownerId: user.id,
    });
    const members = (await this.repo.listMembers(trip.id)).map((row) => this.toTripMember(row));
    // A fresh trip cannot have invites yet.
    return this.toTrip(trip, members, []);
  }

  /** Members only: the trip with its members and still-pending invites. */
  async getById(tripId: string, user: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { id: tripId });

    const membership = await this.repo.findMembership(tripId, user.id);
    if (!membership) {
      throw new AppError('forbidden', 'only members of this trip can view it', { tripId });
    }

    const [memberRows, pendingInvites] = await Promise.all([
      this.repo.listMembers(tripId),
      this.repo.listPendingInvites(tripId),
    ]);
    return this.toTrip(
      trip,
      memberRows.map((row) => this.toTripMember(row)),
      pendingInvites.map((row) => this.toInvite(row)),
    );
  }

  /** Owner only. Re-inviting a pending email is a no-op returning that invite. */
  async invite(user: CurrentUserPayload, tripId: string, dto: CreateInviteDto): Promise<TripInvite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { id: tripId });

    const caller = await this.repo.findMembership(tripId, user.id);
    if (caller?.role !== 'owner') {
      throw new AppError('forbidden', 'only the trip owner can send invites', { tripId });
    }

    const alreadyMember = await this.repo.findMembershipByEmail(tripId, dto.email);
    if (alreadyMember) {
      throw AppError.conflict('user is already a member of this trip', { email: dto.email });
    }

    const existing = await this.repo.findInvite(tripId, dto.email);
    if (existing) {
      if (existing.status === 'pending') {
        return this.toInvite(existing);
      }
      if (existing.status === 'accepted') {
        throw AppError.conflict('invite already accepted', { id: existing.id });
      }
      // A declined invite can be reissued: same row, same token, back to pending.
      return this.toInvite(await this.repo.updateInviteStatus(existing.id, 'pending'));
    }

    return this.toInvite(
      await this.repo.createInvite({
        id: randomUUID(),
        tripId,
        email: dto.email,
        token: randomUUID(),
      }),
    );
  }

  /** The invitee joins as a plain member; accepting twice is a no-op. */
  async accept(user: CurrentUserPayload, token: string): Promise<Membership> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found', { token });

    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError('forbidden', 'this invite was sent to a different email address', {
        email: invite.email,
      });
    }

    const existing = await this.repo.findMembership(invite.tripId, user.id);
    if (existing) {
      // No-op: report the membership and keep the invite state consistent.
      if (invite.status === 'pending') {
        await this.repo.updateInviteStatus(invite.id, 'accepted');
      }
      return this.toMembership(existing);
    }

    if (invite.status !== 'pending') {
      throw new AppError('conflict', `invite is ${invite.status}`, { id: invite.id });
    }

    const membership = await this.repo.addMembership(invite.tripId, user.id, 'member');
    await this.repo.updateInviteStatus(invite.id, 'accepted');
    return this.toMembership(membership);
  }

  /** Row -> entity. The only place the mapping lives. */
  private toTripMember(row: { membership: MembershipRow; user: UserRow }): TripMember {
    return {
      userId: row.membership.userId,
      email: row.user.email,
      displayName: row.user.displayName,
      role: this.toRole(row.membership.role),
      joinedAt: row.membership.createdAt.toISOString(),
    };
  }

  private toTrip(trip: TripRow, members: TripMember[], pendingInvites: TripInvite[]): Trip {
    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      createdAt: trip.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  private toInvite(row: InviteRow): TripInvite {
    return {
      id: row.id,
      email: row.email,
      token: row.token,
      status: this.toStatus(row.status),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMembership(row: MembershipRow): Membership {
    return {
      tripId: row.tripId,
      userId: row.userId,
      role: this.toRole(row.role),
      joinedAt: row.createdAt.toISOString(),
    };
  }

  // The schema stores these as plain text; the API contract is the narrow union.
  private toRole(role: string): TripRole {
    return role === 'owner' ? 'owner' : 'member';
  }

  private toStatus(status: string): InviteStatus {
    if (status === 'accepted') return 'accepted';
    if (status === 'declined') return 'declined';
    return 'pending';
  }
}
