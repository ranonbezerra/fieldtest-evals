import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  trips,
  tripMembers,
  invites,
  type NewTripRow,
  type TripRow,
  type NewInviteRow,
  type InviteRow,
  type NewMemberRow,
  type MemberRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

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

  async insertMember(row: NewMemberRow): Promise<MemberRow> {
    const [created] = await this.db.insert(tripMembers).values(row).returning();
    return created;
  }

  async findMemberByTripAndUser(tripId: string, userId: string): Promise<MemberRow | null> {
    const [row] = await this.db
      .select()
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async isMember(tripId: string, userId: string): Promise<boolean> {
    const member = await this.findMemberByTripAndUser(tripId, userId);
    return !!member;
  }

  async findMembers(tripId: string): Promise<MemberRow[]> {
    return await this.db.select().from(tripMembers).where(eq(tripMembers.tripId, tripId));
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
        and(eq(invites.tripId, tripId), eq(invites.email, email), eq(invites.status, 'pending')),
      )
      .limit(1);
    return row ?? null;
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async updateInviteStatus(id: string, status: 'pending' | 'accepted' | 'declined'): Promise<void> {
    await this.db.update(invites).set({ status }).where(eq(invites.id, id));
  }

  async findPendingInvites(tripId: string): Promise<InviteRow[]> {
    return await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.status, 'pending')));
  }
}
