import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { TripsRepository, Trip, TripMember, TripInvite } from './trips.repository.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { TripView } from './dto/trip-view.dto.js';

// ASSUMPTION: TripView is shaped as { id, name, destination, startDate, endDate, members: { userId, role }[], pendingInvites: { email, token }[] } — the exact definition is not visible.

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  async createTrip(userId: string, dto: CreateTripDto): Promise<Trip> {
    const trip = await this.repo.createTrip({
      name: dto.name,
      destination: dto.destination,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
    await this.repo.addMember(trip.id, userId, 'owner');
    return trip;
  }

  async inviteMember(tripId: string, userId: string, email: string): Promise<TripInvite> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const isOwner = await this.repo.isOwner(tripId, userId);
    if (!isOwner) {
      throw new AppError('forbidden', 'only the owner can invite members');
    }

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return existing;
    }

    return this.repo.createInvite(tripId, email, randomUUID());
  }

  async acceptInvite(token: string, userId: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found');
    }

    if (invite.status === 'accepted') {
      const membership = await this.repo.findMembership(invite.tripId, userId);
      if (!membership) {
        throw new AppError('internal', 'membership not found for accepted invite');
      }
      return membership;
    }

    if (invite.status === 'declined') {
      throw new AppError('conflict', 'this invite has been declined');
    }

    await this.repo.updateInviteStatus(invite.id, 'accepted');
    await this.repo.addMember(invite.tripId, userId, 'member');
    const membership = await this.repo.findMembership(invite.tripId, userId);
    if (!membership) {
      throw new AppError('internal', 'failed to create membership');
    }
    return membership;
  }

  async getTrip(tripId: string, userId: string): Promise<TripView> {
    const trip = await this.repo.findTrip(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found');
    }

    const membership = await this.repo.findMembership(tripId, userId);
    if (!membership) {
      throw new AppError('forbidden', 'you must be a member to view this trip');
    }

    const members = await this.repo.getMembers(tripId);
    const pendingInvites = await this.repo.getPendingInvites(tripId);

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
      pendingInvites: pendingInvites.map((i) => ({ email: i.email, token: i.token })),
    };
  }
}
