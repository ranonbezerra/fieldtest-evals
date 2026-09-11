import { Injectable } from '@nestjs/common';
import { AuditEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type AuditReason =
  | 'refresh_rotated'
  | 'refresh_reused'
  | 'refresh_expired'
  | 'refresh_unknown'
  | 'refresh_malformed';

export interface StoredRefreshToken {
  id: string;
  token: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuditEntry {
  reason: AuditReason;
  familyId?: string;
  tokenId?: string;
  userId?: string;
  providedText?: string | null;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the token family and its first token for a new sign-in. */
  createSession(userId: string, token: string, expiresAt: Date): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const family = await tx.tokenFamily.create({ data: { userId, expiresAt } });
      await tx.refreshToken.create({
        data: { token, familyId: family.id, userId, expiresAt },
      });
      return family.id;
    });
  }

  findByToken(token: string): Promise<StoredRefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { token } }).then((row) => (row ? { ...row } : null));
  }

  /**
   * Atomic rotation. Retires the presented token only if it is still live
   * (revoked_at IS NULL) and inserts its successor in the same family with the
   * same absolute deadline. The conditional UPDATE takes the row lock and is
   * the serialization point: exactly one concurrent caller can retire the
   * token; everyone else matches zero rows and rolls back.
   */
  rotate(
    presented: string,
    successor: string,
    familyId: string,
    userId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const retired = await tx.refreshToken.updateMany({
        where: { token: presented, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (retired.count !== 1) {
        return false;
      }
      await tx.refreshToken.create({ data: { token: successor, familyId, userId, expiresAt } });
      return true;
    });
  }

  /** Invalidates the family and every token descended from it. One statement each, no walk. */
  async revokeFamily(familyId: string): Promise<void> {
    const now = new Date();
    await this.prisma.tokenFamily.updateMany({
      where: { id: familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  recordAudit(entry: AuditEntry): Promise<AuditEvent> {
    return this.prisma.auditEvent.create({ data: entry });
  }
}
