import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer } from './access-token.provider.js';
import { AuthRepository } from './auth.repository.js';
import { RefreshRejectedError } from './refresh-rejected.error.js';

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Sliding lifetime of one refresh token (seconds, env, default 1 h). */
const REFRESH_TOKEN_TTL_MS = (Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 3600) * 1000;
/**
 * Absolute lifetime of a session (seconds, env, default 30 d). Fixed once, at
 * sign-in, on the family; rotation can never extend it.
 */
const SESSION_ABSOLUTE_TTL_MS = (Number(process.env.SESSION_ABSOLUTE_TTL_SECONDS) || 2_592_000) * 1000;

const MAX_TOKEN_LENGTH = 512;
/** Our tokens are 48 random bytes in base64url; anything else is malformed. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly accessTokens: AccessTokenIssuer,
  ) {}

  /**
   * Sign-in seam (the wider system already has sign-in; this is the hook it
   * calls): creates the family with its absolute deadline fixed here and mints
   * the first refresh token.
   */
  async beginSession(userId: string): Promise<RefreshResult> {
    const now = new Date();
    const refreshToken = this.mintToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    await this.repository.createSession({
      userId,
      token: refreshToken,
      expiresAt,
      absoluteExpiryAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
    });
    return {
      accessToken: this.accessTokens.issueAccessToken(userId),
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /**
   * Rotates one presented refresh token. Every failure cause — malformed,
   * unknown, expired, reuse — funnels through the single `reject()` below, so
   * the response is identical to the caller; only the audit record differs.
   */
  async refresh(presented: unknown): Promise<RefreshResult> {
    const now = new Date();
    const token = typeof presented === 'string' ? presented : '';

    // 1. Malformed: rejected before any database access.
    if (!this.isWellFormed(token)) {
      await this.repository.recordAuditEvent({
        at: now,
        cause: 'malformed',
        detail: { length: token.length },
      });
      return this.reject();
    }

    // 2. Reuse, checked as the write: one conditional UPDATE retires the token
    //    only if it is live, unexpired, and in an unrevoked family. The
    //    database serialises concurrent claims on the row, so exactly one of N
    //    concurrent presentations wins.
    const claimed = await this.repository.claim(token, now);
    if (!claimed) {
      return this.classifyLostClaim(token, now);
    }

    // 3. Winner: mint the successor into the same family, so the absolute
    //    deadline is inherited, never extended.
    const refreshToken = this.mintToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    const successorId = await this.repository.issueSuccessor(claimed.family.id, refreshToken, expiresAt);

    await this.repository.recordAuditEvent({
      at: now,
      cause: 'rotated',
      familyId: claimed.family.id,
      userId: claimed.family.userId,
      detail: { tokenId: claimed.id, successorId },
    });

    return {
      accessToken: this.accessTokens.issueAccessToken(claimed.family.userId),
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /**
   * A lost claim means this token did not rotate. Reading it back tells us why:
   * no row is `unknown`; retired, revoked, or family-revoked is `reuse` (checked
   * before expiry, on purpose — a token both retired and expired is an attack
   * signal, not a routine expiry); still live means a deadline passed, `expired`.
   */
  private async classifyLostClaim(token: string, now: Date): Promise<never> {
    const record = await this.repository.findByToken(token);
    if (!record) {
      await this.repository.recordAuditEvent({ at: now, cause: 'unknown', detail: {} });
      return this.reject();
    }

    const { family } = record;
    if (record.retired || record.revoked || family.revokedAt !== null) {
      // Reuse: retire the whole family in one operation, then audit it.
      await this.repository.revokeFamily(family.id, now);
      await this.repository.recordAuditEvent({
        at: now,
        cause: 'reuse',
        familyId: family.id,
        userId: family.userId,
        detail: {
          tokenId: record.id,
          state: record.revoked ? 'revoked' : record.retired ? 'retired' : 'family_revoked',
        },
      });
      return this.reject();
    }

    // Live and unrevoked, so the claim failed on a deadline.
    await this.repository.recordAuditEvent({
      at: now,
      cause: 'expired',
      familyId: family.id,
      userId: family.userId,
      detail: { tokenId: record.id, deadline: record.expiresAt <= now ? 'token' : 'family' },
    });
    return this.reject();
  }

  private isWellFormed(token: string): boolean {
    return token.length > 0 && token.length <= MAX_TOKEN_LENGTH && TOKEN_PATTERN.test(token);
  }

  private mintToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private reject(): never {
    throw new RefreshRejectedError();
  }
}
