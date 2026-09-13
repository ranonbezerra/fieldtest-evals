import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.ts';
import { AuthService } from './auth.service.ts';
import { AuthRepository } from './auth.repository.ts';
import { MailerModule } from '../mailer/mailer.module.ts';
import { PrismaService } from '../prisma/prisma.service.ts';

@Module({
  imports: [MailerModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PrismaService],
  exports: [AuthService, AuthRepository],
})
export class AuthModule {}
