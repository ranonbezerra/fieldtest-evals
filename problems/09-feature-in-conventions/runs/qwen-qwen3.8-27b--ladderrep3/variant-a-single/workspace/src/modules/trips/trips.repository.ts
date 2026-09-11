import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  tripInvites,
  tripMembers,
  trips,
  users,
  type NewTripInviteRow,
  type NewTripMemberRow,
  type NewTripRow,
  type TripInviteRow,
  type TripMemberRow,
  type TripRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/** A membership row joined with the owning user's profile. */
export interface TripMembershipRow {
  id: string;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: Date;
  updatedAt: Date;
  email: string;
  displayName: string;
}

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private membershipSelect() {
    return this.db.select({
      id: tripMembers.id,
      tripId: tripMembers.tripId,
      userId: tripMembers.userId,
      role: tripMembers.role,
      createdAt: tripMembers.createdAt,
      updatedAt: tripMembers.updatedAt,
      email: users.email,
      displayName: users.displayName,
    });
  }

  async createTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  async findMembers(tripId: string): Promise<TripMembershipRow[]> {
    return this.membershipSelect()
      .from(tripMembers)
      .innerJoin(users, eq(tripMembers.userId, users.id))
      .where(eq(tripMembers.tripId, tripId))
      .orderBy(tripMembers.createdAt);
  }

  async findMember(tripId: string, userId: string): Promise<TripMembershipRow | null> {
    const [row] = await this.membershipSelect()
      .from(tripMembers)
      .innerJoin(users, eq(tripMembers.userId, users.id))
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Returns null when (trip, user) is already a membership: the unique index
   * makes a racing duplicate a no-op instead of an error or a second row.
   */
  async insertMember(row: NewTripMemberRow): Promise<TripMemberRow | null> {
    const [created] = await this.db
      .insert(tripMembers)
      .values(row)
      .onConflictDoNothing({ target: [tripMembers.tripId, tripMembers.userId] })
      .returning();
    return created ?? null;
  }

  async findPendingInviteByEmail(tripId: string, email: string): Promise<TripInviteRow | null> {
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
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')))
      .orderBy(tripInvites.createdAt);
  }

  async findInviteByToken(token: string): Promise<TripInviteRow | null> {
    const [row] = await this.db.select().from(tripInvites).where(eq(tripInvites.token, token)).limit(1);
    return row ?? null;
  }

  async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
    const [created] = await this.db.insert(tripInvites).values(row).returning();
    return created;
  }

  async markInviteStatus(id: string, status: TripInviteRow['status']): Promise<void> {
    await this.db
      .update(tripInvites)
      .set({ status, updatedAt: new Date() })
      .where(eq(tripInvites.id, id));
  }
}
