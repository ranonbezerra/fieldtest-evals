import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module.js';
import {
  trips,
  type NewTripRow,
  type TripRow,
  members,
  type NewMemberRow,
  type MemberRow,
  invites,
  type NewInviteRow,
  type InviteRow,
} from '../../../drizzle/schema.js';

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

  async addMember(row: NewMemberRow): Promise<MemberRow> {
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

  async listMembers(tripId: string): Promise<MemberRow[]> {
    return await this.db.select().from(members).where(eq(members.tripId, tripId));
  }

  async findPendingInvite(tripId: string, email: string): Promise<InviteRow | null> {
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

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  async createInvite(row: NewInviteRow): Promise<InviteRow> {
    const [created] = await this.db.insert(invites).values(row).returning();
    return created;
  }

  async updateInviteStatus(token: string, status: 'accepted' | 'declined'): Promise<InviteRow> {
    const [updated] = await this.db
      .update(invites)
      .set({ status })
      .where(eq(invites.token, token))
      .returning();
    return updated;
  }

  async listPendingInvites(tripId: string): Promise<InviteRow[]> {
    return await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.status, 'pending' as any)));
  }
}
