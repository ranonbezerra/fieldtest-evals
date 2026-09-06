import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, AuditEventType } from '@prisma/client';
import * as crypto from 'node:crypto';

export type RejectionReason = 'unknown' | 'expired';

export interface TokenRecord {
  id: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  retiredAt: Date | null;
}

export interface UserRef {
  userId: string;
}

export type RepositoryRefreshResult =
  | { outcome: 'rotated'; newToken: TokenRecord; user: UserRef }
  | { outcome: 'rejected'; reason: RejectionReason; tokenRecord?: TokenRecord }
  | { outcome: 'reuse'; familyId: string };

/** Sentinel for audit rows where the token was never found and no family can be determined. */
const UNKNOWN_FAMILY_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Atomically locks the token row by hash, evaluates its state, and either
   * rotates it (retire + create successor) or records a rejection / reuse.
   * All DB work happens inside a single interactive transaction.
   */
  async executeRefresh(tokenHash: string): Promise<RepositoryRefreshResult> {
    return this.prisma.$transaction(async (tx) => {
      // Row-level lock serialises concurrent callers on the same token.
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          family_id: string;
          user_id: string;
          expires_at: Date;
          retired_at: Date | null;
        }>
      >(
        Prisma.sql`
          SELECT id, family_id, user_id, expires_at, retired_at
          FROM refresh_tokens
          WHERE token_hash = ${tokenHash}
          FOR UPDATE
        `,
      );

      // --- Unknown token -----------------------------------------------
      if (rows.length === 0) {
        await this.recordAudit(tx, UNKNOWN_FAMILY_ID, undefined, AuditEventType.REJECTED_UNKNOWN);
        return { outcome: 'rejected' as const, reason: 'unknown' as const };
      }

      const row = rows[0];

      // --- Reuse (retired) — checked before expired --------------------
      if (row.retired_at !== null) {
        await this.invalidateFamily(tx, row.family_id);
        await this.recordAudit(tx, row.family_id, row.id, AuditEventType.REUSE_COMPROMISE);
        return { outcome: 'reuse' as const, familyId: row.family_id };
      }

      // --- Expired -------------------------------------------------------
      if (row.expires_at < new Date()) {
        await this.recordAudit(tx, row.family_id, row.id, AuditEventType.REJECTED_EXPIRED);
        return {
          outcome: 'rejected' as const,
          reason: 'expired' as const,
          tokenRecord: {
            id: row.id,
            familyId: row.family_id,
            userId: row.user_id,
            expiresAt: row.expires_at,
            retiredAt: row.retired_at,
          },
        };
      }

      // --- Active & unexpired → rotate ----------------------------------
      const newToken = await this.retireAndCreate(tx, {
        id: row.id,
        family_id: row.family_id,
        user_id: row.user_id,
        expires_at: row.expires_at,
      });

      await this.recordAudit(tx, row.family_id, newToken.id, AuditEventType.ROTATED);

      return {
        outcome: 'rotated' as const,
        newToken,
        user: { userId: row.user_id },
      };
    });
  }

  // ─── Private helpers (not part of the module boundary) ───────────────

  /**
   * Retires the current token row and creates its successor in the same
   * family. The successor inherits the absolute deadline (`expires_at`).
   */
  private async retireAndCreate(
    tx: Prisma.TransactionClient,
    row: { id: string; family_id: string; user_id: string; expires_at: Date },
  ): Promise<TokenRecord> {
    // Retire first so that a crash after this point leaves no active token.
    await tx.refreshToken.update({
      where: { id: row.id },
      data: { retiredAt: new Date() },
    });

    const newRawToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');

    const newRow = await tx.refreshToken.create({
      data: {
        tokenHash: newTokenHash,
        familyId: row.family_id,
        userId: row.user_id,
        expiresAt: row.expires_at,
      },
    });

    return {
      id: newRow.id,
      familyId: newRow.familyId,
      userId: newRow.userId,
      expiresAt: newRow.expiresAt,
      retiredAt: newRow.retiredAt,
    };
  }

  /** Marks every still-active token in the family as retired (compromise). */
  private async invalidateFamily(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { familyId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
  }

  /** Inserts an audit-event row inside the caller's transaction. */
  private async recordAudit(
    tx: Prisma.TransactionClient,
    familyId: string,
    tokenId: string | undefined,
    eventType: AuditEventType,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        familyId,
        tokenId: tokenId ?? undefined,
        eventType,
      },
    });
  }
}
