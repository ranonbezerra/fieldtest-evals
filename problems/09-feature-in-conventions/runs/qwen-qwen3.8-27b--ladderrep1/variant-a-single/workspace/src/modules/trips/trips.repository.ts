import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  tripInvites,
  tripMembers,
  trips,
  type NewTripInviteRow,
  type NewTripMemberRow,
  type NewTripRow,
  type TripInviteRow,
  type TripMemberRow,
  type TripRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  async createMember(row: NewTripMemberRow): Promise<TripMemberRow> {
    const [created] = await this.db.insert(tripMembers).values(row).returning();
    return created;
  }

  /**
   * Insert-or-return: the (trip_id, user_id) primary key makes concurrent
   * accepts collapse onto one row instead of racing a check-then-insert.
   */
  async upsertMember(
    tripId: string,
    userId: string,
    role: NewTripMemberRow['role'],
  ): Promise<TripMemberRow> {
    try {
      return await this.createMember({ tripId, userId, role });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.findMember(tripId, userId);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async findMember(tripId: string, userId: string): Promise<TripMemberRow | null> {
    const [row] = await this.db
      .select()
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async listMembers(tripId: string): Promise<TripMemberRow[]> {
    return this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
  }

  async createInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
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

  async listPendingInvites(tripId: string): Promise<TripInviteRow[]> {
    return this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')));
  }

  async markInviteAccepted(id: string): Promise<void> {
    await this.db
      .update(tripInvites)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(tripInvites.id, id));
  }
}

/** PostgreSQL unique_violation (here: the (trip_id, user_id) key). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
  );
}
