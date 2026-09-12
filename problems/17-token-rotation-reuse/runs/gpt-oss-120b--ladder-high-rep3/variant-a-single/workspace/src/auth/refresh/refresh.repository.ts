import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Session, RefreshToken } from '@prisma/client';
import { generateRandomToken, hashToken } from './refresh.utils.js';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  /**
   * Attempts an atomic rotation:
   * - Retires the presented token only if it is still live.
   * - Issues a brand‑new refresh token linked to the same session.
   * Returns null if the token could not be retired (already retired,
   * expired, or a concurrent rotation succeeded).
   */
  async tryRotate(tokenHash: string): Promise<{ newRefreshToken: string; session: Session } | null> {
    const now = new Date();

    return this.prisma.$transaction(async (tx: any) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (!token) {
        return null;
      }

      // Abort if token is already retired or expired
      if (token.retiredAt !== null || token.expiresAt <= now) {
        return null;
      }

      // Conditional update – only succeeds if the token is still live
      const updateResult = await tx.refreshToken.updateMany({
        where: {
          id: token.id,
          retiredAt: null,
          expiresAt: { gt: now },
        },
        data: {
          retiredAt: now,
        },
      });

      if (updateResult.count === 0) {
        // Another concurrent request succeeded first
        return null;
      }

      // Issue a fresh token with the same absolute expiry
      const newPlainToken = generateRandomToken();
      const newTokenHash = hashToken(newPlainToken);
      await tx.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          sessionId: token.sessionId,
          expiresAt: token.expiresAt,
        },
      });

      // Retrieve the session to issue an access token
      const session = await tx.session.findUnique({
        where: { id: token.sessionId },
      });

      if (!session) {
        throw new Error('Session not found during token rotation');
      }

      return { newRefreshToken: newPlainToken, session };
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        retiredAt: null,
      },
      data: {
        retiredAt: now,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { compromisedAt: now },
    });
  }

  async audit(event: string, details: any): Promise<void> {
    await this.prisma.tokenAudit.create({
      data: {
        event,
        details,
        tokenHash: details?.tokenHash ?? undefined,
        sessionId: details?.sessionId ?? undefined,
      },
    });
  }
}
