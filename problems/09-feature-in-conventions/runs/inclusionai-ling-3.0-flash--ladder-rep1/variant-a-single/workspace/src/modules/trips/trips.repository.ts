import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  invites,
  members,
  trips,
  type InviteRow,
  type MemberRow,
  type NewInviteRow,
  type NewMemberRow,
  type NewTripRow,
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

  // ---- trips ----

  async insertTrip(row: NewTripRow): Promise<TripRow> {
    const [created] = await this.db.insert(trips).values(row).returning();
    return created;
  }

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  // ---- members ----

  async insertMember(row: NewMemberRow): Promise<MemberRow> {
    const [created] = await this.db.insert(members).values(row).returning();
    return created;
  }

  async findMember(tripId: string, userId: string): Promise<MemberRow | null> {
    const [row] = await this.db
      .select()
      .from(members)
      .where(and(eq(members.tripId, tripId), eq(members.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findMembersByTripId(tripId: string): Promise<MemberRow[]> {
    return this.db.select().from(members).where(eq(members.tripId, tripId));
  }

  // ---- invites ----

  async insertInvite(row: NewInviteRow): Promise<InviteRow> {
    const [created] = await this.db.insert(invites).values(row).returning();
    return created;
  }

  async findPendingInvite(tripId: string, email: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tripId, tripId),
          eq(invites.email, email),
          eq(invites.status, 'pending'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]> {
    return this.db.select().from(invites).where(
      and(eq(invites.tripId, tripId), eq(invites.status, 'pending')),
    );
  }

  async updateInviteStatus(token: string, status: string): Promise<void> {
    await this.db.update(invites).set({ status }).where(eq(invites.token, token));
  }
}
