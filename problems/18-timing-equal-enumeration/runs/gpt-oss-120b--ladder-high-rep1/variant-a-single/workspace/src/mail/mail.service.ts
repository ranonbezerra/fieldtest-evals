import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  /**
   * Sends an e‑mail.
   * This stub does nothing; in production it would forward to an SMTP provider or external service.
   * The method returns a Promise so callers can fire‑and‑forget.
   */
  async sendEmail(
    to: string,
    template: string,
    vars: Record<string, any>,
  ): Promise<void> {
    // No‑op placeholder.
    return;
  }
}
