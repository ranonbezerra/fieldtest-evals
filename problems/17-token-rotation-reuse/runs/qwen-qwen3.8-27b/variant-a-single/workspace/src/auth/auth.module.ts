import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, ISSUE_ACCESS_TOKEN } from './auth.service';
import { AuthRepository } from './auth.repository';

// ASSUMPTION: sign-in and its access-token issuer already exist (the task
// says to assume issueAccessToken(userId): string); the full app binds its
// real issuer to ISSUE_ACCESS_TOKEN. This stand-in keeps the module
// self-contained for tests.
function issueAccessToken(userId: string): string {
  return `access:${userId}`;
}

@Module({
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    { provide: ISSUE_ACCESS_TOKEN, useValue: issueAccessToken },
  ],
  exports: [AuthService],
})
export class AuthModule {}
