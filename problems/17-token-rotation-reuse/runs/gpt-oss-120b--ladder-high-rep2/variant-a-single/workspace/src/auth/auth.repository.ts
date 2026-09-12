import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RefreshToken, RefreshTokenAudit } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  /**
   * Atomically retires a token only if it has not been retired yet.
   * Returns the number of rows updated (0 or 1).
   */
  async retireActiveToken(tokenId: number, retiredAt: Date): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, retiredAt: null },
      data: { retiredAt },
    });
    return result.count;
  }

  /**
   * Invalidates (retires) all active tokens belonging to the same root family.
   * Returns the number of rows updated.
   */
  async invalidateFamily(rootId: number, invalidatedAt: Date): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { rootId, retiredAt: null },
      data: { retiredAt: invalidatedAt },
    });
    return result.count;
  }

  async createRefreshToken(data: {
    token: string;
    userId: number;
    parentId?: number | null;
    rootId?: number | null;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        token: data.token,
        userId: data.userId,
        parentId: data.parentId ?? undefined,
        rootId: data.rootId ?? undefined,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
      },
    });
  }

  async createAuditEvent(data: {
    tokenId?: number | null;
    userId?: number | null;
    type: string;
    details: any;
  }): Promise<RefreshTokenAudit> {
    return this.prisma.refreshTokenAudit.create({
      data: {
        tokenId: data.tokenId ?? undefined,
        userId: data.userId ?? undefined,
        event: data.type,
        details: data.details,
      },
    });
  }
}
