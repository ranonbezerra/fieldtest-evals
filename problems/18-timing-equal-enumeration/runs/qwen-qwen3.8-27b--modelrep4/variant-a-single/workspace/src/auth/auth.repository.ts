import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Insert-if-absent. sign-up calls this on *both* branches, so the database
   * work is the same whether or not the address exists. If a concurrent
   * request inserted the address between the SELECT and this INSERT, the
   * unique violation is expected and the existing row is kept.
   */
  async createOrKeep(email: string, passwordHash: string): Promise<void> {
    try {
      await this.prisma.user.create({ data: { email, passwordHash } });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
    }
  }
}
