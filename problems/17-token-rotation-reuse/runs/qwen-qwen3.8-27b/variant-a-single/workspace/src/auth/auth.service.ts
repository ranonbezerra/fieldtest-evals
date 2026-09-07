import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { randomBytes } from 'node:crypto';

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      await this.repo.recordAudit(null, 'malformed_token', {});
      return this.reject();
    }

    const record = await this.repo.findByToken(refreshToken);

    if (!record) {
      await this.repo.recordAudit(null, 'unknown_token', { token: refreshToken });
      return this.reject();
    }

    // Reuse of an already-retired token signals compromise:
    // invalidate the entire token family (all descendants of the same sign-in).
    if (record.status === 'retired' || record.status === 'revoked') {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', {
          sessionId: record.sessionId,
          tokenId: record.id,
        });
      });
      return this.reject();
    }

    // Absolute deadline was fixed at sign-in; rotation never extends it.
    if (new Date() > record.expiresAt) {
      await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
        await this.repo.retireToken(tx, record.id);
        await this.repo.recordAudit(tx, 'token_expired', {
          tokenId: record.id,
          sessionId: record.sessionId,
        });
      });
      return this.reject();
    }

    const newTokenValue = randomBytes(32).toString('hex');

    // Concurrent-safe rotation: retireTokenIfActive uses a conditional UPDATE
    // (WHERE status = 'active') so exactly one concurrent caller succeeds.
    // If it fails, another request already rotated this token — treat as reuse.
    const rotated = await this.repo.withTransaction(async (tx: Prisma.TransactionClient) => {
      const didRetire = await this.repo.retireTokenIfActive(tx, record.id);
      if (!didRetire) {
        await this.repo.invalidateFamily(tx, record.sessionId);
        await this.repo.recordAudit(tx, 'reuse_detected', {
          sessionId: record.sessionId,
          tokenId: record.id,
        });
        return null;
      }

      await this.repo.createToken(tx, {
        token: newTokenValue,
        userId: record.userId,
        sessionId: record.sessionId,
        expiresAt: record.expiresAt,
      });
      return newTokenValue;
    });

    if (rotated === null) {
      return this.reject();
    }

    return {
      accessToken: this.issueAccessToken(record.userId),
      refreshToken: rotated,
    };
  }

  /**
   * Every rejection — expired, retired, unknown, malformed — produces the
   * identical response so the caller cannot distinguish the cause.
   */
  private reject(): never {
    throw new UnauthorizedException({
      error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} },
    });
  }

  // ASSUMPTION: The plan states that sign-in and access-token verification
  // already exist; this is a placeholder for the existing issueAccessToken
  // implementation that should be wired in.
  private issueAccessToken(userId: string): string {
    throw new Error('Not implemented: delegate to existing access-token issuer');
  }
}
