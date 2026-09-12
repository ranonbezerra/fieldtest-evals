import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  invites,
  memberships,
  trips,
  users,
  type InviteRow,
  type MembershipRow,
  type TripRow,
  type UserRow,
} from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The trip row and the creator's owner membership are written atomically. */
  async createTripWithOwner(input: {
    id: string;
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
    ownerId: string;
  }): Promise<{ trip: TripRow; owner: MembershipRow }> {
    return this.db.transaction(async (tx) => {
      const [trip] = await tx
        .insert(trips)
        .values({
          id: input.id,
          name: input.name,
          destination: input.destination,
          startDate: input.startDate,
          endDate: input.endDate,
        })
        .returning();

      const [owner] = await tx
        .insert(memberships)
        .values({
          id: randomUUID(),
          tripId: trip.id,
          userId: input.ownerId,
          role: 'owner',
        })
        .returning();

      return { trip, owner };
    });
  }

  async findTripById(id: string): Promise<TripRow | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  async findMembership(tripId: string, userId: string): Promise<MembershipRow | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tripId, tripId), eq(memberships.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Case-insensitive on purpose: invite emails are normalised, but member
   * emails are whatever the user registered with.
   */
  async findMembershipByEmail(tripId: string, email: string): Promise<MembershipRow | null> {
    const rows = await this.db
      .select({ membership: memberships, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.tripId, tripId));
    const match = rows.find((row) => row.email.toLowerCase() === email.toLowerCase());
    return match ? match.membership : null;
  }

  async addMembership(tripId: string, userId: string, role: 'owner' | 'member'): Promise<MembershipRow> {
    const [row] = await this.db
      .insert(memberships)
      .values({ id: randomUUID(), tripId, userId, role })
      .returning();
    return row;
  }

  // Members always have a user row, so the inner join never drops one.
  async listMembers(tripId: string): Promise<Array<{ membership: MembershipRow; user: UserRow }>> {
    return this.db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.tripId, tripId));
  }

  async findInviteByToken(token: string): Promise<InviteRow | null> {
    const [row] = await this.db.select().from(invites).where(eq(invites.token, token)).limit(1);
    return row ?? null;
  }

  // Invite emails are stored lower-cased (normalised by the DTO), so exact match is safe.
  async findInvite(tripId: string, email: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.email, email)))
      .limit(1);
    return row ?? null;
  }

  async createInvite(input: { id: string; tripId: string; email: string; token: string }): Promise<InviteRow> {
    const [row] = await this.db
      .insert(invites)
      .values({
        id: input.id,
        tripId: input.tripId,
        email: input.email,
        token: input.token,
        status: 'pending',
      })
      .returning();
    return row;
  }

  async updateInviteStatus(id: string, status: 'pending' | 'accepted' | 'declined'): Promise<InviteRow> {
    const [row] = await this.db
      .update(invites)
      .set({ status, updatedAt: new Date() })
      .where(eq(invites.id, id))
      .returning();
    return row;
  }

  async listPendingInvites(tripId: string): Promise<InviteRow[]> {
    return this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tripId, tripId), eq(invites.status, 'pending')));
  }
}
