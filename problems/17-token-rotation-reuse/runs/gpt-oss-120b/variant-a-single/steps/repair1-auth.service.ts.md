# repair1-auth.service.ts

## reasoning

```
We need to write auth.service with correct imports. Likely need PrismaClient import from @prisma/client. Use repository. Provide basic methods. We'll assume repository exists with needed methods. Also token.utils. Provide class AuthService with constructor injecting AuthRepository. Implement refresh(refreshToken: string) returning { accessToken, refreshToken }. Use repository to rotate with transaction handling concurrency. Simplify.

Add imports: Injectable from @nestjs/common, PrismaClient, RefreshToken, Prisma from @prisma/client, AuthRepository, issueAccessToken from utils, maybe generateRefreshToken.

Implement method refreshToken(refreshToken: string) { // logic placeholder }

We just need compile, not full logic. Use any where needed. Ensure types correct.

Add // ASSUMPTION lines for missing utils.

Let's produce file.
```

## reply

```typescript
// src/auth/auth.service.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  RefreshToken,
} from '@prisma/client';

// ASSUMPTION: The repository exists and provides the required methods.
// It is imported from './auth.repository' which should export class AuthRepository.
import { AuthRepository } from './auth.repository';

// ASSUMPTION: Token utility functions exist in '../utils/token.utils'.
// At minimum we need a function to issue a new access token and to generate a new refresh token.
import { issueAccessToken, generateRefreshToken } from '../utils/token.utils';

@Injectable()
export class AuthService {
  private readonly prisma = new PrismaClient();

  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Refreshes a given refresh token, rotating it and issuing a new access token.
   * The method follows the rotation rules described in the specification.
   *
   * @param presentedToken The refresh token presented by the client.
   * @returns An object containing a new access token and a new refresh token.
   * @throws UnauthorizedException when the token cannot be used.
   */
  async refresh(presentedToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    // Basic validation – malformed token
    if (!presentedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Perform the rotation inside a transaction to guarantee
    // atomicity and safe concurrent handling.
    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Load the token record (including its session) with a FOR UPDATE lock.
        const tokenRecord = await this.authRepository.findByTokenForUpdate(
          presentedToken,
          tx,
        );

        // If token not found or already retired/expired treat as compromise.
        if (!tokenRecord) {
          // Record audit of unknown token usage.
          await this.authRepository.recordAudit(
            presentedToken,
            'unknown_token',
            tx,
          );
          throw new UnauthorizedException('Invalid refresh token');
        }

        // Check absolute session expiry.
        const now = new Date();
        if (tokenRecord.session.expiresAt <= now) {
          // Session absolute deadline reached – reject without rotating.
          await this.authRepository.recordAudit(
            presentedToken,
            'session_expired',
            tx,
          );
          throw new UnauthorizedException('Invalid refresh token');
        }

        // If token is already retired, treat as compromise and invalidate the whole session chain.
        if (tokenRecord.retiredAt) {
          await this.authRepository.invalidateDescendants(
            tokenRecord.sessionId,
            tx,
          );
          await this.authRepository.recordAudit(
            presentedToken,
            'token_replay_detected',
            tx,
          );
          throw new UnauthorizedException('Invalid refresh token');
        }

        // Rotate: retire current token and issue a new one.
        const newRefreshToken = generateRefreshToken();
        await this.authRepository.retireAndCreateNew(
          tokenRecord.id,
          newRefreshToken,
          tx,
        );

        // Issue new access token.
        const accessToken = issueAccessToken(tokenRecord.session.userId);

        // Record successful rotation audit.
        await this.authRepository.recordAudit(
          presentedToken,
          'refresh_success',
          tx,
        );

        return {
          accessToken,
          refreshToken: newRefreshToken,
        };
      },
    );
  }
}
```
