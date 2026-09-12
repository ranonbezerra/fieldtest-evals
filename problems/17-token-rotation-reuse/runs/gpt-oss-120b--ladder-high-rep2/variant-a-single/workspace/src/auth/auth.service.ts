import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { issueAccessToken } from '../utils/token';
import { RefreshToken } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  // Single envelope for all refresh token rejections.
  private static readonly REJECTION_ENVELOPE = {
    error: {
      code: 'invalid_refresh_token',
      message: 'Invalid refresh token',
      details: {}
    }
  };

  constructor(private readonly repository: AuthRepository) {}

  private reject(): never {
    throw new HttpException(AuthService.REJECTION_ENVELOPE, HttpStatus.UNAUTHORIZED);
  }

  async refresh(rawToken: string | undefined): Promise<{ accessToken: string; refreshToken: string }> {
    const now = new Date();

    // 1. Validate token format (simple UUID check)
    if (!rawToken || typeof rawToken !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(rawToken)) {
      await this.repository.createAuditEvent({
        tokenId: null,
        userId: null,
        type: 'malformed',
        details: { token: rawToken }
      });
      this.reject();
    }

    // 2. Load token record
    const tokenRecord = await this.repository.findByToken(rawToken);
    if (!tokenRecord) {
      await this.repository.createAuditEvent({
        tokenId: null,
        userId: null,
        type: 'unknown',
        details: { token: rawToken }
      });
      this.reject();
    }

    // 3. Reuse check (retired tokens are treated as compromise)
    if (tokenRecord.retiredAt) {
      await this.handleReuse(tokenRecord, now);
    }

    // 4. Expiration check (after reuse as required by spec)
    if (tokenRecord.expiresAt < now) {
      await this.repository.createAuditEvent({
        tokenId: tokenRecord.id,
        userId: tokenRecord.userId,
        type: 'expired',
        details: {}
      });
      this.reject();
    }

    // 5. Attempt atomic rotation: retire the token only if it is still active
    const rowsUpdated = await this.repository.retireActiveToken(tokenRecord.id, now);
    if (rowsUpdated === 0) {
      // Token was retired concurrently – treat as reuse.
      await this.handleReuse(tokenRecord, now);
    }

    // 6. Rotation succeeded – issue a new refresh token
    const newRefreshToken = randomUUID();
    const rootId = tokenRecord.rootId ?? tokenRecord.id;

    await this.repository.createRefreshToken({
      token: newRefreshToken,
      userId: tokenRecord.userId,
      parentId: tokenRecord.id,
      rootId,
      issuedAt: now,
      expiresAt: tokenRecord.expiresAt // absolute deadline unchanged
    });

    await this.repository.createAuditEvent({
      tokenId: tokenRecord.id,
      userId: tokenRecord.userId,
      type: 'rotated',
      details: { newToken: newRefreshToken }
    });

    const accessToken = issueAccessToken(tokenRecord.userId);
    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Handles a reuse detection: records audit and invalidates the entire token family.
   * Always rejects the request with the generic envelope.
   */
  private async handleReuse(tokenRecord: RefreshToken, now: Date): Promise<never> {
    const rootId = tokenRecord.rootId ?? tokenRecord.id;
    // Invalidate all active tokens in the family
    await this.repository.invalidateFamily(rootId, now);

    await this.repository.createAuditEvent({
      tokenId: tokenRecord.id,
      userId: tokenRecord.userId,
      type: 'reuse',
      details: {}
    });
    this.reject();
  }
}
