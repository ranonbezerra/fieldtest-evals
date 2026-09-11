import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** DI token for the shared Prisma client. */
export const PRISMA_CLIENT = 'PRISMA_CLIENT';

type RefreshTokenWithFamily = Prisma.RefreshTokenGetPayload<{ include: { family: true } }>;

export interface SessionSeed {
  userId: string;
  token: string;
  expiresAt: Date;
  absoluteExpiryAt: Date;
}

export interface AuditEventInput {
  at: Date;
  cause: 'rotated' | 'reuse' | 'expired' | 'unknown' | 'malformed';
  familyId?: string;
  userId?: string;
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /** Sign-in: create the family (with its fixed absolute deadline) and the first token. */
  async createSession(seed: SessionSeed): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const family = await tx.refreshFamily.create({
        data: { userId: seed.userId, absoluteExpiryAt: seed.absoluteExpiryAt },
      });
      await tx.refreshToken.create({
        data: { token: seed.token, familyId: family.id, expiresAt: seed.expiresAt },
      });
    });
  }

  /** Read a token with its family; null when the token is unknown. */
  async findByToken(token: string): Promise<RefreshTokenWithFamily | null> {
    return this.prisma.refreshToken.findUnique({ where: { token }, include: { family: true } });
  }

  /**
   * The rotation claim: one conditional UPDATE that retires the token only if
   * it is still live — not retired, not revoked, within its sliding expiry, and
   * inside the family's absolute deadline in an unrevoked family. Concurrent
   * claims on the same token serialise on the row lock, so exactly one caller
   * changes a row. Returns the claimed token with its family, or null.
   */
  async claim(token: string, now: Date): Promise<RefreshTokenWithFamily | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: {
          token,
          retired: false,
          revoked: false,
          expiresAt: { gt: now },
          family: { absoluteExpiryAt: { gt: now }, revokedAt: null },
        },
        data: { retired: true, retiredAt: now },
      });
      if (result.count !== 1) {
        return null;
      }
      return tx.refreshToken.findUnique({ where: { token }, include: { family: true } });
    });
  }

  /**
   * Mint the successor into the same family, so the absolute deadline is
   * inherited, never extended. A successor minted into an already-revoked
   * family is inert: the claim requires an unrevoked family, and any
   * presentation of it is classified as reuse.
   */
  async issueSuccessor(familyId: string, token: string, expiresAt: Date): Promise<string> {
    const created = await this.prisma.refreshToken.create({
      data: { token, familyId, expiresAt },
    });
    return created.id;
  }

  /** Invalidate every token descended from the family in one operation. */
  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshFamily.updateMany({
        where: { id: familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { familyId, revoked: false },
        data: { revoked: true, revokedAt: now },
      });
    });
  }

  /** Write one audit record; the client never sees this distinction. */
  async recordAuditEvent(event: AuditEventInput): Promise<void> {
    await this.prisma.refreshAuditEvent.create({
      data: {
        familyId: event.familyId ?? null,
        userId: event.userId ?? null,
        cause: event.cause,
        detail: (event.detail ?? {}) as Prisma.InputJsonValue,
        occurredAt: event.at,
      },
    });
  }
}
