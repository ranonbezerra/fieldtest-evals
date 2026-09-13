import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthRepository } from './auth.repository.js';
import { TokenIssuerService } from './token-issuer.service.js';
import { AuthFailedException } from './auth.failed.exception.js';

interface RefreshInput {
  token: string | undefined | null;
  ip: string;
  userAgent: string;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    const { token } = input;

    // 1. MALFORMED — no token, empty, or non-string.
    if (!token || typeof token !== 'string' || token.length === 0) {
      await this.repo.audit({
        eventType: 'MALFORMED',
        tokenHash: null,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'no_valid_token_provided' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 2. Hash and look up
    const tokenHash = hashToken(token);
    const existing = await this.repo.findByHash(tokenHash);

    // 3. UNKNOWN — hash not found
    if (!existing) {
      await this.repo.audit({
        eventType: 'UNKNOWN',
        tokenHash,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found_in_database' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 4. REUSE — checked BEFORE expiry (a retired+expired token is a compromise event)
    if (existing.isRetired) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 5. EXPIRY — token is live but past its absolute deadline
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.repo.audit({
        eventType: 'EXPIRY',
        tokenHash,
        familyId: existing.familyId,
        userId: existing.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 6. ATOMIC ROTATION — conditional update, database-serialised
    const rotated = await this.repo.atomicRetire(existing.id);

    // If another request won the race, this token is now retired → treat as reuse
    if (!rotated) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 7. Success: new refresh token, same family, same absolute deadline
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRefreshToken);

    await this.repo.createToken({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt,
    });

    const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

    await this.repo.audit({
      eventType: 'ROTATION',
      tokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { newTokenHash },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  private async handleReuse(
    token: { familyId: string; userId: string },
    tokenHash: string,
    input: RefreshInput,
  ): Promise<void> {
    await this.repo.invalidateFamily(token.familyId);
    await this.repo.audit({
      eventType: 'REUSE',
      tokenHash,
      familyId: token.familyId,
      userId: token.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reason: 'presented_retired_or_concurrent_token' },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}
