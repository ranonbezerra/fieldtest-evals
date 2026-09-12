import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, RefreshToken, Session } from '@prisma/client';

export interface StoredSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface StoredToken {
  id: string;
  tokenHash: string;
  status: 'active' | 'retired';
  retiredAt: Date | null;
  session: StoredSession;
}

export type AuditEventType =
  | 'rotation'
  | 'reuse_detected'
  | 'concurrent_duplicate'
  | 'expired'
  | 'unknown'
  | 'malformed';

export interface AuditEventInput {
  eventType: AuditEventType;
  occurredAt: Date;
  userId?: string | null;
  tokenId?: string | null;
  sessionId?: string | null;
  tokenHash?: string | null;
}

export type RotateOutcome =
  | { rotated: true; newTokenId: string }
  | { rotated: false; sessionRevokedAt: Date | null };

function mapSession(s: Session): StoredSession {
  return { id: s.id, userId: s.userId, expiresAt: s.expiresAt, revokedAt: s.revokedAt };
}

function mapToken(t: RefreshToken & { session: Session }): StoredToken {
  return {
    id: t.id,
    tokenHash: t.tokenHash,
    status: t.status,
    retiredAt: t.retiredAt,
    session: mapSession(t.session),
  };
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates the session (and, implicitly, its fixed absolute deadline). */
  async createSession(userId: string, expiresAt: Date): Promise<StoredSession> {
    const session = await this.prisma.session.create({ data: { userId, expiresAt } });
    return mapSession(session);
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });
    return token ? mapToken(token) : null;
  }

  /**
   * Retires `tokenId` and mints its successor in one transaction. The
   * retirement is a compare-and-swap on `status = 'active'`, so at most one
   * concurrent caller can win; the loser receives `rotated: false` plus the
   * session's revocation state so the caller can classify the outcome.
   */
  async rotateToken(args: {
    tokenId: string;
    newTokenHash: string;
    retiredAt: Date;
  }): Promise<RotateOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { id: args.tokenId },
        select: { sessionId: true },
      });
      if (!existing) {
        return { rotated: false as const, sessionRevokedAt: null };
      }

      const cas = await tx.refreshToken.updateMany({
        where: { id: args.tokenId, status: 'active' },
        data: { status: 'retired', retiredAt: args.retiredAt },
      });
      if (cas.count === 0) {
        const session = await tx.session.findUnique({
          where: { id: existing.sessionId },
          select: { revokedAt: true },
        });
        return { rotated: false as const, sessionRevokedAt: session?.revokedAt ?? null };
      }

      const successor = await tx.refreshToken.create({
        data: {
          id: randomUUID(),
          sessionId: existing.sessionId,
          tokenHash: args.newTokenHash,
        },
      });
      await tx.refreshToken.update({
        where: { id: args.tokenId },
        data: { replacedByTokenId: successor.id },
      });
      return { rotated: true as const, newTokenId: successor.id };
    });
  }

  /**
   * Compromise response: revokes the session and retires every active token
   * descended from its sign-in, atomically.
   */
  async invalidateSession(sessionId: string, at: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: at } }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, status: 'active' },
        data: { status: 'retired', retiredAt: at },
      }),
    ]);
  }

  async recordEvent(event: AuditEventInput): Promise<void> {
    await this.prisma.tokenAuditEvent.create({
      data: {
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        userId: event.userId ?? null,
        tokenId: event.tokenId ?? null,
        sessionId: event.sessionId ?? null,
        tokenHash: event.tokenHash ?? null,
      },
    });
  }
}
