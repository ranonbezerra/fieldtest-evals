import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { MAIL_PORT, type MailPort } from './auth/mail.port.js';

// Root binding for the assumed mail port. Where the real transport exists it
// owns this token; this stand-in only makes a misconfigured deployment
// visible instead of silently dropping mail.
const mailFallback: MailPort = {
  sendEmail: async (to, template, vars): Promise<void> => {
    console.warn(`[mail] no transport bound; dropped "${template}" to ${to}`, vars);
  },
};

@Module({
  imports: [AuthModule],
  providers: [{ provide: MAIL_PORT, useValue: mailFallback }],
})
export class AppModule {}
