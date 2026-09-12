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
  type UserRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/** A membership joined with the user it points at; still row types. */
export interface MemberWithUser {
  member: TripMemberRow;
  user: UserRow;
}

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findUserRow(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

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

  async findMembersWithUsers(tripId: string): Promise<MemberWithUser[]> {
    return this.db
      .select({ member: tripMembers, user: users })
      .from(tripMembers)
      .innerJoin(users, eq(tripMembers.userId, users.id))
      .where(eq(tripMembers.tripId, tripId));
  }

  async insertInvite(row: NewTripInviteRow): Promise<TripInviteRow> {
    const [created] = await this.db.insert(tripInvites).values(row).returning();
    return created;
  }

  async findPendingInvite(tripId: string, email: string): Promise<TripInviteRow | null> {
    const [row] = await this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.email, email), eq(tripInvites.status, 'pending')))
      .limit(1);
    return row ?? null;
  }

  async findInviteByToken(token: string): Promise<TripInviteRow | null> {
    const [row] = await this.db.select().from(tripInvites).where(eq(tripInvites.token, token)).limit(1);
    return row ?? null;
  }

  async markInviteAccepted(id: string): Promise<void> {
    await this.db
      .update(tripInvites)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(tripInvites.id, id));
  }

  async findPendingInvites(tripId: string): Promise<TripInviteRow[]> {
    return this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')));
  }
}
