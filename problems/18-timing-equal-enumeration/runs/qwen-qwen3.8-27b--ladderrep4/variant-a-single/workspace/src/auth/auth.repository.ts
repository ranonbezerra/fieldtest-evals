import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface StoredUser {
  email: string;
  passwordHash: string;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({ where: { email } }).then((user) =>
      user === null ? null : { email: user.email, passwordHash: user.passwordHash },
    );
  }

  async createIfAbsent(email: string, passwordHash: string): Promise<{ created: boolean }> {
    try {
      await this.prisma.user.create({ data: { email, passwordHash } });
      return { created: true };
    } catch (error) {
      // Losing the unique-email constraint means the address already exists;
      // that is the equal-cost "no account created" outcome, not an error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { created: false };
      }
      throw error;
    }
  }
}
