import { Injectable } from '@nestjs/common';
// ASSUMPTION: DrizzleService is exported from src/common/drizzle.service.ts and exposes a getDb() method returning NodePgDatabase<typeof schema>. The module could not be resolved at compile time; adjust the path/export if the scaffold uses a different name.
import { DrizzleService } from '../../common/drizzle.service.js';
import { pgTable, serial, integer, text, timestamp, varchar, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql, eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Trip } from './entities/trip.entity.js';
import type { TripMember, MemberRole } from './entities/trip-member.entity.js';
import type { TripInvite, InviteStatus } from './entities/trip-invite.entity.js';

// ─── Drizzle schema ────────────────────────────────────────────────────────

export const trips = pgTable('trips', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  destination: text('destination').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tripMembers = pgTable(
  'trip_members',
  {
    id: serial('id').primaryKey(),
    tripId: integer('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uqTripUser: uniqueIndex('uq_trip_members_trip_id_user_id').on(table.tripId, table.userId),
  }),
);

export const tripInvites = pgTable('trip_invites', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  status: text('status').notNull().default('pending'),
  invitedBy: integer('invited_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { trips, tripMembers, tripInvites };

type Db = NodePgDatabase<typeof schema>;

// ─── Repository interface ──────────────────────────────────────────────────

export interface TripsRepository {
  create(
    data: { name: string; destination: string; startDate: Date; endDate: Date },
    creatorId: number,
  ): Promise<Trip>;
  findById(id: number): Promise<Trip | null>;
  addMember(tripId: number, userId: number, role: MemberRole): Promise<TripMember>;
  isMember(tripId: number, userId: number): Promise<boolean>;
  getMembers(tripId: number): Promise<TripMember[]>;
  findPendingInviteByTripAndEmail(tripId: number, email: string): Promise<TripInvite | null>;
  createInvite(tripId: number, email: string, token: string, invitedBy: number): Promise<TripInvite>;
  findInviteByToken(token: string): Promise<TripInvite | null>;
  updateInviteStatus(id: number, status: InviteStatus): Promise<TripInvite>;
  getPendingInvites(tripId: number): Promise<TripInvite[]>;
  findUserByEmail(email: string): Promise<{ id: number; email: string } | null>;
}

// ─── Row mappers ───────────────────────────────────────────────────────────

function toTrip(row: typeof trips.$inferSelect): Trip {
  return {
    id: row.id,
    name: row.name,
    destination: row.destination,
    startDate: row.startDate,
    endDate: row.endDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTripMember(row: typeof tripMembers.$inferSelect): TripMember {
  return {
    id: row.id,
    tripId: row.tripId,
    userId: row.userId,
    role: row.role as MemberRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTripInvite(row: typeof tripInvites.$inferSelect): TripInvite {
  return {
    id: row.id,
    tripId: row.tripId,
    email: row.email,
    token: row.token,
    status: row.status as InviteStatus,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Implementation ────────────────────────────────────────────────────────

@Injectable()
export class TripsRepository implements TripsRepository {
  constructor(private readonly drizzleService: DrizzleService) {}

  private get db(): Db {
    return this.drizzleService.getDb() as Db;
  }

  async create(
    data: { name: string; destination: string; startDate: Date; endDate: Date },
    creatorId: number,
  ): Promise<Trip> {
    const db = this.db;
    const [trip] = await db.transaction(async (tx: Db) => {
      const [row] = await tx.insert(trips).values({
        name: data.name,
        destination: data.destination,
        startDate: data.startDate,
        endDate: data.endDate,
      }).returning();

      await tx.insert(tripMembers).values({
        tripId: row.id,
        userId: creatorId,
        role: 'owner',
      });

      return row;
    });

    return toTrip(trip);
  }

  async findById(id: number): Promise<Trip | null> {
    const rows = await this.db.select().from(trips).where(eq(trips.id, id));
    return rows.length > 0 ? toTrip(rows[0]) : null;
  }

  async addMember(tripId: number, userId: number, role: MemberRole): Promise<TripMember> {
    const [row] = await this.db
      .insert(tripMembers)
      .values({ tripId, userId, role })
      .returning();
    return toTripMember(row);
  }

  async isMember(tripId: number, userId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: tripMembers.id })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)));
    return rows.length > 0;
  }

  async getMembers(tripId: number): Promise<TripMember[]> {
    const rows = await this.db
      .select()
      .from(tripMembers)
      .where(eq(tripMembers.tripId, tripId));
    return rows.map(toTripMember);
  }

  async findPendingInviteByTripAndEmail(tripId: number, email: string): Promise<TripInvite | null> {
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
    return rows.length > 0 ? toTripInvite(rows[0]) : null;
  }

  async createInvite(
    tripId: number,
    email: string,
    token: string,
    invitedBy: number,
  ): Promise<TripInvite> {
    const [row] = await this.db
      .insert(tripInvites)
      .values({ tripId, email, token, invitedBy })
      .returning();
    return toTripInvite(row);
  }

  async findInviteByToken(token: string): Promise<TripInvite | null> {
    const rows = await this.db.select().from(tripInvites).where(eq(tripInvites.token, token));
    return rows.length > 0 ? toTripInvite(rows[0]) : null;
  }

  async updateInviteStatus(id: number, status: InviteStatus): Promise<TripInvite> {
    const [row] = await this.db
      .update(tripInvites)
      .set({ status, updatedAt: new Date() })
      .where(eq(tripInvites.id, id))
      .returning();
    return toTripInvite(row);
  }

  async getPendingInvites(tripId: number): Promise<TripInvite[]> {
    const rows = await this.db
      .select()
      .from(tripInvites)
      .where(and(eq(tripInvites.tripId, tripId), eq(tripInvites.status, 'pending')));
    return rows.map(toTripInvite);
  }

  async findUserByEmail(email: string): Promise<{ id: number; email: string } | null> {
    // ASSUMPTION: The users table lives in a separate module's schema and is not imported here; a raw query avoids a cross-module schema dependency.
    const result = await this.db.execute(
      sql`SELECT id, email FROM users WHERE email = ${email} LIMIT 1`,
    );
    const rows = result.rows as unknown as Array<{ id: number; email: string }>;
    return rows.length > 0 ? rows[0] : null;
  }
}
