import { Injectable } from '@nestjs/common';
import { Prisma, TokenStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';

/** A refresh token row as the rest of the app consumes it. */
export interface StoredToken {
  id: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: Date;
  retiredAt: Date | null;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuditInput {
  event: string;
  userId?: string;
  sessionId?: string;
  tokenId?: string;
  details: Record<string, unknown>;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the session and its first (initial) refresh token atomically. */
  async createSessionWithInitialToken(input: {
    userId: string;
    expiresAt: Date;
    tokenHash: string;
  }): Promise<SessionRecord> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.refreshSession.create({
        data: { userId: input.userId, expiresAt: input.expiresAt },
      });
      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
      return session;
    });
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Atomically retires `tokenId` if — and only if — it is still active and its
   * absolute deadline has not passed. A single conditional UPDATE: Postgres
   * row locking guarantees that exactly one concurrent caller can win.
   */
  async claimActiveToken(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, status: TokenStatus.ACTIVE, expiresAt: { gt: now } },
      data: { status: TokenStatus.RETIRED, retiredAt: now },
    });
    return result.count > 0;
  }

  /**
   * Compromise handling: retires every active token in the session and marks
   * the session revoked. Returns how many tokens were invalidated.
   */
  async invalidateSession(sessionId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.refreshToken.updateMany({
        where: { sessionId, status: TokenStatus.ACTIVE },
        data: { status: TokenStatus.RETIRED, retiredAt: now },
      });
      await tx.refreshSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      return result.count;
    });
  }

  /** Mints the next token in the session's chain, inheriting the absolute deadline. */
  async createRotatedToken(input: {
    sessionId: string;
    userId: string;
    expiresAt: Date;
    tokenHash: string;
  }): Promise<StoredToken> {
    return this.prisma.refreshToken.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.prisma.authAuditEvent.create({
      data: {
        event: input.event,
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        tokenId: input.tokenId ?? null,
        details: input.details as Prisma.InputJsonValue,
      },
    });
  }
}
