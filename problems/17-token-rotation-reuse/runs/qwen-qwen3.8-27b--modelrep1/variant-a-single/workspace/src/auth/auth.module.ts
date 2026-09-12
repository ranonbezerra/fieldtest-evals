import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthController } from './auth.controller.js';
import {
  ACCESS_TOKEN_ISSUER,
  REFRESH_CONFIG,
  SYSTEM_CLOCK,
  AuthService,
  type RefreshConfig,
} from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { issueAccessToken } from './access-token.js';

// ASSUMPTION: the task says sign-in already exists and to assume
// issueAccessToken(userId): string, but none of that code is visible in this
// workspace; the module therefore binds the local seam in access-token.ts.
// Re-point ACCESS_TOKEN_ISSUER at the real implementation if it differs.
@Module({
  controllers: [AuthController],
  providers: [
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    AuthRepository,
    AuthService,
    { provide: ACCESS_TOKEN_ISSUER, useValue: issueAccessToken },
    { provide: SYSTEM_CLOCK, useValue: () => new Date() },
    {
      provide: REFRESH_CONFIG,
      useFactory: (): RefreshConfig => {
        const seconds = Number(process.env.REFRESH_REUSE_GRACE_SECONDS ?? '5');
        return {
          reuseGraceMs:
            Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 5_000,
        };
      },
    },
  ],
})
export class AuthModule {}
