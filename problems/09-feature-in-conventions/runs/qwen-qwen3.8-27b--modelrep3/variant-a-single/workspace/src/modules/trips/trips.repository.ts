import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  trips,
  tripMembers,
  tripInvites,
  type NewTripRow,
  type NewTripMemberRow,
  type NewTripInviteRow,
  type TripRow,
  type TripMemberRow,
  type TripInviteRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insertTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

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

  async findMembers(tripId: string): Promise<TripMemberRow[]> {
    return this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
  }

  async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
    const [created] = await this.db.insert(tripInvites).values(row).returning();
    return created;
  }

  async findInviteByToken(token: string): Promise<TripInviteRow | null> {
    const [row] = await this.db
      .select()
      .from(tripInvites)
      .where(eq(tripInvites.token, token))
      .limit(1);
    return row ?? null;
  }

  async findPendingInvite(tripId: string, email: string): Promise<TripInviteRow | null> {
    const [row] = await this.db
      .select()
      .from(tripInvites)
      .where(
        and(
          eq(tripInvites.tripId, tripId),
          eq(tripInvites.email, email),
          eq(tripInvites.status, 'pending'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
    return this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')));
  }

  async updateInviteStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(tripInvites)
      .set({ status, updatedAt: new Date() })
      .where(eq(tripInvites.id, id));
  }
}
