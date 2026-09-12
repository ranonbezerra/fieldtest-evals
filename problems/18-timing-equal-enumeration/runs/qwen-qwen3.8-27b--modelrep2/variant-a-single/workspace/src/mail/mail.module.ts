import { Module } from '@nestjs/common';
import { LoggingMailPort, MAIL_PORT } from './mail.port.js';

@Module({
  providers: [{ provide: MAIL_PORT, useClass: LoggingMailPort }],
  exports: [MAIL_PORT],
})
export class MailModule {}
