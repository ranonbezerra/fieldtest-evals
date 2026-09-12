import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer } from './access-token-issuer.js';
import { AuthController } from './auth.controller.js';
import { AuthService, CLOCK } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    { provide: CLOCK, useValue: (): Date => new Date() },
    // Stand-in for the existing access-token issuer (see access-token-issuer.ts):
    // it fails loudly rather than minting fake tokens until the real provider is registered.
    {
      provide: ACCESS_TOKEN_ISSUER,
      useValue: {
        issueAccessToken: (): string => {
          throw new Error(
            'ACCESS_TOKEN_ISSUER is not wired: register the existing issueAccessToken(userId) implementation',
          );
        },
      } satisfies AccessTokenIssuer,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
