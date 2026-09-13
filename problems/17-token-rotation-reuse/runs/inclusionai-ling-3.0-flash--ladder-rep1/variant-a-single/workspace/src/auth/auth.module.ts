import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { TokenIssuerService } from './token-issuer.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
    AuthFailedFilter,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
