import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [PrismaService, AuthRepository, AuthService],
})
export class AuthModule {}
