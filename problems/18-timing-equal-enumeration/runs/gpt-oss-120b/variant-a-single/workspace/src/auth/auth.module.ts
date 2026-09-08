import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { PrismaClient } from '@prisma/client';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: PrismaClient,
      useFactory: () => {
        const client = new PrismaClient();
        // Ensure graceful shutdown
        client.$connect();
        return client;
      },
    },
  ],
  exports: [AuthService, AuthRepository],
})
export class AuthModule {}
