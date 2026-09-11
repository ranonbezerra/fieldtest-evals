import { Module } from '@nestjs/common';
import { MAIL_PORT, type MailPort } from './mail.port.js';

// ASSUMPTION: a real sendEmail implementation is assumed to exist in the host
// application; this stand-in keeps the container resolvable until one is bound.
const consoleMailPort: MailPort = {
  async sendEmail(to, template, vars) {
    console.info(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
  },
};

@Module({
  providers: [{ provide: MAIL_PORT, useValue: consoleMailPort }],
  exports: [MAIL_PORT],
})
export class MailModule {}
