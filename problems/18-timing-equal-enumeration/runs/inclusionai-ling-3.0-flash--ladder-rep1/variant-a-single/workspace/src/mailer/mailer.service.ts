import { Injectable, Logger } from '@nestjs/common';
import { MAILER_TOKEN } from './mailer.token';

export interface MailerPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class MailerService implements MailerPort {
  private readonly logger = new Logger('Mailer');

  async sendEmail(_to: string, _template: string, _vars: Record<string, unknown>): Promise<void> {
    this.logger.warn('Mail transport not configured; email suppressed.');
  }
}
