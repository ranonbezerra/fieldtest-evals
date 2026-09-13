import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  InviteRow,
  NewInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteDto } from './dto/invite.dto.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  private toTripEntity(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMemberEntity(row: TripMemberRow): TripMember {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      role: row.role as 'owner' | 'member',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInviteEntity(row: InviteRow): Invite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status as 'pending' | 'accepted' | 'declined',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: CreateTripDto, creatorId: string): Promise<Trip> {
    const trip = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: creatorId,
      role: 'owner',
    });
    return this.toTripEntity(trip);
  }

  async getById(tripId: string, userId: string): Promise<TripDetail> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const members = await this.repo.findMembersByTripId(tripId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const pendingInvites = await this.repo.findPendingInvitesByTripId(tripId);

    return {
      ...this.toTripEntity(trip),
      members: members.map((m) => this.toMemberEntity(m)),
      pendingInvites: pendingInvites.map((i) => this.toInviteEntity(i)),
    };
  }

  async invite(tripId: string, inviterId: string, email: string): Promise<Invite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const membership = await this.repo.findMember(tripId, inviterId);
    if (!membership || membership.role !== 'owner') {
      throw AppError.forbidden('only owners can invite', { tripId });
    }

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return this.toInviteEntity(existing);
    }

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email,
      token: randomUUID(),
      status: 'pending',
    });
    return this.toInviteEntity(invite);
  }

  async acceptInvite(token: string, userId: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    const existing = await this.repo.findMember(invite.tripId, userId);
    if (existing) {
      return this.toMemberEntity(existing);
    }

    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId,
      role: 'member',
    });

    await this.repo.updateInviteStatus(invite.id, 'accepted');

    return this.toMemberEntity(member);
  }
}
