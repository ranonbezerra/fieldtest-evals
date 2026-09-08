# repair1-auth.repository.ts

## reasoning

```
We need to rewrite repository. Likely need imports: PrismaClient from @prisma/client. Also RefreshToken, Session types. Provide class with methods used by service. Without other files, guess minimal needed: find token, retire token, create new token, invalidate chain, record audit. But just need compile. Provide placeholders with any. Use PrismaClient instance injected. Export class AuthRepository with @Injectable. Use prisma client. Use types from Prisma namespace: Prisma.RefreshTokenCreateInput etc.

We'll import PrismaClient, Prisma from '@prisma/client'.

Define class with constructor(private readonly prisma: PrismaClient) {}

Implement methods signatures maybe used: getRefreshToken(token: string), rotateRefreshToken(oldToken:string, newToken:string, newExpiresAt:Date, sessionId:number), retireToken(tokenId:number), invalidateSessionTokens(sessionId:number), recordCompromise(tokenId:number, reason:string). Use any.

Just compile.

Add export class AuthRepository.

Let's write.
```

## reply

```ts
// src/auth/auth.repository.ts
import { Injectable } from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  RefreshToken,
  Session,
} from '@prisma/client';

// ASSUMPTION: The rest of the codebase expects the repository to expose the
// methods used by the AuthService (see the variant description). The exact
// signatures are not visible, so we provide a reasonable superset that covers
// typical operations for refresh‑token rotation. If the real service uses a
// different shape, the compile‑time errors will surface and can be adjusted
// without changing the overall architecture.

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Find a refresh token record by its opaque token string. */
  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  /** Create a new refresh token linked to a session. */
  async createRefreshToken(
    data: Prisma.RefreshTokenCreateInput,
  ): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  /** Mark a refresh token as retired (used). */
  async retireToken(id: number): Promise<RefreshToken> {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { retiredAt: new Date() },
    });
  }

  /** Invalidate all refresh tokens that belong to the same session
   * (used when a compromised/retired token is presented). */
  async invalidateSessionTokens(sessionId: number): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
  }

  /** Record an audit event for a compromised token. */
  async recordCompromise(
    tokenId: number,
    reason: string,
  ): Promise<void> {
    // ASSUMPTION: An `AuditLog` model exists with fields `refreshTokenId`,
    // `event`, and `createdAt`. If it does not, this method can be a no‑op.
    await this.prisma.$executeRaw`
      INSERT INTO "AuditLog" ("refreshTokenId", "event", "createdAt")
      VALUES (${tokenId}, ${reason}, ${new Date().toISOString()})
    `;
  }

  /** Fetch the session associated with a refresh token. */
  async getSessionByRefreshToken(
    tokenId: number,
  ): Promise<Session | null> {
    return this.prisma.session.findFirst({
      where: { refreshTokens: { some: { id: tokenId } } },
    });
  }

  /** Helper to run a transaction safely. */
  async $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
```
