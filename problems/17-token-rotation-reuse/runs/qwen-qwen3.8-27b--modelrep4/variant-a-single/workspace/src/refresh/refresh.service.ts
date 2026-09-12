import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshTokenRepository } from './refresh.repository.js';

export const ACCESS_TOKEN_ISSUER = 'ACCESS_TOKEN_ISSUER';

export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}

export interface RefreshInput {
  bodyRefreshToken?: unknown;
  cookieRefreshToken?: unknown;
}

export type RefreshOutcome =
  | { outcome: 'ok'; accessToken: string; refreshToken: string }
  | { outcome: 'rejected' };

@Injectable()
export class RefreshService {
  constructor(
    private readonly repository: RefreshTokenRepository,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly accessTokenIssuer: AccessTokenIssuer,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshOutcome> {
    const presentedToken = this.resolveToken(input);

    if (presentedToken === null) {
      await this.repository.recordMalformed();
      return { outcome: 'rejected' };
    }

    const nextRefreshToken = generateRefreshToken();
    const result = await this.repository.processRefreshAttempt(
      hashRefreshToken(presentedToken),
      hashRefreshToken(nextRefreshToken),
    );

    if (result.outcome === 'rotated') {
      return {
        outcome: 'ok',
        accessToken: this.accessTokenIssuer.issueAccessToken(result.userId),
        refreshToken: nextRefreshToken,
      };
    }

    return { outcome: 'rejected' };
  }

  private resolveToken(input: RefreshInput): string | null {
    if (input.bodyRefreshToken !== undefined) {
      if (typeof input.bodyRefreshToken !== 'string' || input.bodyRefreshToken.length === 0) {
        return null;
      }

      return input.bodyRefreshToken;
    }

    if (typeof input.cookieRefreshToken !== 'string' || input.cookieRefreshToken.length === 0) {
      return null;
    }

    return input.cookieRefreshToken;
  }
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

function hashRefreshToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
