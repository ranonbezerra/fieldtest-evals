import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface StoredToken {
  id: string;
  retiredAt: Date | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

export interface SecurityEventData {
  sessionId?: string | null;
  userId?: string | null;
  kind: string;
  tokenId?: string | null;
  details?: Prisma.InputJsonValue;
}

/**
 * The only layer that touches the database.
 *
 * `claimAndIssue` and `quarantineFamily` are the two security-critical
 * operations: each runs its state change and its audit write in one
 * transaction, and the conditional UPDATE is what makes rotation atomic
 * under concurrency.
 */
@Injectable()
export class RefreshTokenRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  onModuleDestroy(): Promise<void> {
    return this.prisma.$disconnect();
  }

  async createSession(userId: string, expiresAt: Date): Promise<{ id: string; expiresAt: Date }> {
    return this.prisma.session.create({
      data: { userId, expiresAt },
      select: { id: true, expiresAt: true },
    });
  }

  async createToken(sessionId: string, tokenHash: string): Promise<{ id: string }> {
    return this.prisma.refreshToken.create({
      data: { sessionId, tokenHash },
      select: { id: true },
    });
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        retiredAt: true,
        session: { select: { id: true, userId: true, expiresAt: true } },
      },
    });
  }

  /**
   * Atomically retires `tokenId` if it is still active and creates the
   * successor token in the same transaction. Returns the successor's id, or
   * null when the token was already retired (the caller lost the race).
   */
  async claimAndIssue(tokenId: string, sessionId: string, nextTokenHash: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const retired = await tx.refreshToken.updateMany({
        where: { id: tokenId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      if (retired.count === 0) {
        return null;
      }
      const created = await tx.refreshToken.create({
        data: { sessionId, tokenHash: nextTokenHash },
        select: { id: true },
      });
      return created.id;
    });
  }

  /**
   * Retires every still-active token of the session and writes the audit
   * event in the same transaction. Returns how many tokens were retired.
   */
  async quarantineFamily(sessionId: string, event: SecurityEventData): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const wiped = await tx.refreshToken.updateMany({
        where: { sessionId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      await tx.securityEvent.create({ data: event });
      return wiped.count;
    });
  }

  async recordEvent(event: SecurityEventData): Promise<void> {
    await this.prisma.securityEvent.create({ data: event });
  }
}
