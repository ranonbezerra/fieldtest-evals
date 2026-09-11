import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { RefreshTokenSource } from '@prisma/client';
import { AccessTokenService } from './access-token.service.js';
import { AuthRepository } from './auth.repository.js';

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false };

const MAX_TOKEN_LENGTH = 256;

/** The raw refresh token is never stored; only this SHA-256 digest is. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function newOpaqueRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

@Injectable()
export class AuthService {
  private readonly tokenTtlMs: number;

  constructor(
    private readonly repo: AuthRepository,
    // ASSUMPTION: sign-in and access-token issuance already exist in this
    // codebase; their provider is assumed to expose issueAccessToken(userId): string.
    private readonly accessTokens: AccessTokenService,
  ) {
    const seconds = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 3600);
    this.tokenTtlMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000;
  }

  /**
   * Sign-in seam.
   * ASSUMPTION: the existing sign-in flow calls this once per sign-in with the
   * session's absolute deadline, which is fixed here and can never be
   * extended by later rotations.
   */
  async issueInitialRefreshToken(userId: string, sessionExpiresAt: Date): Promise<string> {
    const family = await this.repo.createFamily(userId, sessionExpiresAt);
    const raw = newOpaqueRefreshToken();
    const expiresAt = new Date(Math.min(Date.now() + this.tokenTtlMs, sessionExpiresAt.getTime()));
    await this.repo.createToken({ familyId: family.id, tokenHash: hashRefreshToken(raw), expiresAt });
    return raw;
  }

  /**
   * POST /auth/refresh.
   *
   * Precedence (documented in SECURITY.md): when the JSON body carries a
   * `refreshToken` field, it wins over the `refresh_token` cookie. A body
   * value that is not a usable string is a malformed rejection — the request
   * never falls back to the cookie.
   *
   * Every rejection — malformed, unknown, expired, reused — yields the same
   * `{ ok: false }`; the controller turns that into one 401 body. The audit
   * record (never the response) is what distinguishes the causes.
   */
  async refresh(bodyToken: unknown, cookieToken: string | null): Promise<RefreshOutcome> {
    const now = new Date();
    const via: 'body' | 'cookie' = bodyToken !== undefined ? 'body' : 'cookie';
    const viaSource: RefreshTokenSource = via === 'body' ? 'BODY' : 'COOKIE';
    const raw: unknown = via === 'body' ? bodyToken : cookieToken;

    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH) {
      await this.repo.recordAudit({ reason: 'REJECTED_MALFORMED', via: viaSource });
      return { ok: false };
    }

    const tokenHash = hashRefreshToken(raw);
    const pre = await this.repo.findTokenWithFamily(tokenHash);

    if (!pre) {
      await this.repo.recordAudit({ reason: 'REJECTED_UNKNOWN', via: viaSource });
      return { ok: false };
    }

    // Reuse is judged before expiry: a retired/revoked token, or a token from
    // a revoked family, is a compromise signal even if it is also expired.
    if (pre.status !== 'ACTIVE' || pre.family.revoked) {
      await this.repo.invalidateFamily(pre.familyId, now, {
        reason: 'REJECTED_REUSED',
        tokenId: pre.id,
        userId: pre.family.userId,
        via: viaSource,
      });
      return { ok: false };
    }

    if (pre.expiresAt.getTime() <= now.getTime() || pre.family.expiresAt.getTime() <= now.getTime()) {
      await this.repo.recordAudit({
        reason: 'REJECTED_EXPIRED',
        tokenId: pre.id,
        familyId: pre.familyId,
        userId: pre.family.userId,
        via: viaSource,
      });
      return { ok: false };
    }

    const newRaw = newOpaqueRefreshToken();
    const outcome = await this.repo.rotate(
      tokenHash,
      {
        familyId: pre.familyId,
        tokenHash: hashRefreshToken(newRaw),
        // Rotation never extends the absolute deadline: the successor is
        // capped at the family's sign-in deadline.
        expiresAt: new Date(Math.min(now.getTime() + this.tokenTtlMs, pre.family.expiresAt.getTime())),
      },
      now,
    );

    if (outcome.success) {
      return {
        ok: true,
        accessToken: this.accessTokens.issueAccessToken(outcome.retired.family.userId),
        refreshToken: newRaw,
      };
    }

    // The atomic retire lost the race: the token was retired — or its family
    // revoked — between the read above and the update. A raced retry and a
    // stolen replay are indistinguishable, so this is a reuse event.
    const t = outcome.token;
    if (!t) {
      await this.repo.recordAudit({ reason: 'REJECTED_UNKNOWN', via: viaSource });
      return { ok: false };
    }
    await this.repo.invalidateFamily(t.familyId, now, {
      reason: 'REJECTED_REUSED',
      tokenId: t.id,
      userId: t.family.userId,
      via: viaSource,
    });
    return { ok: false };
  }
}
