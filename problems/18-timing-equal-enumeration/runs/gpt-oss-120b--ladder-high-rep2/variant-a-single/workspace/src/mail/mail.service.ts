// Dummy mail service. In production replace with a real e‑mail provider.
export async function sendEmail(to: string, template: string, vars: Record<string, any>): Promise<void> {
  // No‑op: e‑mail is sent out of band and does not affect API response.
}
