import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { RefreshToken } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a refresh‑token record by its opaque token value.
   *
   * @param token The token string as supplied by the client.
   * @returns The matching `RefreshToken` or `null` if none exists.
   */
  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  /**
   * Atomically retires a token *iff* it is still active (not revoked).
   *
   * The operation is performed as a single `UPDATE … WHERE revoked = false`
   * statement; Prisma translates this to an `UPDATE ... WHERE ...` that returns
   * the number of affected rows.
   *
   * @param tokenId The primary key of the token to retire.
   * @param now The timestamp at which the revocation occurs.
   * @returns `true` if the token was successfully retired, `false` otherwise.
   */
  async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
    return result.count === 1;
  }

  /**
   * Revokes *all* active tokens belonging to the same family (i.e. all
   * descendants of the original sign‑in). This is used when a reused token is
   * detected.
   *
   * @param familyId Identifier for the token family.
   * @param now The timestamp at which the revocation occurs.
   */
  async revokeFamilyTokens(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
  }

  /**
   * Persists a newly issued refresh token.
   *
   * @param userId The identifier of the token owner.
   * @param familyId Identifier for the token family (inherited from the parent token).
   * @param expiresAt Absolute expiry timestamp for the session (unchanged across rotations).
   * @returns The freshly created `RefreshToken` record.
   */
  async createRefreshToken(
    userId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    return this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        familyId,
        expiresAt,
        createdAt: now,
        // `revoked` defaults to false; `revokedAt` stays null.
      },
    });
  }
}
