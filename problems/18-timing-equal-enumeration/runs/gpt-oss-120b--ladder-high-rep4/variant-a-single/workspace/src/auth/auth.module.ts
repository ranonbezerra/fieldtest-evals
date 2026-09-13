import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PasswordService, PrismaService],
})
export class AuthModule {}
