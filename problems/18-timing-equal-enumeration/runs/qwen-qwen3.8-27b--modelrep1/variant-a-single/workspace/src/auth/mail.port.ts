// ASSUMPTION: the task states the mail port sendEmail(to, template, vars)
// already exists; only its contract is declared here so the feature can be
// wired, and the application root supplies the binding.
export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
