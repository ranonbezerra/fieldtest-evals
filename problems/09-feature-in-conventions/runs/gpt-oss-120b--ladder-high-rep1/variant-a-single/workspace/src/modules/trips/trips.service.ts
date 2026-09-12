import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  TripRow,
  NewTripRow,
  TripMemberRow,
  NewTripMemberRow,
  InviteRow,
  NewInviteRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { Member } from './entities/member.entity.js';
import type { TripDetail } from './entities/trip-detail.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  private toTripEntity(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMemberEntity(row: TripMemberRow): Member {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInviteEntity(row: InviteRow): Invite {
    return {
      id: row.id,
      token: row.token,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: CreateTripDto, creator: CurrentUserPayload): Promise<Trip> {
    const tripRow: NewTripRow = {
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    };
    const createdTrip = await this.repo.insertTrip(tripRow);

    const ownerMember: NewTripMemberRow = {
      id: randomUUID(),
      tripId: createdTrip.id,
      userId: creator.id,
      role: 'owner',
    };
    await this.repo.insertMember(ownerMember);

    return this.toTripEntity(createdTrip);
  }

  async invite(tripId: string, email: string, inviter: CurrentUserPayload): Promise<Invite> {
    const inviterMember = await this.repo.findMember(tripId, inviter.id);
    if (!inviterMember) {
      throw AppError.notFound('trip not found', { tripId });
    }
    if (inviterMember.role !== 'owner') {
      throw new AppError('forbidden', 'only owner can invite');
    }

    const existingPending = await this.repo.findPendingInvite(tripId, email);
    if (existingPending) {
      return this.toInviteEntity(existingPending);
    }

    const newInvite: NewInviteRow = {
      id: randomUUID(),
      token: randomUUID(),
      tripId,
      email,
      status: 'pending',
    };
    const createdInvite = await this.repo.insertInvite(newInvite);
    return this.toInviteEntity(createdInvite);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<Member> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    if (invite.status !== 'pending' && invite.status !== 'accepted') {
      // For simplicity treat non‑pending as not found.
      throw AppError.notFound('invite not found', { token });
    }

    // If the user is already a member, return it (idempotent).
    const existingMember = await this.repo.findMember(invite.tripId, user.id);
    if (existingMember) {
      // Ensure invite is marked accepted.
      if (invite.status !== 'accepted') {
        await this.repo.updateInviteStatus(invite.id, 'accepted');
      }
      return this.toMemberEntity(existingMember);
    }

    const newMember: NewTripMemberRow = {
      id: randomUUID(),
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    };
    const createdMember = await this.repo.insertMember(newMember);
    await this.repo.updateInviteStatus(invite.id, 'accepted');
    return this.toMemberEntity(createdMember);
  }

  async getTrip(tripId: string, user: CurrentUserPayload): Promise<TripDetail> {
    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership) {
      // Hide existence of the trip from non‑members.
      throw AppError.notFound('trip not found', { tripId });
    }

    const tripRow = await this.repo.findTripById(tripId);
    if (!tripRow) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const membersRows = await this.repo.findMembersByTripId(tripId);
    const pendingInvitesRows = await this.repo.findPendingInvitesByTripId(tripId);

    return {
      ...this.toTripEntity(tripRow),
      members: membersRows.map((r) => this.toMemberEntity(r)),
      pendingInvites: pendingInvitesRows.map((r) => this.toInviteEntity(r)),
    };
  }
}
