// src/auth/auth.service.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { PrismaClient, RefreshToken, Session } from '@prisma/client';

// ASSUMPTION: The utility functions for issuing access tokens and creating
// refresh tokens exist elsewhere in the codebase. They are imported lazily
// inside the method to avoid compile‑time errors if the module path differs.
let issueAccessToken: (userId: string) => string;
let createRefreshToken: (sessionId: string, userId: string) => Promise<RefreshToken>;

@Injectable()
export class AuthService {
  private readonly prisma = new PrismaClient();

  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Rotates a refresh token.
   *
   * 1. Validates the incoming token (signature, expiry, etc.).
   * 2. Checks whether the token has already been retired.
   * 3. If the token is retired, treats it as a compromise and invalidates the
   *    entire session chain, recording an audit entry.
   * 4. If the token is valid and not retired, issues a new access token and a
   *    new refresh token, retiring the presented one.
   *
   * All rejections (expired, retired, unknown, malformed) result in the same
   * generic `UnauthorizedException` to the caller; the audit trail distinguishes
   * the exact cause.
   *
   * @param presentedToken The raw refresh token string supplied by the client.
   * @returns An object containing a fresh access token and refresh token.
   */
  async refresh(presentedToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    // Lazy import to avoid compile‑time path issues.
    if (!issueAccessToken) {
      const utils = await import('../utils/token.utils');
      issueAccessToken = utils.issueAccessToken;
      createRefreshToken = utils.createRefreshToken;
    }

    // 1️⃣ Verify token format / signature – placeholder for real verification.
    let decoded: { sessionId: string; userId: string } | null = null;
    try {
      // Assume a verify function exists; replace with real implementation.
      const { verifyRefreshToken } = await import('../utils/token.utils');
      decoded = await verifyRefreshToken(presentedToken);
    } catch {
      // Malformed or invalid signature.
      await this.authRepository.recordAudit({
        type: 'refresh_token_malformed',
        token: presentedToken,
        timestamp: new Date(),
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!decoded) {
      await this.authRepository.recordAudit({
        type: 'refresh_token_unknown',
        token: presentedToken,
        timestamp: new Date(),
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { sessionId, userId } = decoded;

    // 2️⃣ Load the token record.
    const tokenRecord = await this.authRepository.findRefreshToken(presentedToken);

    // If token not found → unknown token.
    if (!tokenRecord) {
      await this.authRepository.recordAudit({
        type: 'refresh_token_unknown',
        token: presentedToken,
        timestamp: new Date(),
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 3️⃣ Check retirement status.
    if (tokenRecord.retiredAt) {
      // Token already retired → treat as compromise.
      await this.authRepository.invalidateSessionChain(sessionId, {
        reason: 'refresh_token_replay',
        offendingToken: presentedToken,
      });
      await this.authRepository.recordAudit({
        type: 'refresh_token_replay',
        token: presentedToken,
        sessionId,
        userId,
        timestamp: new Date(),
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 4️⃣ Check absolute session expiry.
    const session = await this.authRepository.findSession(sessionId);
    if (!session || session.expiresAt <= new Date()) {
      // Session absolute deadline passed.
      await this.authRepository.recordAudit({
        type: 'refresh_token_expired',
        token: presentedToken,
        sessionId,
        userId,
        timestamp: new Date(),
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 5️⃣ All good – rotate.
    // Retire the presented token.
    await this.authRepository.retireToken(tokenRecord.id, new Date());

    // Issue new tokens.
    const newRefresh = await createRefreshToken(sessionId, userId);
    const newAccess = issueAccessToken(userId);

    // Return to caller.
    return {
      accessToken: newAccess,
      refreshToken: newRefresh.token,
    };
  }
}
