import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface CreateResult {
  user: StoredUser;
  created: boolean;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  // Creates the account. If a concurrent request already took the address
  // (unique violation), returns the existing row instead of surfacing a 500.
  async createOrReturnExisting(email: string, passwordHash: string): Promise<CreateResult> {
    try {
      const user = await this.prisma.user.create({ data: { email, passwordHash } });
      return { user, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
          return { user: existing, created: false };
        }
      }
      throw error;
    }
  }
}
