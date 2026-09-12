import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module.js';
import {
  trips,
  tripMembers,
  invites,
  type TripRow,
  type NewTripRow,
  type TripMemberRow,
  type NewTripMemberRow,
  type InviteRow,
  type NewInviteRow,
} from '../../../drizzle/schema.js';

@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Trips
  async insertTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  // Members
  async insertMember(row: NewTripMemberRow): Promise<TripMemberRow> {
    const [created] = await this.db.insert(tripMembers).values(row).returning();
    return created;
  }

  async findMember(tripId: string, userId: string): Promise<TripMemberRow | null> {
    const [row] = await this.db
      .select()
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findMembersByTripId(tripId: string): Promise<TripMemberRow[]> {
    return await this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
  }

  // Invites
  async insertInvite(row: NewInviteRow): Promise<InviteRow> {
    const [created] = await this.db.insert(invites).values(row).returning();
    return created;
  }

  async findPendingInvite(tripId: string, email: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(
        and(eq(invites.tripId, tripId), eq(invites.email, email), eq(invites.status, 'pending')),
      )
      .limit(1);
    return row ?? null;
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]> {
    return await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.status, 'pending')));
  }

  async updateInviteStatus(id: string, status: string): Promise<InviteRow> {
    const [row] = await this.db.update(invites).set({ status }).where(eq(invites.id, id)).returning();
    return row;
  }
}
