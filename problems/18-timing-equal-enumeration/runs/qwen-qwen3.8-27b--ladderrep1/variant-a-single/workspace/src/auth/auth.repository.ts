import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Creates the account unless a concurrent request already did. The unique
   * constraint is the source of truth, so the loser of a race reports
   * created=false instead of surfacing a 500 — which would both fail the
   * request and reveal that the address existed.
   */
  async createIfAbsent(email: string, passwordHash: string): Promise<boolean> {
    try {
      await this.prisma.user.create({ data: { email, passwordHash } });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
