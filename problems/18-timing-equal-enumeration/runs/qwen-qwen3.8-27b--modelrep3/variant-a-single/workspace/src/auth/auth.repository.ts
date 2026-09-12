import { Inject, Injectable } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuthAccount {
  id: string;
  email: string;
  passwordHash: string;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<AuthAccount | null> {
    return this.prisma.user
      .findUnique({ where: { email } })
      .then((user) =>
        user === null
          ? null
          : { id: user.id, email: user.email, passwordHash: user.passwordHash },
      );
  }

  // Resolves to true when this call created the account, false when a
  // concurrent sign-up already took the address.
  createAccount(email: string, passwordHash: string): Promise<boolean> {
    return this.prisma.user
      .create({ data: { email, passwordHash } })
      .then(
        () => true,
        (error: unknown) => {
          if (isUniqueConstraintViolation(error)) return false;
          throw error;
        },
      );
  }

  // Bumps updated_at without changing any other column. Called on the
  // existing-address branch so that every sign-up performs exactly one
  // write, keeping the branches' database cost indistinguishable.
  touch(id: string): Promise<void> {
    return this.prisma.user
      .update({ where: { id }, data: { updatedAt: new Date() } })
      .then(() => undefined);
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';
}
