export interface MailerPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}

export const MAILER = 'MAILER' as const;
