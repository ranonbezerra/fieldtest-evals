import { Injectable } from '@nestjs/common';
import type {
  RefreshAuditReason,
  RefreshToken,
  RefreshTokenSource,
  TokenFamily,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type RefreshTokenWithFamily = RefreshToken & { family: TokenFamily };

export interface NewTokenData {
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export type RotateOutcome =
  | { success: true; retired: RefreshTokenWithFamily; replacement: RefreshToken }
  | { success: false; token: RefreshTokenWithFamily | null };

export interface ReuseAuditData {
  reason: RefreshAuditReason;
  tokenId?: string;
  userId?: string;
  via?: RefreshTokenSource;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  createFamily(userId: string, expiresAt: Date): Promise<TokenFamily> {
    return this.prisma.tokenFamily.create({ data: { userId, expiresAt } });
  }

  createToken(data: NewTokenData): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  findTokenWithFamily(tokenHash: string): Promise<RefreshTokenWithFamily | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { family: true } });
  }

  /**
   * Atomic rotation. The conditional update retires the presented token only
   * while it is still ACTIVE, unexpired and in a live family; PostgreSQL
   * serialises concurrent updates on the row, so at most one caller can ever
   * win. On success the successor token is created in the same transaction.
   */
  rotate(tokenHash: string, candidate: NewTokenData, now: Date): Promise<RotateOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const retired = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          family: { revoked: false },
        },
        data: { status: 'RETIRED', retiredAt: now },
      });

      const fresh = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { family: true } });

      if (retired.count !== 1) {
        // No row was retired: the token was unknown, already retired/revoked,
        // expired, or its family was revoked. The fresh read carries the state.
        return { success: false, token: fresh };
      }

      const replacement = await tx.refreshToken.create({ data: candidate });
      if (fresh) {
        await tx.refreshToken.update({ where: { id: fresh.id }, data: { replacedById: replacement.id } });
      }
      return { success: true, retired: fresh as RefreshTokenWithFamily, replacement };
    });
  }

  /**
   * Reuse handling: revoke every live token in the family and write the audit
   * row in one transaction, so the record of the compromise cannot be lost.
   * Returns how many live tokens were revoked.
   */
  invalidateFamily(familyId: string, now: Date, audit: ReuseAuditData): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { familyId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now },
      });
      await tx.tokenFamily.updateMany({
        where: { id: familyId, revoked: false },
        data: { revoked: true, revokedAt: now },
      });
      await tx.refreshAuditEvent.create({
        data: { ...audit, familyId, tokensRevoked: revoked.count },
      });
      return revoked.count;
    });
  }

  recordAudit(data: {
    reason: RefreshAuditReason;
    tokenId?: string;
    familyId?: string;
    userId?: string;
    via?: RefreshTokenSource;
  }) {
    return this.prisma.refreshAuditEvent.create({ data: { ...data, tokensRevoked: 0 } });
  }
}
