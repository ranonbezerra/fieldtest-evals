import { Module } from '@nestjs/common';
import { MAIL_PORT, MailPort } from './mail.port.js';

// ASSUMPTION: sendEmail(to, template, vars): Promise<void> is provided by the platform mail service and its production binding is external to this feature; tests replace this provider.
const platformMail: MailPort = {
  sendEmail(): Promise<void> {
    return Promise.reject(new Error('platform mail transport is not bound in this build'));
  },
};

@Module({
  providers: [{ provide: MAIL_PORT, useValue: platformMail }],
  exports: [MAIL_PORT],
})
export class MailModule {}
