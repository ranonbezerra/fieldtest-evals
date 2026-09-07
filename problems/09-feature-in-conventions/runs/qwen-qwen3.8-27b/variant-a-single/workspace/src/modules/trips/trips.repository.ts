import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import { trips } from './entities/trips.entity';
import { tripMembers } from './entities/trip-members.entity';
import { tripInvites } from './entities/trip-invites.entity';

export interface Trip {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}

export interface TripMember {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
}

export interface TripInvite {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
}

export class TripsRepository {
  private readonly db = drizzle(postgres(process.env.DATABASE_URL!));

  // ASSUMPTION: The single argument passed by the service at line 20 is an object
  // containing the trip fields (name, destination, startDate, endDate), not a
  // separate userId. The owner is added via a subsequent addMember call (line 21).
  async createTrip(input: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
  }): Promise<Trip> {
    const [trip] = await this.db
      .insert(trips)
      .values({
        name: input.name,
        destination: input.destination,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();
    return trip;
  }

  // ASSUMPTION: addMember accepts a role parameter so it can be used for both
  // the owner (at trip creation) and regular members (on invite acceptance).
  async addMember(
    tripId: string,
    userId: string,
    role: 'owner' | 'member',
  ): Promise<void> {
    await this.db
      .insert(tripMembers)
      .values({ tripId, userId, role });
  }

  async findTrip(id: string): Promise<Trip | null> {
    const rows = await this.db.select().from(trips).where(eq(trips.id, id));
    return rows[0] ?? null;
  }

  async isOwner(tripId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(tripMembers)
      .where(
        and(
          eq(tripMembers.tripId, tripId),
          eq(tripMembers.userId, userId),
          eq(tripMembers.role, 'owner'),
        ),
      );
    return rows.length > 0;
  }

  async findMembership(
    tripId: string,
    userId: string,
  ): Promise<TripMember | null> {
    const rows = await this.db
      .select()
      .from(tripMembers)
      .where(
        and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)),
      );
    return rows[0] ?? null;
  }

  async getMembers(tripId: string): Promise<TripMember[]> {
    return this.db
      .select()
      .from(tripMembers)
      .where(eq(tripMembers.tripId, tripId));
  }

  async getPendingInvites(tripId: string): Promise<TripInvite[]> {
    return this.db
      .select()
      .from(tripInvites)
      .where(
        and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')),
      );
  }

  async findPendingInvite(
    tripId: string,
    email: string,
  ): Promise<TripInvite | null> {
    const rows = await this.db
      .select()
      .from(tripInvites)
      .where(
        and(
          eq(tripInvites.tripId, tripId),
          eq(tripInvites.email, email),
          eq(tripInvites.status, 'pending'),
        ),
      );
    return rows[0] ?? null;
  }

  async createInvite(
    tripId: string,
    email: string,
    token: string,
  ): Promise<TripInvite> {
    const [invite] = await this.db
      .insert(tripInvites)
      .values({ tripId, email, token, status: 'pending' })
      .returning();
    return invite;
  }

  async findInviteByToken(token: string): Promise<TripInvite | null> {
    const rows = await this.db
      .select()
      .from(tripInvites)
      .where(eq(tripInvites.token, token));
    return rows[0] ?? null;
  }

  async updateInviteStatus(
    id: string,
    status: 'pending' | 'accepted' | 'declined',
  ): Promise<TripInvite> {
    const [invite] = await this.db
      .update(tripInvites)
      .set({ status })
      .where(eq(tripInvites.id, id))
      .returning();
    return invite;
  }
}
