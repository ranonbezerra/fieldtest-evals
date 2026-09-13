import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  trips,
  type TripRow,
  type NewTripRow,
  tripMembers,
  type TripMemberRow,
  type NewTripMemberRow,
  invites,
  type InviteRow,
  type NewInviteRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

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

  async addMember(row: NewTripMemberRow): Promise<TripMemberRow> {
    const [created] = await this.db.insert(tripMembers).values(row).returning();
    return created;
  }

  async findMemberByTripAndUser(tripId: string, userId: string): Promise<TripMemberRow | null> {
    const [row] = await this.db
      .select()
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findMembersByTrip(tripId: string): Promise<TripMemberRow[]> {
    return await this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
  }

  async findPendingInviteByTripAndEmail(tripId: string, email: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tripId, tripId),
          eq(invites.email, email),
          eq(invites.status, 'pending' as any),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findInviteByTripAndEmail(tripId: string, email: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.email, email)))
      .limit(1);
    return row ?? null;
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async createInvite(row: NewInviteRow): Promise<InviteRow> {
    const [created] = await this.db.insert(invites).values(row).returning();
    return created;
  }

  async updateInviteStatus(id: string, status: InviteRow['status']): Promise<InviteRow> {
    const [updated] = await this.db.update(invites).set({ status }).where(eq(invites.id, id)).returning();
    return updated;
  }

  async findPendingInvitesByTrip(tripId: string): Promise<InviteRow[]> {
    return await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.status, 'pending' as any)));
  }
}
