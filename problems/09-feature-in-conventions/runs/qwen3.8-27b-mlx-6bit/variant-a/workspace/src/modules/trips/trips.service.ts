import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { TripsRepository } from './trips.repository.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { InviteTripDto } from './dto/invite-trip.dto.js';
import { GetTripResponseDto, MemberView, PendingInviteView } from './dto/get-trip-response.dto.js';
import { Trip } from './entities/trip.entity.js';
import { TripMember } from './entities/trip-member.entity.js';
import { TripInvite } from './entities/trip-invite.entity.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  async createTrip(dto: CreateTripDto, creatorId: number): Promise<Trip> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate >= endDate) {
      throw new AppError('validation_failed', 'startDate must be before endDate');
    }

    const trip = await this.repo.create({
      name: dto.name,
      destination: dto.destination,
      startDate,
      endDate,
    });
    await this.repo.addMember(trip.id, creatorId, 'owner');
    return trip;
  }

  async inviteToTrip(tripId: number, dto: InviteTripDto, ownerId: number): Promise<TripInvite> {
    const trip = await this.repo.findById(tripId);
    if (!trip) {
      throw new AppError('not_found', 'Trip not found');
    }

    const members = await this.repo.getMembers(tripId);
    if (!members.some((m) => m.userId === ownerId && m.role === 'owner')) {
      throw new AppError('forbidden', 'Only the owner can invite members');
    }

    const existing = await this.repo.findPendingInviteByTripAndEmail(tripId, dto.email);
    if (existing) {
      return existing;
    }

    const token = randomBytes(16).toString('hex');
    return this.repo.createInvite(tripId, dto.email, token, ownerId);
  }

  // ASSUMPTION: TripsRepository includes findUserByEmail(email: string): Promise<{ id: number; email: string } | null>
  async acceptInvite(token: string, userId: number): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw new AppError('not_found', 'Invite not found');
    }

    const user = await this.repo.findUserByEmail(invite.email);
    if (!user || user.id !== userId) {
      throw new AppError('not_found', 'Invite not found');
    }

    if (invite.status === 'accepted') {
      const members = await this.repo.getMembers(invite.tripId);
      const member = members.find((m) => m.userId === userId);
      if (member) {
        return member;
      }
      throw new AppError('not_found', 'Invite not found');
    }

    if (invite.status === 'declined') {
      throw new AppError('not_found', 'Invite not found');
    }

    // status is 'pending'
    await this.repo.updateInviteStatus(invite.id, 'accepted');
    return this.repo.addMember(invite.tripId, userId, 'member');
  }

  async getTrip(tripId: number, requesterId: number): Promise<GetTripResponseDto> {
    const trip = await this.repo.findById(tripId);
    if (!trip) {
      throw new AppError('not_found', 'Trip not found');
    }

    const isMember = await this.repo.isMember(tripId, requesterId);
    if (!isMember) {
      throw new AppError('forbidden', 'You are not a member of this trip');
    }

    const [members, pendingInvites] = await Promise.all([
      this.repo.getMembers(tripId),
      this.repo.getPendingInvites(tripId),
    ]);

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate.toISOString(),
      endDate: trip.endDate.toISOString(),
      members: members.map((m): MemberView => ({ userId: m.userId, role: m.role })),
      pendingInvites: pendingInvites.map((inv): PendingInviteView => ({ email: inv.email, token: inv.token })),
    };
  }
}
