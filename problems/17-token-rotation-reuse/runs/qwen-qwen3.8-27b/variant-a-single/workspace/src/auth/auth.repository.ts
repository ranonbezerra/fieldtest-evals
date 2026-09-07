import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { RefreshFamily, RefreshToken } from '@prisma/client';

/** Prisma interactive-transaction client handed through the repository. */
export type DbTx = Prisma.TransactionClient;

/**
 * The only layer that touches the database. Every method runs on the
 * transaction passed in by the service, so a whole use case shares one
 * Postgres transaction.
 */
@Injectable()
export class AuthRepository implements OnModuleDestroy {
  // ASSUMPTION: the app-level PrismaModule/PrismaService is not part of this
  // deliverable, so the repository owns its PrismaClient; a full app would
  // inject a shared client here instead.
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Runs `work` inside one Postgres transaction (READ COMMITTED). */
  async withTransaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { timeout: 5_000 });
  }

  findRefreshTokenByHash(tokenHash: string, tx: DbTx): Promise<RefreshToken | null> {
    return tx.refreshToken.findUnique({ where: { tokenHash } });
  }

  createFamily(data: { userId: string; expiresAt: Date }, tx: DbTx): Promise<RefreshFamily> {
    return tx.refreshFamily.create({ data });
  }

  createToken(
    data: { id?: string; familyId: string; userId: string; tokenHash: string; expiresAt: Date },
    tx: DbTx,
  ): Promise<RefreshToken> {
    return tx.refreshToken.create({
      data: {
        familyId: data.familyId,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        ...(data.id !== undefined ? { id: data.id } : {}),
      },
    });
  }

  /**
   * Atomic compare-and-swap: retires the token only if it is still active.
   * Returns true when this call made the retirement.
   */
  async retireActiveToken(
    id: string,
    patch: { retiredAt: Date; replacedBy: string },
    tx: DbTx,
  ): Promise<boolean> {
    const result = await tx.refreshToken.updateMany({
      where: { id, retired: false },
      data: { retired: true, retiredAt: patch.retiredAt, replacedBy: patch.replacedBy },
    });
    return result.count === 1;
  }

  /**
   * Marks the family revoked and retires every still-active token in it.
   * Returns true when the family was already revoked.
   */
  async revokeFamily(familyId: string, now: Date, tx: DbTx): Promise<boolean> {
    const claimed = await tx.refreshFamily.updateMany({
      where: { id: familyId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
    if (claimed.count === 0) {
      return true;
    }
    await tx.refreshToken.updateMany({
      where: { familyId, retired: false },
      data: { retired: true, retiredAt: now },
    });
    return false;
  }

  recordAudit(
    event: {
      familyId: string | null;
      userId: string | null;
      tokenId: string | null;
      reason: string;
      details: Record<string, string | number | boolean>;
    },
    tx: DbTx,
  ): Promise<void> {
    return tx.tokenAuditEvent
      .create({
        data: {
          familyId: event.familyId,
          userId: event.userId,
          tokenId: event.tokenId,
          reason: event.reason,
          details: event.details,
        },
      })
      .then(() => undefined);
  }
}
