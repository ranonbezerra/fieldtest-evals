import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service.ts';
import { MAILER_TOKEN } from './mailer.token.ts';

@Module({
  providers: [
    {
      provide: MAILER_TOKEN,
      useClass: MailerService,
    },
  ],
  exports: [MAILER_TOKEN],
})
export class MailerModule {}
