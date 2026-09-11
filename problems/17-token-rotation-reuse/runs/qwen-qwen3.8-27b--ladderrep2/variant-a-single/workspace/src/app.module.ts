import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ACCESS_TOKEN_ISSUER } from './auth/auth.service.js';

@Module({
  imports: [AuthModule],
  providers: [
    // ASSUMPTION: identity-api already has a sign-in flow that issues access
    // tokens (`issueAccessToken(userId)`). This is the seam where that
    // implementation binds; the placeholder fails loudly rather than minting
    // credentials on its own.
    {
      provide: ACCESS_TOKEN_ISSUER,
      useValue: {
        issueAccessToken(userId: string): string {
          throw new Error(`AccessTokenIssuer is provided by the sign-in module (user: ${userId})`);
        },
      },
    },
  ],
})
export class AppModule {}
