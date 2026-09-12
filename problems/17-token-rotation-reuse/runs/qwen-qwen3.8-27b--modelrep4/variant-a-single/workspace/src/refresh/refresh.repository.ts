import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, RefreshToken } from '@prisma/client';

export type RefreshAttemptResult =
  | { outcome: 'rotated'; userId: string; tokenId: string }
  | { outcome: 'unknown' }
  | { outcome: 'expired' }
  | { outcome: 'retired' };

@Injectable()
export class RefreshTokenRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async recordMalformed(): Promise<void> {
    const now = new Date();

    await this.prisma.refreshAudit.create({
      data: {
        event: 'refresh_rejected',
        reason: 'malformed',
        createdAt: now,
        details: {},
      },
    });
  }

  async processRefreshAttempt(
    tokenHash: string,
    nextTokenHash: string,
  ): Promise<RefreshAttemptResult> {
    return this.prisma.$transaction<RefreshAttemptResult>(async (tx) => {
      const now = new Date();
      const token = await tx.refreshToken.findUnique({ where: { tokenHash } });

      if (!token) {
        await tx.refreshAudit.create({
          data: {
            event: 'refresh_rejected',
            reason: 'unknown',
            createdAt: now,
            details: {},
          },
        });

        return { outcome: 'unknown' };
      }

      if (token.retiredAt !== null || token.reusedAt !== null) {
        await this.applyReuse(tx, token, new Date());
        return { outcome: 'retired' };
      }

      if (token.expiresAt.getTime() <= now.getTime()) {
        await tx.refreshAudit.create({
          data: {
            event: 'refresh_rejected',
            reason: 'expired',
            tokenId: token.id,
            familyId: token.familyId,
            userId: token.userId,
            createdAt: now,
            details: {},
          },
        });

        return { outcome: 'expired' };
      }

      const claimNow = new Date();
      const claimed = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          retiredAt: null,
          reusedAt: null,
          expiresAt: { gt: claimNow },
        },
        data: { retiredAt: claimNow },
      });

      if (claimed.count === 1) {
        const created = await tx.refreshToken.create({
          data: {
            tokenHash: nextTokenHash,
            userId: token.userId,
            familyId: token.familyId,
            predecessorId: token.id,
            createdAt: claimNow,
            expiresAt: token.expiresAt,
          },
        });

        await tx.refreshAudit.create({
          data: {
            event: 'refresh_rotated',
            reason: 'rotated',
            tokenId: created.id,
            familyId: token.familyId,
            userId: token.userId,
            createdAt: claimNow,
            details: { predecessorId: token.id },
          },
        });

        return { outcome: 'rotated', userId: token.userId, tokenId: created.id };
      }

      const current = await tx.refreshToken.findUnique({ where: { id: token.id } });

      if (!current) {
        const fallbackNow = new Date();
        await tx.refreshAudit.create({
          data: {
            event: 'refresh_rejected',
            reason: 'unknown',
            createdAt: fallbackNow,
            details: {},
          },
        });

        return { outcome: 'unknown' };
      }

      if (current.retiredAt !== null || current.reusedAt !== null) {
        await this.applyReuse(tx, current, new Date());
        return { outcome: 'retired' };
      }

      if (current.expiresAt.getTime() <= claimNow.getTime()) {
        await tx.refreshAudit.create({
          data: {
            event: 'refresh_rejected',
            reason: 'expired',
            tokenId: current.id,
            familyId: current.familyId,
            userId: current.userId,
            createdAt: claimNow,
            details: {},
          },
        });

        return { outcome: 'expired' };
      }

      const fallbackNow = new Date();
      await tx.refreshAudit.create({
        data: {
          event: 'refresh_rejected',
          reason: 'unknown',
          tokenId: current.id,
          familyId: current.familyId,
          userId: current.userId,
          createdAt: fallbackNow,
          details: {},
        },
      });

      return { outcome: 'unknown' };
    });
  }

  private async applyReuse(
    tx: Prisma.TransactionClient,
    token: RefreshToken,
    now: Date,
  ): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { familyId: token.familyId, retiredAt: null },
      data: { retiredAt: now },
    });

    await tx.refreshToken.updateMany({
      where: { familyId: token.familyId, reusedAt: null },
      data: { reusedAt: now },
    });

    await tx.refreshAudit.create({
      data: {
        event: 'reuse_detected',
        reason: 'retired',
        tokenId: token.id,
        familyId: token.familyId,
        userId: token.userId,
        createdAt: now,
        details: {},
      },
    });
  }
}
