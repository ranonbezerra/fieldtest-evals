import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RefreshController } from './refresh.controller.js';
import { RefreshService, ACCESS_TOKEN_ISSUER } from './refresh.service.js';
import { RefreshTokenRepository } from './refresh.repository.js';

@Module({
  controllers: [RefreshController],
  providers: [
    { provide: PrismaClient, useValue: new PrismaClient() },
    RefreshTokenRepository,
    RefreshService,
    // ASSUMPTION: The real issueAccessToken provider already exists in the auth feature; this stand-in keeps the module self-contained.
    {
      provide: ACCESS_TOKEN_ISSUER,
      useValue: {
        issueAccessToken: (userId: string) => `access.${userId}`,
      },
    },
  ],
})
export class RefreshModule {}
