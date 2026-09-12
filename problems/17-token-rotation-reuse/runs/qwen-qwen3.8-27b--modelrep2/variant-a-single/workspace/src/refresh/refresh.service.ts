import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { issueAccessToken } from '../auth/access-token.js';
import { RefreshTokenRepository } from './refresh.repository.js';
import type { SecurityEventData, StoredToken } from './refresh.repository.js';

/** DI token for the clock, so tests can drive "now" deterministically. */
export const REFRESH_CLOCK = Symbol('REFRESH_CLOCK');

/**
 * Thrown for every rejected presentation, whatever the reason. The
 * controller maps it to one fixed 401 envelope, so no rejection kind is
 * distinguishable to the caller; the audit event kind is what tells them
 * apart.
 */
export class RefreshRejectedError extends Error {
  constructor() {
    super('The presented refresh token was rejected.');
    this.name = 'RefreshRejectedError';
  }
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Structural shape of an issued refresh token: `rt_` + 32 random bytes, base64url. */
const REFRESH_TOKEN_PATTERN = /^rt_[A-Za-z0-9_-]{43}$/;

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionTtlMs(): number {
  const seconds = Number(process.env.REFRESH_SESSION_TTL_SECONDS);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.trunc(seconds) * 1000;
  }
  return DEFAULT_SESSION_TTL_SECONDS * 1000;
}

@Injectable()
export class RefreshService {
  constructor(
    @Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository,
    @Inject(REFRESH_CLOCK) private readonly now: () => Date,
  ) {}

  /**
   * Called once per sign-in by the existing sign-in flow. Fixes the absolute
   * deadline of the session; rotation never extends it.
   */
  async issueSession(userId: string): Promise<IssuedSession> {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs());
    const session = await this.tokens.createSession(userId, expiresAt);
    const refreshToken = generateRefreshToken();
    const token = await this.tokens.createToken(session.id, sha256Hex(refreshToken));
    await this.tokens.recordEvent({
      kind: 'session_issued',
      sessionId: session.id,
      userId,
      tokenId: token.id,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return {
      sessionId: session.id,
      accessToken: issueAccessToken(userId),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotates the presented refresh token.
   *
   * Check order (see SECURITY.md): malformed -> unknown -> expired ->
   * retired (reuse) -> atomic claim. Every rejection throws the same
   * RefreshRejectedError; only the audit kind differs.
   */
  async refresh(presented: unknown): Promise<RefreshResult> {
    const now = this.now();

    // 1. Shape. Garbage is rejected before it can cost a database round trip.
    if (typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_malformed',
        details: { length: typeof presented === 'string' ? presented.length : null },
      });
      throw new RefreshRejectedError();
    }

    // 2. Existence, by digest.
    const presentedHash = sha256Hex(presented);
    const record = await this.tokens.findTokenByHash(presentedHash);
    if (record === null) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_unknown',
        details: { tokenHash: presentedHash },
      });
      throw new RefreshRejectedError();
    }

    // 3. Absolute deadline, fixed at sign-in. Runs before the retired check
    //    so that a stale client after natural death is not treated as
    //    compromise.
    if (now.getTime() >= record.session.expiresAt.getTime()) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_expired',
        sessionId: record.session.id,
        userId: record.session.userId,
        tokenId: record.id,
        details: { expiresAt: record.session.expiresAt.toISOString() },
      });
      throw new RefreshRejectedError();
    }

    // 4. Reuse. A retired token in a caller's hand is compromise.
    if (record.retiredAt !== null) {
      await this.quarantineFamily(record, 'presented_retired');
      throw new RefreshRejectedError();
    }

    // 5. Atomic claim: exactly one concurrent caller can win.
    const nextToken = generateRefreshToken();
    const nextTokenId = await this.tokens.claimAndIssue(record.id, record.session.id, sha256Hex(nextToken));
    if (nextTokenId === null) {
      // Lost the race: by the time we claimed, the token was already retired,
      // which is indistinguishable from a stolen-token replay.
      await this.quarantineFamily(record, 'concurrent_presentation');
      throw new RefreshRejectedError();
    }

    await this.tokens.recordEvent({
      kind: 'refresh_reissued',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: nextTokenId,
      details: { retiredTokenId: record.id },
    });

    return {
      accessToken: issueAccessToken(record.session.userId),
      refreshToken: nextToken,
    };
  }

  /**
   * Invalidate every token descended from the same sign-in and record the
   * detection in the same transaction.
   */
  private async quarantineFamily(record: StoredToken, detectedVia: string): Promise<void> {
    const event: SecurityEventData = {
      kind: 'refresh_reuse_detected',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: record.id,
      details: { detectedVia },
    };
    await this.tokens.quarantineFamily(record.session.id, event);
  }
}
