import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  verificationToken: string | null;
  createdAt: Date;
}

// The repository is the only layer that touches the database. The client
// reads DATABASE_URL from the environment; nothing is hardcoded.
@Injectable()
export class AuthRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async findByEmail(email: string): Promise<StoredUser | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row === null ? null : { ...row };
  }

  async createUser(email: string, passwordHash: string, verificationToken: string): Promise<StoredUser> {
    const row = await this.prisma.user.create({
      data: { email, passwordHash, verificationToken },
    });
    return { ...row };
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
