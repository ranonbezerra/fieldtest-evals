export async function sendEmail(
  to: string,
  template: string,
  vars: Record<string, any>,
): Promise<void> {
  // Stub implementation – in production this would dispatch an email.
  // The call is deliberately fire‑and‑forget; errors are ignored.
}
