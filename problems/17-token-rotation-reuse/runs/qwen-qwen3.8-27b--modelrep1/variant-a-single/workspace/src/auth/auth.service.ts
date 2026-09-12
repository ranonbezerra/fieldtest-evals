import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthRepository } from './auth.repository.js';

/** Injection token for the pre-existing access-token issuer. */
export const ACCESS_TOKEN_ISSUER = 'AUTH_ACCESS_TOKEN_ISSUER';
/** Injection token for the system clock (overridden in tests). */
export const SYSTEM_CLOCK = 'AUTH_SYSTEM_CLOCK';
/** Injection token for refresh-rotation settings. */
export const REFRESH_CONFIG = 'AUTH_REFRESH_CONFIG';

export type Clock = () => Date;

export interface RefreshConfig {
  /**
   * A retired token presented within this many milliseconds of its
   * retirement is treated as a benign in-flight retry, not as a reuse.
   */
  reuseGraceMs: number;
}

/**
 * The only successful shape the caller ever sees. Every failure is the
 * identical `{ ok: false }`, so the controller can answer every rejection
 * with one indistinguishable response.
 */
export type RefreshOutcome =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      viaCookie: boolean;
      sessionExpiresAt: Date;
    }
  | { ok: false };

/** Refresh tokens are 256 random bits, base64url-encoded (43 chars). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored only as SHA-256 digests. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly issueAccessToken: (userId: string) => string,
    @Inject(SYSTEM_CLOCK) private readonly clock: Clock,
    @Inject(REFRESH_CONFIG) private readonly config: RefreshConfig,
  ) {}

  /**
   * Rotate one refresh token. Check order (see SECURITY.md):
   * 1 shape -> 2 existence -> 3 retirement/reuse -> 4 absolute deadline
   * -> 5 atomic rotation.
   */
  async refresh(presented: string, viaCookie: boolean): Promise<RefreshOutcome> {
    const now = this.clock();

    // 1 — Shape: reject before anything touches the database.
    if (!TOKEN_PATTERN.test(presented)) {
      await this.repository.recordEvent({
        eventType: 'malformed',
        tokenHash: hashRefreshToken(presented),
        occurredAt: now,
      });
      return { ok: false };
    }

    const tokenHash = hashRefreshToken(presented);

    // 2 — Existence.
    const token = await this.repository.findTokenByHash(tokenHash);
    if (!token) {
      await this.repository.recordEvent({
        eventType: 'unknown',
        tokenHash,
        occurredAt: now,
      });
      return { ok: false };
    }

    const { session } = token;

    // 3 — Retirement. Checked *before* expiry: a retired token is evidence
    // of compromise even if the session has also lapsed.
    if (token.status === 'retired') {
      const ageMs = now.getTime() - (token.retiredAt ? token.retiredAt.getTime() : 0);
      if (ageMs <= this.config.reuseGraceMs) {
        // Benign in-flight retry: a concurrent copy of a request that just
        // rotated this token. Reject it, but do not punish the session.
        await this.repository.recordEvent({
          eventType: 'concurrent_duplicate',
          tokenId: token.id,
          sessionId: session.id,
          userId: session.userId,
          tokenHash: token.tokenHash,
          occurredAt: now,
        });
        return { ok: false };
      }
      // A genuine replay: invalidate the whole lineage from the sign-in.
      await this.repository.invalidateSession(session.id, now);
      await this.repository.recordEvent({
        eventType: 'reuse_detected',
        tokenId: token.id,
        sessionId: session.id,
        userId: session.userId,
        tokenHash: token.tokenHash,
        occurredAt: now,
      });
      return { ok: false };
    }

    // 4 — Absolute deadline, fixed at sign-in, never extended by rotation.
    if (now.getTime() >= session.expiresAt.getTime()) {
      await this.repository.recordEvent({
        eventType: 'expired',
        tokenId: token.id,
        sessionId: session.id,
        userId: session.userId,
        tokenHash: token.tokenHash,
        occurredAt: now,
      });
      return { ok: false };
    }

    // 5 — Atomic rotation: retire-and-mint as one compare-and-swap.
    const refreshToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(refreshToken);
    const result = await this.repository.rotateToken({
      tokenId: token.id,
      newTokenHash,
      retiredAt: now,
    });

    if (!result.rotated) {
      // Lost the race, or the session was revoked concurrently.
      await this.repository.recordEvent({
        eventType: result.sessionRevokedAt ? 'reuse_detected' : 'concurrent_duplicate',
        tokenId: token.id,
        sessionId: session.id,
        userId: session.userId,
        tokenHash: token.tokenHash,
        occurredAt: now,
      });
      return { ok: false };
    }

    await this.repository.recordEvent({
      eventType: 'rotation',
      tokenId: result.newTokenId,
      sessionId: session.id,
      userId: session.userId,
      tokenHash: newTokenHash,
      occurredAt: now,
    });

    return {
      ok: true,
      accessToken: this.issueAccessToken(session.userId),
      refreshToken,
      viaCookie,
      sessionExpiresAt: session.expiresAt,
    };
  }
}
