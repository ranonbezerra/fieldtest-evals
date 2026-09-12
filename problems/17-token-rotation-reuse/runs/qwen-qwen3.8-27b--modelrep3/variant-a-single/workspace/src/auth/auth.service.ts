import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer } from './access-token-issuer.js';
import type { StoredToken } from './auth.repository.js';
import { AuthRepository } from './auth.repository.js';

/** Injection token for the clock, so tests can control "now". */
export const CLOCK = 'AUTH_REFRESH_CLOCK';

export type Clock = () => Date;

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: Date }
  | { ok: false };

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_REUSE_GRACE_MS = 5_000;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mintRawToken(): string {
  return randomBytes(32).toString('hex');
}

@Injectable()
export class AuthService {
  private readonly reuseGraceMs: number;

  constructor(
    private readonly repository: AuthRepository,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly accessTokenIssuer: AccessTokenIssuer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    const configured = Number(process.env.REFRESH_REUSE_GRACE_MS);
    this.reuseGraceMs = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_REUSE_GRACE_MS;
  }

  /**
   * Entry point for the existing sign-in flow. `expiresAt` is the absolute
   * session deadline: it is fixed here and every token rotated out of this
   * session inherits it — rotation can never extend it.
   */
  async createSession(
    userId: string,
    expiresAt: Date,
  ): Promise<{ refreshToken: string; expiresAt: Date }> {
    const rawToken = mintRawToken();
    const session = await this.repository.createSessionWithInitialToken({
      userId,
      expiresAt,
      tokenHash: sha256Hex(rawToken),
    });
    await this.repository.recordAudit({
      event: 'session_created',
      userId,
      sessionId: session.id,
      details: {},
    });
    return { refreshToken: rawToken, expiresAt };
  }

  /**
   * Rotates a refresh token: the presented token is retired by the same call
   * that issues its replacement.
   *
   * Check order (see SECURITY.md): malformed → unknown → stale (retired or
   * past the absolute deadline) → atomic claim → rotate. Every rejection
   * returns `{ ok: false }`; the caller cannot tell the rejection classes
   * apart, and the audit trail can.
   */
  async refresh(rawToken: string | undefined): Promise<RefreshOutcome> {
    const now = this.clock();

    if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) {
      await this.repository.recordAudit({
        event: 'rejected_malformed_token',
        details: { reason: typeof rawToken === 'string' ? 'invalid_format' : 'missing_token' },
      });
      return { ok: false };
    }

    const tokenHash = sha256Hex(rawToken);
    const token = await this.repository.findTokenByHash(tokenHash);

    if (!token) {
      await this.repository.recordAudit({ event: 'rejected_unknown_token', details: {} });
      return { ok: false };
    }

    if (token.status === 'RETIRED' || token.expiresAt.getTime() <= now.getTime()) {
      await this.rejectStaleToken(token, now);
      return { ok: false };
    }

    const claimed = await this.repository.claimActiveToken(token.id, now);
    if (!claimed) {
      // Lost the race to a concurrent rotation (or the deadline passed
      // mid-flight). Re-read for the authoritative state before classifying.
      const fresh = await this.repository.findTokenByHash(tokenHash);
      if (fresh) {
        await this.rejectStaleToken(fresh, now);
      } else {
        await this.repository.recordAudit({ event: 'rejected_unknown_token', details: {} });
      }
      return { ok: false };
    }

    const nextRaw = mintRawToken();
    const rotated = await this.repository.createRotatedToken({
      sessionId: token.sessionId,
      userId: token.userId,
      expiresAt: token.expiresAt,
      tokenHash: sha256Hex(nextRaw),
    });
    const accessToken = this.accessTokenIssuer.issueAccessToken(token.userId);
    await this.repository.recordAudit({
      event: 'rotation_success',
      userId: token.userId,
      sessionId: token.sessionId,
      tokenId: rotated.id,
      details: { retired_token_id: token.id },
    });
    return { ok: true, accessToken, refreshToken: nextRaw, expiresAt: token.expiresAt };
  }

  /**
   * Classifies a token that is no longer usable:
   *  - retired within the grace window → an in-flight client retry (benign);
   *  - retired outside the window → a stolen-token replay → the whole session
   *    family is invalidated and the event is audited;
   *  - active but past its absolute deadline → expired.
   */
  private async rejectStaleToken(token: StoredToken, now: Date): Promise<void> {
    const retiredAt = token.status === 'RETIRED' ? token.retiredAt ?? new Date(0) : null;

    if (retiredAt !== null) {
      const ageMs = now.getTime() - retiredAt.getTime();
      if (ageMs <= this.reuseGraceMs) {
        await this.repository.recordAudit({
          event: 'rejected_duplicate_retry',
          userId: token.userId,
          sessionId: token.sessionId,
          tokenId: token.id,
          details: { retired_at: retiredAt.toISOString(), grace_window_ms: this.reuseGraceMs },
        });
        return;
      }
      const invalidatedTokenCount = await this.repository.invalidateSession(token.sessionId, now);
      await this.repository.recordAudit({
        event: 'rejected_reuse_detected',
        userId: token.userId,
        sessionId: token.sessionId,
        tokenId: token.id,
        details: {
          retired_at: retiredAt.toISOString(),
          grace_window_ms: this.reuseGraceMs,
          invalidated_token_count: invalidatedTokenCount,
        },
      });
      return;
    }

    await this.repository.recordAudit({
      event: 'rejected_expired_token',
      userId: token.userId,
      sessionId: token.sessionId,
      tokenId: token.id,
      details: { expires_at: token.expiresAt.toISOString() },
    });
  }
}
