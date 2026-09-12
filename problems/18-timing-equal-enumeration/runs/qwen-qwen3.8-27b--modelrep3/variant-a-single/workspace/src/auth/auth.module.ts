import { Module } from '@nestjs/common';
import { MAIL_PORT } from '../mail/mail.port.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: MAIL_PORT,
      // ASSUMPTION: no mail transport ships with this task; the host
      // application registers its own provider under MAIL_PORT. This stand-in
      // fails loudly so a miswired app cannot silently drop mail.
      useValue: {
        sendEmail: async (): Promise<void> => {
          throw new Error('MAIL_PORT is not configured: register a sendEmail implementation');
        },
      },
    },
  ],
})
export class AuthModule {}
