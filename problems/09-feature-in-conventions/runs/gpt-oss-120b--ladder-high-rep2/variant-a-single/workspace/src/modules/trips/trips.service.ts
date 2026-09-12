import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteDto } from './dto/invite.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Member } from './entities/member.entity.js';
import type { Invite } from './entities/invite.entity.js';
import { TripsRepository } from './trips.repository.js';
import { UsersRepository } from '../users/users.repository.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import type { User } from '../users/entities/user.entity.js';
import type { TripRow, MemberRow, InviteRow } from '../../../drizzle/schema.js';

@Injectable()
export class TripsService {
  constructor(
    private readonly tripsRepo: TripsRepository,
    private readonly usersRepo: UsersRepository,
  ) {}

  private async toMemberEntity(row: MemberRow): Promise<Member> {
    const userRow = await this.usersRepo.findById(row.userId);
    if (!userRow) {
      throw AppError.notFound('user not found', { id: row.userId });
    }
    const user: User = {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.displayName,
      createdAt: userRow.createdAt.toISOString(),
    };
    return { user, role: row.role };
  }

  private async toTripEntity(
    row: TripRow,
    memberRows: MemberRow[],
    pendingInviteRows: InviteRow[],
  ): Promise<Trip> {
    const members = await Promise.all(memberRows.map((mr) => this.toMemberEntity(mr)));
    const pendingInvites: Invite[] = pendingInviteRows.map((ir) => ({
      token: ir.token,
      email: ir.email,
      status: ir.status,
    }));
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const tripRow = await this.tripsRepo.createTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });

    await this.tripsRepo.addMember({
      tripId: tripRow.id,
      userId: user.id,
      role: 'owner',
    });

    const members = await this.tripsRepo.listMembers(tripRow.id);
    const pendingInvites = await this.tripsRepo.listPendingInvites(tripRow.id);
    return this.toTripEntity(tripRow, members, pendingInvites);
  }

  async invite(tripId: string, dto: InviteDto, user: CurrentUserPayload): Promise<Invite> {
    const trip = await this.tripsRepo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const callerMember = await this.tripsRepo.findMember(tripId, user.id);
    if (!callerMember || callerMember.role !== 'owner') {
      throw new AppError('forbidden', 'only the owner can invite', {});
    }

    const existing = await this.tripsRepo.findPendingInvite(tripId, dto.email);
    if (existing) {
      return { token: existing.token, email: existing.email, status: existing.status };
    }

    const newInvite = await this.tripsRepo.createInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomUUID(),
      status: 'pending',
    });

    return { token: newInvite.token, email: newInvite.email, status: newInvite.status };
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<Member> {
    const invite = await this.tripsRepo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    // Ensure the invite email matches the current user (optional safety)
    if (invite.email !== user.email) {
      throw new AppError('forbidden', 'invite email does not match current user', {});
    }

    const existingMember = await this.tripsRepo.findMember(invite.tripId, user.id);
    if (existingMember) {
      if (invite.status !== 'accepted') {
        await this.tripsRepo.updateInviteStatus(token, 'accepted');
      }
      return this.toMemberEntity(existingMember);
    }

    const newMember = await this.tripsRepo.addMember({
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    });

    await this.tripsRepo.updateInviteStatus(token, 'accepted');
    return this.toMemberEntity(newMember);
  }

  async getTrip(tripId: string, user: CurrentUserPayload): Promise<Trip> {
    const member = await this.tripsRepo.findMember(tripId, user.id);
    if (!member) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const trip = await this.tripsRepo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const members = await this.tripsRepo.listMembers(tripId);
    const pendingInvites = await this.tripsRepo.listPendingInvites(tripId);
    return this.toTripEntity(trip, members, pendingInvites);
  }
}
