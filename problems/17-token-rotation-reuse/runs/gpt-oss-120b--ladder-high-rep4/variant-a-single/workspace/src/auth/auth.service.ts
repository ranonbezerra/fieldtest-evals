import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { issueAccessToken } from '../utils/token.js';
import { RefreshToken } from '@prisma/client';

/**
 * Specific error used internally to indicate a failure of the refresh flow.
 * The controller deliberately hides the concrete `code` from the client.
 */
class RefreshTokenError extends Error {
  constructor(public readonly code: string, public readonly details: any = {}) {
    super(code);
  }
}

/**
 * AuthService contains the business logic for refresh‑token rotation.
 * It performs the following steps (in order):
 *
 * 1. Input validation (malformed token).
 * 2. Lookup the token record.
 * 3. Reuse detection (token already revoked) – this is checked *before* expiry.
 * 4. Expiry check.
 * 5. Atomic retirement of the presented token.
 * 6. On success: issue a new refresh token (same family, same absolute deadline)
 *    and a new access token.
 * 7. On any failure: record an audit event and throw a `RefreshTokenError`.
 *
 * All audit events are logged via `recordAudit`. In production this would be
 * persisted to a dedicated audit store; for the purpose of this exercise a
 * simple `console.log` is sufficient.
 */
@Injectable()
export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Performs a refresh‑token rotation.
   *
   * @param tokenString The raw refresh token supplied by the client.
   * @returns An object containing a fresh access token and a fresh refresh token.
   * @throws RefreshTokenError on any validation, lookup, or rotation failure.
   */
  async refresh(
    tokenString: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. Input validation (malformed token)
    if (!tokenString || typeof tokenString !== 'string') {
      this.recordAudit('malformed_token', { token: tokenString });
      throw new RefreshTokenError('malformed_token');
    }

    // 2. Lookup token record
    const tokenRecord: RefreshToken | null =
      await this.authRepository.findByToken(tokenString);
    const now = new Date();

    if (!tokenRecord) {
      // Unknown token
      this.recordAudit('unknown_token', { token: tokenString });
      throw new RefreshTokenError('unknown_token');
    }

    // 3. Reuse detection (token already revoked) – checked before expiry
    if (tokenRecord.revoked) {
      await this.authRepository.revokeFamilyTokens(
        tokenRecord.familyId,
        now,
      );
      this.recordAudit('reuse_revoked_token', {
        token: tokenString,
        userId: tokenRecord.userId,
        familyId: tokenRecord.familyId,
      });
      throw new RefreshTokenError('token_revoked');
    }

    // 4. Expiry check (only after confirming the token is not already revoked)
    if (tokenRecord.expiresAt <= now) {
      this.recordAudit('expired_token', {
        token: tokenString,
        userId: tokenRecord.userId,
      });
      throw new RefreshTokenError('token_expired');
    }

    // 5. Atomic retirement of the presented token
    const retired = await this.authRepository.revokeIfActive(
      tokenRecord.id,
      now,
    );

    if (!retired) {
      // The token was retired between the lookup and this point – treat as reuse.
      await this.authRepository.revokeFamilyTokens(
        tokenRecord.familyId,
        now,
      );
      this.recordAudit('reuse_concurrent_token', {
        token: tokenString,
        userId: tokenRecord.userId,
      });
      throw new RefreshTokenError('token_revoked');
    }

    // 6. Successful rotation – issue a new refresh token with the *same* absolute deadline.
    const newRefresh = await this.authRepository.createRefreshToken(
      tokenRecord.userId,
      tokenRecord.familyId,
      tokenRecord.expiresAt,
    );

    const accessToken = issueAccessToken(tokenRecord.userId);

    this.recordAudit('refresh_success', {
      userId: tokenRecord.userId,
      oldToken: tokenString,
      newToken: newRefresh.token,
      familyId: tokenRecord.familyId,
    });

    return {
      accessToken,
      refreshToken: newRefresh.token,
    };
  }

  /**
   * Simple audit hook – in a real system this would write to a structured audit
   * store. For the purpose of the exercise we use `console.log`.
   *
   * @param event A short string identifying the audit event.
   * @param details Arbitrary JSON‑serialisable data giving context.
   */
  private recordAudit(event: string, details: any): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, details }));
  }
}
