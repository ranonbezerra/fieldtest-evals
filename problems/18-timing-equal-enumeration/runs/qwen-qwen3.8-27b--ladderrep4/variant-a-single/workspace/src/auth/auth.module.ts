import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { MAIL_PORT, type MailPort } from './mail.port.js';

// ASSUMPTION: the mail port is posited to exist in the deployment environment;
// a console stand-in keeps this repository runnable, and a real transport (or
// a test fake) is injected under MAIL_PORT elsewhere.
export class ConsoleMailPort implements MailPort {
  async sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void> {
    console.log(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, { provide: MAIL_PORT, useClass: ConsoleMailPort }],
})
export class AuthModule {}
