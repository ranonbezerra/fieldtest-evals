import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * DI token for the PrismaClient instance. The repository is the only layer
 * that touches the database; the client is injected so tests can substitute
 * it.
 */
export const PRISMA_CLIENT = 'PRISMA_CLIENT';

export interface TokenRecord {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
}

export interface IssuedToken {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface FamilyRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SecurityEventInput {
  id: string;
  kind: string;
  reason: string | null;
  userId: string | null;
  familyId: string | null;
  tokenId: string | null;
  source: string | null;
  details: Record<string, unknown>;
  occurredAt: Date;
}

export type RotateOutcome = { status: 'rotated'; issuedId: string } | { status: 'lost' };

@Injectable()
export class AuthRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  findByHash(tokenHash: string): Promise<TokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  findById(id: string): Promise<TokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { id } });
  }

  createSession(input: { family: FamilyRecord; token: IssuedToken }): Promise<void> {
    return this.prisma
      .$transaction([
        this.prisma.refreshTokenFamily.create({ data: input.family }),
        this.prisma.refreshToken.create({ data: input.token }),
      ])
      .then(() => undefined);
  }

  /**
   * Atomically retires the presented token and issues its successor.
   *
   * The retirement is a single conditional UPDATE that only matches a token
   * that is still live. Postgres serialises concurrent updates on the same
   * row, so exactly one caller can change it; everyone else gets count 0 and
   * a `lost` outcome, which the caller resolves by re-reading the row.
   */
  rotate(input: { presentedId: string; issued: IssuedToken }): Promise<RotateOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const retired = await tx.refreshToken.updateMany({
        where: {
          id: input.presentedId,
          retiredAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { retiredAt: now, replacedById: input.issued.id },
      });
      if (retired.count !== 1) {
        return { status: 'lost' as const };
      }
      await tx.refreshToken.create({ data: input.issued });
      // One-live-token-per-family invariant: any other token this family
      // still marks live (e.g. the other of the two accepted input channels)
      // is superseded by the new one.
      await tx.refreshToken.updateMany({
        where: {
          familyId: input.issued.familyId,
          id: { not: input.issued.id },
          retiredAt: null,
          revokedAt: null,
        },
        data: { retiredAt: now },
      });
      return { status: 'rotated' as const, issuedId: input.issued.id };
    });
  }

  /**
   * Revokes an entire family — every token descended from one sign-in — in a
   * single statement over the family id, not a per-token walk.
   */
  revokeFamily(familyId: string, at: Date): Promise<{ newlyRevokedTokens: number; familyAlreadyRevoked: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const tokens = await tx.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at },
      });
      const family = await tx.refreshTokenFamily.updateMany({
        where: { id: familyId, revokedAt: null },
        data: { revokedAt: at },
      });
      return { newlyRevokedTokens: tokens.count, familyAlreadyRevoked: family.count === 0 };
    });
  }

  recordEvent(event: SecurityEventInput): Promise<void> {
    return this.prisma.securityEvent.create({
      data: { ...event, details: event.details as Prisma.InputJsonValue },
    }).then(() => undefined);
  }
}
