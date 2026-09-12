import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type TripRow,
  type NewTripRow,
  type TripMemberRow,
  type NewTripMemberRow,
  type TripInviteRow,
  type NewTripInviteRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Member } from './entities/member.entity.js';
import type { Invite } from './entities/invite.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  private toMemberEntity(row: TripMemberRow): Member {
    return {
      id: row.id,
      userId: row.userId,
      role: row.role as 'owner' | 'member',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInviteEntity(row: TripInviteRow): Invite {
    return {
      id: row.id,
      token: row.token,
      email: row.email,
      status: row.status as 'pending' | 'accepted' | 'declined',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async toTripEntity(tripRow: TripRow, requesterId: string): Promise<Trip> {
    const membersRows = await this.repo.findMembers(tripRow.id);
    const members = membersRows.map((r) => this.toMemberEntity(r));

    // verify requester is a member
    if (!members.some((m) => m.userId === requesterId)) {
      throw AppError.notFound('trip not found');
    }

    const pendingInvitesRows = await this.repo.findPendingInvites(tripRow.id);
    const pendingInvites = pendingInvitesRows.map((r) => this.toInviteEntity(r));

    return {
      id: tripRow.id,
      name: tripRow.name,
      destination: tripRow.destination,
      startDate: tripRow.startDate.toISOString(),
      endDate: tripRow.endDate.toISOString(),
      createdAt: tripRow.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  async create(dto: CreateTripDto, creatorId: string): Promise<Trip> {
    const tripRow = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    } as NewTripRow);

    await this.repo.insertMember({
      id: randomUUID(),
      tripId: tripRow.id,
      userId: creatorId,
      role: 'owner',
    } as NewTripMemberRow);

    return this.toTripEntity(tripRow, creatorId);
  }

  private async verifyOwner(tripId: string, userId: string): Promise<void> {
    const member = await this.repo.findMember(tripId, userId);
    if (!member || member.role !== 'owner') {
      throw AppError.forbidden('only owner can invite');
    }
  }

  async invite(tripId: string, email: string, requesterId: string): Promise<Invite> {
    // ensure trip exists
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found');

    await this.verifyOwner(tripId, requesterId);

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return this.toInviteEntity(existing);
    }

    const inviteRow = await this.repo.insertInvite({
      id: randomUUID(),
      token: randomUUID(),
      tripId,
      email,
      status: 'pending',
    } as NewTripInviteRow);

    return this.toInviteEntity(inviteRow);
  }

  async acceptInvite(token: string, userId: string): Promise<Member> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found');

    if (invite.status === 'accepted') {
      // Return existing membership if any
      const existingMember = await this.repo.findMember(invite.tripId, userId);
      if (existingMember) return this.toMemberEntity(existingMember);
      // Should not happen, but fallback to creating member
    }

    // Update invite status atomically
    await this.repo.updateInviteStatus(invite.id, 'accepted');

    // Insert membership (unique constraint prevents duplicates)
    const memberRow = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId,
      role: 'member',
    } as NewTripMemberRow);

    return this.toMemberEntity(memberRow);
  }

  async getTrip(tripId: string, requesterId: string): Promise<Trip> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw AppError.notFound('trip not found');
    return this.toTripEntity(trip, requesterId);
  }
}
