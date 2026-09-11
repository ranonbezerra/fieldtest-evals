import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

/**
 * The only layer that touches the database.
 */
@Injectable()
export class AuthRepository {
  private readonly prisma = new PrismaClient();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    if (row === null) return null;
    return { id: row.id, email: row.email, passwordHash: row.passwordHash };
  }

  /**
   * @returns true when the row was inserted, false when the email was already
   * taken (lost a unique-constraint race).
   */
  async create(email: string, passwordHash: string): Promise<boolean> {
    try {
      await this.prisma.user.create({ data: { email, passwordHash } });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }
}
