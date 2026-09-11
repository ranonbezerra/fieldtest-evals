/**
 * Outbound mail contract. The concrete transport is supplied by the host
 * application; the auth feature depends only on this port.
 */
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>;
}
