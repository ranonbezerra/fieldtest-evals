import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PrismaClient } from '@prisma/client';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PrismaClient],
  exports: [AuthService],
})
export class AuthModule {}
