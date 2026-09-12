import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { RefreshToken, AuditLog, Prisma } from '@prisma/client';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { token } });
  }

  /**
   * Atomically retires a token if it is still active and not expired.
   * Returns true if the row was updated (i.e., the token was retired now).
   */
  async retireIfActive(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id,
        retiredAt: null,
        invalidatedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        retiredAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        familyId,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: new Date(),
      },
    });
  }

  async createRefreshToken(data: {
    token: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        token: data.token,
        userId: data.userId,
        familyId: data.familyId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async logAudit(
    eventType: string,
    details: Prisma.JsonValue,
    tokenId?: string,
    userId?: string,
  ): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        eventType,
        details,
        tokenId,
        userId,
      },
    });
  }
}
