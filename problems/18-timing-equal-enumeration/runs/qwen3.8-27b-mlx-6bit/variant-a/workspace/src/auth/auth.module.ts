import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, MailPort } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: MailPort,
      useValue: {
        sendEmail: async (_to: string, _template: string, _vars: Record<string, string>): Promise<void> => {},
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
