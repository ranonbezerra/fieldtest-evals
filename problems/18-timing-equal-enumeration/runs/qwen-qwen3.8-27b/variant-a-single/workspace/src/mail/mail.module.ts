import { Module } from '@nestjs/common';

export const MAIL_PORT = 'MAIL_PORT';

/**
 * The mail seam used by the auth feature. The task assumes a transport with
 * exactly this shape exists in the environment.
 */
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

@Module({
  providers: [
    {
      provide: MAIL_PORT,
      useFactory: (): MailPort => ({
        // ASSUMPTION: the real `sendEmail` transport is supplied by the
        // deployment and bound to this token; this fallback fails loudly so a
        // missing binding is visible instead of silently dropping mail.
        sendEmail: async () => {
          throw new Error('MailPort is not bound to a transport; provide a real sendEmail implementation for MAIL_PORT.');
        },
      }),
    },
  ],
  exports: [MAIL_PORT],
})
export class MailModule {}
