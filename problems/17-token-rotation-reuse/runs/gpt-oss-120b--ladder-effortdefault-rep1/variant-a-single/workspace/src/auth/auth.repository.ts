import { Injectable } from '@nestjs/common';
import {
  PrismaClient,
  RefreshToken,
  RefreshTokenFamily,
} from '@prisma/client';

export interface TokenWithFamily {
  token: string;
  id: string;
  userId: string;
  retiredAt: Date | null;
  expiresAt: Date;
  family: RefreshTokenFamily;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTokenWithFamily(token: string): Promise<TokenWithFamily | null> {
    const rt = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { family: true },
    });
    if (!rt) return null;
    return {
      token: rt.token,
      id: rt.id,
      userId: rt.userId,
      retiredAt: rt.retiredAt,
      expiresAt: rt.expiresAt,
      family: rt.family,
    };
  }

  async retireTokenIfLive(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id: tokenId,
        retiredAt: null,
        expiresAt: { gt: now },
      },
      data: { retiredAt: now },
    });
    return result.count === 1;
  }

  async invalidateFamily(familyId: string, now: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshTokenFamily.updateMany({
        where: { id: familyId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          familyId,
          retiredAt: null,
        },
        data: { retiredAt: now },
      }),
    ]);
  }

  async createRefreshToken(data: {
    token: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        token: data.token,
        familyId: data.familyId,
        userId: data.userId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async recordAudit(event: {
    token?: string;
    familyId?: string;
    userId?: string;
    event: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.refreshTokenAudit.create({
      data: {
        token: event.token,
        familyId: event.familyId,
        userId: event.userId,
        event: event.event,
        details: event.details as any,
      },
    });
  }
}
