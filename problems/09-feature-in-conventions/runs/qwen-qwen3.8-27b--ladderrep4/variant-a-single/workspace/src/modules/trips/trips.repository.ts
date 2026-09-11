import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  trips,
  tripInvites,
  tripMembers,
  users,
  type NewTripInviteRow,
  type NewTripMemberRow,
  type NewTripRow,
  type TripInviteRow,
  type TripRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/** Membership joined with the user it belongs to; what the API returns. */
export interface MemberRow {
  id: string;
  tripId: string;
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
  createdAt: Date;
}

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  async insertTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findMembership(tripId: string, userId: string): Promise<MemberRow | null> {
    const [row] = await this.db
      .select({
        id: tripMembers.id,
        tripId: tripMembers.tripId,
        userId: tripMembers.userId,
        email: users.email,
        displayName: users.displayName,
        role: tripMembers.role,
        createdAt: tripMembers.createdAt,
      })
      .from(tripMembers)
      .innerJoin(users, eq(tripMembers.userId, users.id))
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findMembers(tripId: string): Promise<MemberRow[]> {
    return this.db
      .select({
        id: tripMembers.id,
        tripId: tripMembers.tripId,
        userId: tripMembers.userId,
        email: users.email,
        displayName: users.displayName,
        role: tripMembers.role,
        createdAt: tripMembers.createdAt,
      })
      .from(tripMembers)
      .innerJoin(users, eq(tripMembers.userId, users.id))
      .where(eq(tripMembers.tripId, tripId))
      .orderBy(asc(tripMembers.createdAt), asc(tripMembers.id));
  }

  async insertMember(row: NewTripMemberRow): Promise<MemberRow> {
    const [created] = await this.db.insert(tripMembers).values(row).returning();
    const joined = await this.findMembership(created.tripId, created.userId);
    if (!joined) throw new Error('membership row missing after insert');
    return joined;
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
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')))
      .orderBy(asc(tripInvites.createdAt));
  }

  async findInviteByToken(token: string): Promise<TripInviteRow | null> {
    const [row] = await this.db.select().from(tripInvites).where(eq(tripInvites.token, token)).limit(1);
    return row ?? null;
  }

  async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
    const [created] = await this.db.insert(tripInvites).values(row).returning();
    return created;
  }

  async markInviteAccepted(id: string): Promise<void> {
    await this.db
      .update(tripInvites)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(tripInvites.id, id));
  }
}
