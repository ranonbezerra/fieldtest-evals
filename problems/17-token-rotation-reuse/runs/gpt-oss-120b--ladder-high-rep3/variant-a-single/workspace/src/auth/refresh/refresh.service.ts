import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository.js';
import { RefreshError } from './refresh.error.js';
import { hashToken } from './refresh.utils.js';

// ASSUMPTION: The function issueAccessToken(userId: string): string is globally available.
declare function issueAccessToken(userId: string): string;

@Injectable()
export class RefreshService {
  constructor(private readonly repo: RefreshRepository) {}

  /**
   * Rotates a refresh token.
   * On success returns a fresh access token and a brand‑new refresh token.
   * On failure throws RefreshError with a code that the controller maps to the
   * uniform error envelope.
   */
  async rotate(presentedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashToken(presentedToken);
    const rotationResult = await this.repo.tryRotate(tokenHash);

    if (rotationResult) {
      const accessToken = issueAccessToken(rotationResult.session.userId);
      return { accessToken, refreshToken: rotationResult.newRefreshToken };
    }

    // Rotation could not happen – diagnose the cause
    const tokenRecord = await this.repo.findTokenByHash(tokenHash);
    if (!tokenRecord) {
      await this.repo.audit('unknown_token', { presentedToken });
      throw new RefreshError('unknown_token');
    }

    // Reuse detection: token already retired
    if (tokenRecord.retiredAt) {
      await this.repo.invalidateSession(tokenRecord.sessionId);
      await this.repo.audit('reuse_detected', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('reuse_detected');
    }

    const now = new Date();

    // Expired token (not already retired)
    if (tokenRecord.expiresAt <= now) {
      await this.repo.audit('expired_token', {
        tokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
      });
      throw new RefreshError('expired_token');
    }

    // Any other abnormality is treated as malformed
    await this.repo.audit('malformed_token', { presentedToken });
    throw new RefreshError('malformed_token');
  }
}
