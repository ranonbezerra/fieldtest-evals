import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users, type NewUserRow, type UserRow } from '../../../drizzle/schema.js';
import { DB, type Db } from '../../db/db.module.js';

/**
 * The only file in this module that imports Drizzle or the schema.
 * It returns row types; mapping to entities is the service's job.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  async insert(row: NewUserRow): Promise<UserRow> {
    const [created] = await this.db.insert(users).values(row).returning();
    return created;
  }
}
