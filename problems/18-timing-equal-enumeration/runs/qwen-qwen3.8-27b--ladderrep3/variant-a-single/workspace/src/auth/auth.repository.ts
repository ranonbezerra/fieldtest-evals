import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** A user record as the auth feature sees it. */
export interface StoredUser {
  email: string;
  passwordHash: string;
}

/** The unique email constraint rejected an insert (a concurrent win). */
export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists.`);
    this.name = 'EmailAlreadyExistsError';
  }
}

/** The only layer that touches the database. */
@Injectable()
export class AuthRepository implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  findByEmail(email: string): Promise<StoredUser | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(email: string, passwordHash: string): Promise<StoredUser> {
    try {
      return await this.prisma.user.create({ data: { email, passwordHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // A concurrent request created the account first. Map it to the
        // domain error so the service takes the "address exists" branch and
        // the caller sees the same response.
        throw new EmailAlreadyExistsError(email);
      }
      throw err;
    }
  }
}
