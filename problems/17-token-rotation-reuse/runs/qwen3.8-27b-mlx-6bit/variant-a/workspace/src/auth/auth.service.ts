import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AuthRepository } from './auth.repository.js';

export interface RefreshInput {
  /** Raw token string as received (body or cookie). */
  rawToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/** Raised for every rejection; carries no public detail. */
export class InvalidRefreshTokenError extends Error {}

export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}

/** 256 bits expressed as a lowercase hex string. */
const TOKEN_LENGTH = 64;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly issuer: AccessTokenIssuer,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    // Malformed guard — short-circuits before any I/O or hash computation.
    if (input.rawToken.length !== TOKEN_LENGTH || !TOKEN_PATTERN.test(input.rawToken)) {
      // ASSUMPTION: The plan calls for a REJECTED_MALFORMED audit row here, but
      // AuthRepository's public surface only exposes executeRefresh(tokenHash);
      // no standalone audit-recording method is available to the service layer.
      throw new InvalidRefreshTokenError('Refresh token is invalid.');
    }

    const tokenHash = crypto.createHash('sha256').update(input.rawToken).digest('hex');
    const result = await this.repo.executeRefresh(tokenHash);

    switch (result.outcome) {
      case 'rotated': {
        const accessToken = this.issuer.issueAccessToken(result.user.userId);
        const newRawToken = crypto.randomBytes(32).toString('hex');
        return { accessToken, refreshToken: newRawToken };
      }
      case 'rejected':
      case 'reuse':
        throw new InvalidRefreshTokenError('Refresh token is invalid.');
    }
  }
}
