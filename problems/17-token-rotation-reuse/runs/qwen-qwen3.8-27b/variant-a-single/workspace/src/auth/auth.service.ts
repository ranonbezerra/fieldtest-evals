import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthRepository } from './auth.repository';

/**
 * DI token for the access-token issuer owned by the (pre-existing)
 * sign-in flow.
 *
 * ASSUMPTION: the task says sign-in and access-token verification already
 * exist and to assume `issueAccessToken(userId): string`; the full app
 * binds its real issuer to this token, and AuthModule ships a stand-in so
 * the module runs on its own.
 */
export const ISSUE_ACCESS_TOKEN = 'auth.issueAccessToken';

export type RefreshSource = 'body' | 'cookie';

export type RefreshOutcome =
  | { status: 'rotated'; accessToken: string; refreshToken: string; expiresAt: Date }
  | { status: 'rejected' };

/** Audit vocabulary: the audit table is the only place failure reasons differ. */
export const AUDIT_REASON = {
  sessionCreated: 'session_created',
  rotated: 'rotated',
  rejectedMalformed: 'rejected_malformed',
  rejectedUnknown: 'rejected_unknown',
  rejectedExpired: 'rejected_expired',
  rejectedReuse: 'rejected_reuse',
} as const;

/** Refresh tokens are 48 random bytes in base64url: exactly 64 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{64}$/;

function newTokenValue(): string {
  return randomBytes(48).toString('base64url');
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    @Inject(ISSUE_ACCESS_TOKEN) private readonly issueAccessToken: (userId: string) => string,
  ) {}

  /**
   * Opens a session; the pre-existing sign-in flow calls this. `ttlMs`
   * fixes the session's absolute lifetime; rotation can never move it.
   */
  async createSession(userId: string, ttlMs: number): Promise<{ refreshToken: string; expiresAt: Date }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const refreshToken = newTokenValue();

    await this.repository.withTransaction(async (tx) => {
      const family = await this.repository.createFamily({ userId, expiresAt }, tx);
      await this.repository.createToken(
        { familyId: family.id, userId, tokenHash: tokenHash(refreshToken), expiresAt },
        tx,
      );
      await this.repository.recordAudit(
        { familyId: family.id, userId, tokenId: null, reason: AUDIT_REASON.sessionCreated, details: {} },
        tx,
      );
    });

    return { refreshToken, expiresAt };
  }

  /**
   * Rotates one presentation of a refresh token. All failure modes
   * (malformed, unknown, expired, retired/reused) yield the same
   * `{ status: 'rejected' }`; only the audit record differs.
   */
  async refresh(presented: string | null, source: RefreshSource): Promise<RefreshOutcome> {
    const now = new Date();

    if (presented === null || !TOKEN_SHAPE.test(presented)) {
      await this.repository.withTransaction(async (tx) => {
        await this.repository.recordAudit(
          {
            familyId: null,
            userId: null,
            tokenId: null,
            reason: AUDIT_REASON.rejectedMalformed,
            details: { source, presented: presented !== null },
          },
          tx,
        );
      });
      return { status: 'rejected' };
    }

    const tokenValue: string = presented;

    return this.repository.withTransaction(async (tx) => {
      const token = await this.repository.findRefreshTokenByHash(tokenHash(tokenValue), tx);

      if (token === null) {
        await this.repository.recordAudit(
          { familyId: null, userId: null, tokenId: null, reason: AUDIT_REASON.rejectedUnknown, details: { source } },
          tx,
        );
        return { status: 'rejected' } as const;
      }

      // Expiry before retirement: replaying a token that cannot work is
      // not evidence of compromise, so it must not revoke the family.
      if (token.expiresAt.getTime() <= now.getTime()) {
        await this.repository.recordAudit(
          {
            familyId: token.familyId,
            userId: token.userId,
            tokenId: token.id,
            reason: AUDIT_REASON.rejectedExpired,
            details: { source },
          },
          tx,
        );
        return { status: 'rejected' } as const;
      }

      if (token.retired) {
        // Presented twice: reuse. Invalidate the whole family.
        const familyAlreadyRevoked = await this.repository.revokeFamily(token.familyId, now, tx);
        await this.repository.recordAudit(
          {
            familyId: token.familyId,
            userId: token.userId,
            tokenId: token.id,
            reason: AUDIT_REASON.rejectedReuse,
            details: { source, phase: 'read', familyAlreadyRevoked },
          },
          tx,
        );
        return { status: 'rejected' } as const;
      }

      // Atomic rotation: exactly one concurrent presenter can flip
      // `retired` from false.
      const successorId = randomUUID();
      const retired = await this.repository.retireActiveToken(
        token.id,
        { retiredAt: now, replacedBy: successorId },
        tx,
      );
      if (!retired) {
        // Lost the race: the token is committed-retired, which is exactly
        // the reuse signal. Indistinguishable from a replay by design.
        const familyAlreadyRevoked = await this.repository.revokeFamily(token.familyId, now, tx);
        await this.repository.recordAudit(
          {
            familyId: token.familyId,
            userId: token.userId,
            tokenId: token.id,
            reason: AUDIT_REASON.rejectedReuse,
            details: { source, phase: 'commit', familyAlreadyRevoked },
          },
          tx,
        );
        return { status: 'rejected' } as const;
      }

      const refreshToken = newTokenValue();
      await this.repository.createToken(
        {
          id: successorId,
          familyId: token.familyId,
          userId: token.userId,
          tokenHash: tokenHash(refreshToken),
          // absolute deadline: copied verbatim, never extended
          expiresAt: token.expiresAt,
        },
        tx,
      );
      await this.repository.recordAudit(
        {
          familyId: token.familyId,
          userId: token.userId,
          tokenId: successorId,
          reason: AUDIT_REASON.rotated,
          details: { source, predecessorId: token.id },
        },
        tx,
      );

      return {
        status: 'rotated',
        accessToken: this.issueAccessToken(token.userId),
        refreshToken,
        expiresAt: token.expiresAt,
      } as const;
    });
  }
}
