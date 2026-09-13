import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripDetails } from './entities/trip-details.entity.js';
import { TripsRepository } from './trips.repository.js';
import type {
  TripRow,
  TripMemberRow,
  InviteRow,
  NewTripRow,
  NewTripMemberRow,
  NewInviteRow,
} from '../../../drizzle/schema.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  private toTrip(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toMember(row: TripMemberRow): TripMember {
    return {
      id: row.id,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInvite(row: InviteRow): Invite {
    return {
      id: row.id,
      email: row.email,
      token: row.token,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: CreateTripDto, creatorId: string): Promise<Trip> {
    const tripRow = await this.repo.createTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    } as NewTripRow);
    await this.repo.addMember({
      id: randomUUID(),
      tripId: tripRow.id,
      userId: creatorId,
      role: 'owner',
    } as NewTripMemberRow);
    return this.toTrip(tripRow);
  }

  async invite(tripId: string, email: string, inviterId: string): Promise<Invite> {
    const inviterMember = await this.repo.findMemberByTripAndUser(tripId, inviterId);
    if (!inviterMember || inviterMember.role !== 'owner') {
      throw new AppError('forbidden', 'only owner can invite', { tripId, inviterId });
    }

    const existing = await this.repo.findPendingInviteByTripAndEmail(tripId, email);
    if (existing) {
      return this.toInvite(existing);
    }

    const newInvite = await this.repo.createInvite({
      id: randomUUID(),
      tripId,
      email,
      token: randomUUID(),
      status: 'pending',
    } as NewInviteRow);
    return this.toInvite(newInvite);
  }

  async acceptInvite(token: string, userId: string, userEmail: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    if (invite.email !== userEmail) {
      throw new AppError('forbidden', 'invite email does not match current user', { token });
    }

    if (invite.status === 'accepted') {
      const existingMember = await this.repo.findMemberByTripAndUser(invite.tripId, userId);
      if (existingMember) {
        return this.toMember(existingMember);
      }
      const member = await this.repo.addMember({
        id: randomUUID(),
        tripId: invite.tripId,
        userId,
        role: 'member',
      } as NewTripMemberRow);
      return this.toMember(member);
    }

    await this.repo.updateInviteStatus(invite.id, 'accepted');

    const existingMember = await this.repo.findMemberByTripAndUser(invite.tripId, userId);
    if (existingMember) {
      return this.toMember(existingMember);
    }

    const member = await this.repo.addMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId,
      role: 'member',
    } as NewTripMemberRow);
    return this.toMember(member);
  }

  async getDetails(tripId: string, userId: string): Promise<TripDetails> {
    const member = await this.repo.findMemberByTripAndUser(tripId, userId);
    if (!member) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const tripRow = await this.repo.findTripById(tripId);
    if (!tripRow) {
      throw AppError.notFound('trip not found', { tripId });
    }

    const membersRows = await this.repo.findMembersByTrip(tripId);
    const members = membersRows.map((r) => this.toMember(r));

    const pendingInvitesRows = await this.repo.findPendingInvitesByTrip(tripId);
    const pendingInvites = pendingInvitesRows.map((r) => this.toInvite(r));

    const trip = this.toTrip(tripRow);
    return { ...trip, members, pendingInvites };
  }
}
