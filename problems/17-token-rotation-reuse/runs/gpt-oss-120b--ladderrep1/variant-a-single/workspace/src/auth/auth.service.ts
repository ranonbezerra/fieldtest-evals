import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { issueAccessToken } from '../utils/token.utils.js';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  private static readonly REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  constructor(private readonly repo: AuthRepository) {}

  async refresh(presentedToken: string) {
    const now = new Date();

    if (!presentedToken) {
      await this.repo.recordAudit({
        token: presentedToken,
        event: 'malformed',
        details: { reason: 'empty token' },
      });
      throw new Error('malformed');
    }

    const tokenRecord = await this.repo.findTokenWithFamily(presentedToken);
    if (!tokenRecord) {
      await this.repo.recordAudit({
        token: presentedToken,
        event: 'unknown',
        details: { reason: 'token not found' },
      });
      throw new Error('unknown');
    }

    const { token, family, userId } = tokenRecord;

    const isRetired = tokenRecord.retiredAt !== null;
    const familyRevoked = family?.revokedAt !== null;

    if (isRetired || familyRevoked) {
      await this.repo.invalidateFamily(family.id, now);
      await this.repo.recordAudit({
        token,
        familyId: family.id,
        userId,
        event: 'reuse',
        details: {
          reason: isRetired ? 'token already retired' : 'family revoked',
        },
      });
      throw new Error('reuse');
    }

    const retired = await this.repo.retireTokenIfLive(tokenRecord.id, now);
    if (!retired) {
      await this.repo.invalidateFamily(family.id, now);
      await this.repo.recordAudit({
        token,
        familyId: family.id,
        userId,
        event: 'reuse',
        details: { reason: 'concurrent rotation detected' },
      });
      throw new Error('reuse');
    }

    if (tokenRecord.expiresAt < now) {
      await this.repo.recordAudit({
        token,
        familyId: family.id,
        userId,
        event: 'expired',
        details: { reason: 'token past its expiry' },
      });
      throw new Error('expired');
    }

    const absoluteDeadline = family.absoluteExpiresAt;
    const maxExpiry = new Date(
      Math.min(
        now.getTime() + AuthService.REFRESH_TTL_MS,
        absoluteDeadline.getTime(),
      ),
    );

    const newRefreshToken = randomUUID();
    await this.repo.createRefreshToken({
      token: newRefreshToken,
      familyId: family.id,
      userId,
      expiresAt: maxExpiry,
    });

    const accessToken = issueAccessToken(userId);

    await this.repo.recordAudit({
      token,
      familyId: family.id,
      userId,
      event: 'rotated',
      details: {
        newRefreshToken,
        newExpiresAt: maxExpiry.toISOString(),
      },
    });

    return { accessToken, newRefreshToken };
  }
}
