import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AccessTokenService } from './access-token.service.js';
import { AuditEntry, AuditReason, AuthRepository, StoredRefreshToken } from './auth.repository.js';
import { RefreshRejected } from './refresh-rejected.exception.js';

export interface RefreshOutcome {
  accessToken: string;
  refreshToken: string;
  /** Absolute session deadline, inherited from the rotated row — never extended. */
  expiresAt: Date;
}

// ASSUMPTION: the absolute session lifetime is a 30-day policy value fixed at sign-in.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 512;
const AUDIT_TEXT_LIMIT = 128;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

type AuditContext = Partial<Pick<AuditEntry, 'familyId' | 'tokenId' | 'userId' | 'providedText'>>;

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /** Entry point for the existing sign-in flow: creates the family and its first token. */
  async startSession(userId: string): Promise<{ refreshToken: string }> {
    const token = generateRefreshToken();
    await this.repo.createSession(userId, token, new Date(Date.now() + SESSION_TTL_MS));
    return { refreshToken: token };
  }

  /**
   * Check order (documented in SECURITY.md):
   *   malformed -> unknown -> retired (reuse) -> expired -> atomic rotate.
   * Reuse is checked before expiry so that a token that is both retired and
   * expired is a compromise signal, not a routine expiry line. Every rejection
   * funnels through the single reject() audit-and-throw path.
   */
  async refresh(rawToken: unknown): Promise<RefreshOutcome> {
    if (!this.isWellFormed(rawToken)) {
      return this.reject('refresh_malformed', { providedText: this.auditText(rawToken) });
    }

    const presented = await this.repo.findByToken(rawToken);

    if (!presented) {
      return this.reject('refresh_unknown', { providedText: rawToken.slice(0, AUDIT_TEXT_LIMIT) });
    }

    if (presented.revokedAt !== null) {
      await this.repo.revokeFamily(presented.familyId);
      return this.reject('refresh_reused', this.familyContext(presented));
    }

    if (presented.expiresAt.getTime() <= Date.now()) {
      return this.reject('refresh_expired', this.familyContext(presented));
    }

    const successor = generateRefreshToken();
    const rotated = await this.repo.rotate(
      rawToken,
      successor,
      presented.familyId,
      presented.userId,
      presented.expiresAt,
    );

    if (!rotated) {
      // We lost the race: a concurrent request retired this token first. That
      // is indistinguishable from a replay, so it is treated as reuse.
      await this.repo.revokeFamily(presented.familyId);
      return this.reject('refresh_reused', this.familyContext(presented));
    }

    await this.repo.recordAudit({ reason: 'refresh_rotated', ...this.familyContext(presented) });

    return {
      accessToken: this.accessTokens.issueAccessToken(presented.userId),
      refreshToken: successor,
      expiresAt: presented.expiresAt,
    };
  }

  private isWellFormed(token: unknown): token is string {
    return (
      typeof token === 'string' &&
      token.length >= MIN_TOKEN_LENGTH &&
      token.length <= MAX_TOKEN_LENGTH &&
      TOKEN_PATTERN.test(token)
    );
  }

  private auditText(token: unknown): string | null {
    if (token == null) {
      return null;
    }
    return (typeof token === 'string' ? token : JSON.stringify(token)).slice(0, AUDIT_TEXT_LIMIT);
  }

  private familyContext(token: StoredRefreshToken): AuditContext {
    return { familyId: token.familyId, tokenId: token.id, userId: token.userId };
  }

  /** Single rejection path: audit the cause, then throw the one error the filter maps to the shared envelope. */
  private reject(reason: AuditReason, context: AuditContext): Promise<never> {
    return this.repo.recordAudit({ reason, ...context }).then(() => {
      throw new RefreshRejected();
    });
  }
}
