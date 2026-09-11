/**
 * Outbound mail port. The task posits that a mail port
 * `sendEmail(to, template, vars): Promise<void>` exists in the environment;
 * the auth feature depends only on this contract and token, so the real
 * transport (or a test fake) is injected under MAIL_PORT.
 */
export const MAIL_PORT = Symbol('MailPort');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}
