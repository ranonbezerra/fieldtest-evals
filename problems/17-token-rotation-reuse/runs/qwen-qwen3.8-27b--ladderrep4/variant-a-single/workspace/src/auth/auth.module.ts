import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';
import { ACCESS_TOKEN_ISSUER, StubAccessTokenIssuer } from './access-token.provider.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository, PRISMA_CLIENT } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: PRISMA_CLIENT, useFactory: () => new PrismaClient() },
    { provide: ACCESS_TOKEN_ISSUER, useClass: StubAccessTokenIssuer },
    AuthRepository,
    AuthService,
    AllExceptionsFilter,
  ],
  exports: [AuthService],
})
export class AuthModule {}
