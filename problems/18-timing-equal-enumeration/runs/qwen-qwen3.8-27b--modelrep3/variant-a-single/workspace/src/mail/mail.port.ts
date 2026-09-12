// ASSUMPTION: the platform provides the mail transport as a provider for
// this token exposing sendEmail(to, template, vars); the task does not fix
// the token name, so 'MAIL_PORT' is used here.
export const MAIL_PORT = 'MAIL_PORT';

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}
