import { Module } from '@nestjs/common';
import { MAILER, type MailerPort } from './mail.port';

// ASSUMPTION: the production implementation of sendEmail(to, template, vars)
// is provided by the host application. This binding is a logged stand-in so
// the feature is runnable in isolation; tests override the provider with a
// recording fake.
const standInMailer: MailerPort = {
  async sendEmail(to, template, vars) {
    console.log(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
  },
};

@Module({
  providers: [{ provide: MAILER, useValue: standInMailer }],
  exports: [MAILER],
})
export class MailModule {}
