import { Injectable, Logger } from '@nestjs/common';

// Injection token for the outbound mail port.
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

// ASSUMPTION: the task states the mail port already exists; this stand-in only logs so
// the app can boot standalone. The production build must bind the real transport to
// MAIL_PORT.
@Injectable()
export class LoggingMailPort implements MailPort {
  private readonly logger = new Logger(LoggingMailPort.name);

  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
    this.logger.log(`mail to=${to} template=${template} vars=${JSON.stringify(vars)}`);
    return Promise.resolve();
  }
}
