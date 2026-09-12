import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailService, PrismaService],
})
export class AuthModule {}
