import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { invites, tripMembers, trips } from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';
import type {
  InviteRow,
  NewInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';

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

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  async findMembersByTripId(tripId: string): Promise<TripMemberRow[]> {
    return this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
  }

  async findMember(tripId: string, userId: string): Promise<TripMemberRow | null> {
    const [row] = await this.db
      .select()
      .from(tripMembers)
      .where(
        and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)),
      )
      .limit(1);
    return row ?? null;
  }

  async insertMember(row: NewTripMemberRow): Promise<TripMemberRow> {
    const [created] = await this.db.insert(tripMembers).values(row).returning();
    return created;
  }

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

  async findPendingInvitesByTripId(tripId: string): Promise<InviteRow[]> {
    return this.db
      .select()
      .from(invites)
      .where(
        and(eq(invites.tripId, tripId), eq(invites.status, 'pending')),
      );
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async updateInviteStatus(id: string, status: InviteRow['status']): Promise<InviteRow> {
    const [updated] = await this.db
      .update(invites)
      .set({ status })
      .where(eq(invites.id, id))
      .returning();
    return updated;
  }
}
