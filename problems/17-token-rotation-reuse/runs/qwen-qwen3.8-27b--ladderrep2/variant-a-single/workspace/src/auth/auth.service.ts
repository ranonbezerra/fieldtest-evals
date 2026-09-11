import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EnvelopeError } from '../common/error-envelope.js';
import type { AuthRepository, IssuedToken } from './auth.repository.js';

export const ACCESS_TOKEN_ISSUER = 'ACCESS_TOKEN_ISSUER';
export const CLOCK = 'CLOCK';

export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}

export type TokenSource = 'body' | 'cookie' | 'none';

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  sessionExpiresAt: Date;
}

const DEFAULT_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 255;
const TOKEN_CHARSET = /^[A-Za-z0-9_-]+$/;

// One error instance for every rejection: the caller can never tell the
// causes apart, and the audit log is the only place they are distinguished.
const REFRESH_REJECTION = new EnvelopeError(401, 'invalid_refresh_token', 'The refresh token could not be used.');

type RejectionReason = 'malformed' | 'unknown' | 'expired' | 'reuse';

interface RejectionContext {
  source: TokenSource;
  userId?: string;
  familyId?: string;
  tokenId?: string;
  [key: string]: unknown;
}

@Injectable()
export class AuthService {
  private readonly defaultSessionLifetimeMs: number;

  constructor(
    @Inject('AuthRepository') private readonly tokens: AuthRepository,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly issuer: AccessTokenIssuer,
    @Inject(CLOCK) private readonly now: () => Date,
  ) {
    const fromEnv = Number(process.env.REFRESH_SESSION_LIFETIME_MS);
    this.defaultSessionLifetimeMs =
      Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_SESSION_LIFETIME_MS;
  }

  /**
   * Called by the existing sign-in flow: opens a new session family with its
   * absolute deadline and the first token of the rotation chain.
   */
  async startSession(userId: string, sessionLifetimeMs: number = this.defaultSessionLifetimeMs): Promise<RefreshResult> {
    const at = this.now();
    const sessionExpiresAt = new Date(at.getTime() + sessionLifetimeMs);
    const family = { id: randomUUID(), userId, expiresAt: sessionExpiresAt, createdAt: at };
    const refreshToken = this.mintToken();
    const token = {
      id: randomUUID(),
      tokenHash: this.hashToken(refreshToken),
      familyId: family.id,
      userId,
      expiresAt: sessionExpiresAt,
      createdAt: at,
    };
    await this.tokens.createSession({ family, token });
    await this.tokens.recordEvent({
      id: randomUUID(),
      kind: 'session_started',
      reason: null,
      userId,
      familyId: family.id,
      tokenId: token.id,
      source: null,
      details: { sessionExpiresAt },
      occurredAt: at,
    });
    return { accessToken: this.issuer.issueAccessToken(userId), refreshToken, sessionExpiresAt };
  }

  /**
   * Rotates the presented refresh token. Check order (and the reason for it)
   * is documented in SECURITY.md: shape → lookup → dead (reuse) → expired →
   * atomic rotate.
   */
  async refresh(presented: unknown, source: TokenSource): Promise<RefreshResult> {
    // 1. Shape: reject junk before it can reach the database or the audit log.
    if (
      typeof presented !== 'string' ||
      presented.length < MIN_TOKEN_LENGTH ||
      presented.length > MAX_TOKEN_LENGTH ||
      !TOKEN_CHARSET.test(presented)
    ) {
      return this.reject('malformed', { source, problem: this.describeShape(presented) });
    }

    // 2. Lookup: only SHA-256 hashes are stored; the raw secret never
    //    touches the database.
    const token = await this.tokens.findByHash(this.hashToken(presented));
    if (token === null) {
      return this.reject('unknown', { source });
    }

    // 3. Dead before expired: a retired or revoked token is a reuse event
    //    even if it has also passed its deadline.
    if (token.retiredAt !== null || token.revokedAt !== null) {
      const sweep = await this.tokens.revokeFamily(token.familyId, this.now());
      return this.reject('reuse', {
        source,
        userId: token.userId,
        familyId: token.familyId,
        tokenId: token.id,
        tokenState: token.revokedAt !== null ? 'revoked' : 'retired',
        context: 'replay',
        newlyRevokedTokens: sweep.newlyRevokedTokens,
      });
    }

    // 4. Expiry: the absolute deadline fixed at sign-in.
    if (token.expiresAt.getTime() <= this.now().getTime()) {
      return this.reject('expired', {
        source,
        userId: token.userId,
        familyId: token.familyId,
        tokenId: token.id,
        expiresAt: token.expiresAt,
      });
    }

    // 5. Rotate. The new token inherits the presented token's deadline;
    //    rotation never extends the session.
    const issuedAt = this.now();
    const refreshToken = this.mintToken();
    const issued: IssuedToken = {
      id: randomUUID(),
      tokenHash: this.hashToken(refreshToken),
      familyId: token.familyId,
      userId: token.userId,
      expiresAt: token.expiresAt,
      createdAt: issuedAt,
    };
    const outcome = await this.tokens.rotate({ presentedId: token.id, issued });

    if (outcome.status === 'lost') {
      const after = await this.tokens.findById(token.id);
      if (after !== null && (after.retiredAt !== null || after.revokedAt !== null)) {
        // Someone else retired (or revoked) the token between the read and
        // the conditional update: a concurrent winner. That is
        // indistinguishable from a replay and is handled as one.
        const sweep = await this.tokens.revokeFamily(token.familyId, this.now());
        return this.reject('reuse', {
          source,
          userId: token.userId,
          familyId: token.familyId,
          tokenId: token.id,
          tokenState: after.revokedAt !== null ? 'revoked' : 'retired',
          context: 'race',
          newlyRevokedTokens: sweep.newlyRevokedTokens,
        });
      }
      // Still live on re-read: the only way to lose is the absolute deadline
      // passing between the read and the conditional update.
      return this.reject('expired', {
        source,
        userId: token.userId,
        familyId: token.familyId,
        tokenId: token.id,
        expiresAt: token.expiresAt,
      });
    }

    await this.tokens.recordEvent({
      id: randomUUID(),
      kind: 'refresh_success',
      reason: null,
      userId: token.userId,
      familyId: token.familyId,
      tokenId: outcome.issuedId,
      source,
      details: { retiredTokenId: token.id, issuedTokenId: outcome.issuedId, sessionExpiresAt: token.expiresAt },
      occurredAt: this.now(),
    });

    return {
      accessToken: this.issuer.issueAccessToken(token.userId),
      refreshToken,
      sessionExpiresAt: token.expiresAt,
    };
  }

  /**
   * The single rejection path: write the audit record, then throw the one
   * error the filter renders as the fixed 401 envelope. All four rejection
   * causes route through here.
   */
  private async reject(reason: RejectionReason, context: RejectionContext): Promise<never> {
    await this.tokens.recordEvent({
      id: randomUUID(),
      kind: 'refresh_rejected',
      reason,
      userId: context.userId ?? null,
      familyId: context.familyId ?? null,
      tokenId: context.tokenId ?? null,
      source: context.source,
      details: context,
      occurredAt: this.now(),
    });
    throw REFRESH_REJECTION;
  }

  private describeShape(presented: unknown): string {
    if (presented === undefined || presented === null) return 'missing';
    if (typeof presented !== 'string') return 'not_a_string';
    if (presented.length === 0) return 'empty';
    if (presented.length < MIN_TOKEN_LENGTH || presented.length > MAX_TOKEN_LENGTH) return 'length_out_of_range';
    return 'charset_violation';
  }

  private mintToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
