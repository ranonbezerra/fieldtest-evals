/**
 * Placeholder mailer – in the real code‑base this would be wired to an
 * email delivery service. The function returns a resolved promise so that
 * failures do not affect the HTTP response.
 */
export async function sendEmail(
  to: string,
  template: string,
  vars: Record<string, unknown>,
): Promise<void> {
  // No‑op implementation.
  return;
}
