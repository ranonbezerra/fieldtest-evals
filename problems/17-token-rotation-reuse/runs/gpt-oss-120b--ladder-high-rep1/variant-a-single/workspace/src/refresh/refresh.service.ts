import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository.js';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception.js';
import { issueAccessToken } from '../auth/token.utils.js';
import * as crypto from 'crypto';
import { RefreshToken } from '@prisma/client';

@Injectable()
export class RefreshService {
  constructor(private readonly refreshRepo: RefreshRepository) {}

  async refresh(refreshTokenValue: string): Promise<{ accessToken: string; refreshToken: string }> {
    const token = await this.refreshRepo.findByToken(refreshTokenValue);
    if (!token) {
      await this.refreshRepo.logAudit('unknown_token', { presentedToken: refreshTokenValue });
      throw new InvalidRefreshTokenException();
    }

    // 1️⃣ Reuse detection (invalidated family) – must be checked before anything else
    if (token.invalidatedAt) {
      await this.refreshRepo.logAudit('reuse', {
        reason: 'already_invalidated',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 2️⃣ Token already retired (reuse of a rotated token)
    if (token.retiredAt) {
      await this.refreshRepo.logAudit('reuse', {
        reason: 'already_retired',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 3️⃣ Expiry check – after reuse checks to satisfy “reuse before expiry”
    const now = new Date();
    if (token.expiresAt <= now) {
      await this.refreshRepo.logAudit('expired_token', { tokenId: token.id, userId: token.userId });
      throw new InvalidRefreshTokenException();
    }

    // 4️⃣ Atomic retirement – ensures exactly one concurrent rotation succeeds
    const retired = await this.refreshRepo.retireIfActive(token.id);
    if (!retired) {
      // Token was retired concurrently → treat as reuse
      await this.refreshRepo.logAudit('reuse', {
        reason: 'concurrent_retirement',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 5️⃣ Successful rotation – create a fresh token with the same absolute deadline
    const newTokenValue = crypto.randomBytes(32).toString('hex');
    await this.refreshRepo.createRefreshToken({
      token: newTokenValue,
      userId: token.userId,
      familyId: token.familyId,
      expiresAt: token.expiresAt, // absolute deadline unchanged
    });

    const accessToken = issueAccessToken(token.userId);
    return { accessToken, refreshToken: newTokenValue };
  }
}
