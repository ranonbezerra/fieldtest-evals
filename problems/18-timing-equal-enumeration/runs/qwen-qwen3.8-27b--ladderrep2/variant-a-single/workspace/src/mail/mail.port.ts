/**
 * Port for the platform mail service. The concrete transport is assumed to
 * exist outside this codebase (see MailModule); features depend on this token.
 */
export const MAIL_PORT = 'MAIL_PORT';

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
