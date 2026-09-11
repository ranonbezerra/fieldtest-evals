/**
 * All runtime configuration comes from environment variables (with sane
 * defaults for the non-secret knobs). Secrets (BANK_API_TOKEN, and
 * DATABASE_URL for Prisma) never appear in the repository.
 */
export interface PayoutConfig {
  /** Hard cap on bank.send attempts per order before it is parked for manual review. */
  maxAttempts: number;
  /** The bank's publishing lag: settlements appear on the statement within this time. */
  publishingLagMs: number;
  /** How far back each reconciliation re-reads statement history (overlap budget). */
  reconcileSpanMs: number;
  bankApiBaseUrl: string;
  bankApiToken: string;
  bankRequestTimeoutMs: number;
}

export const PAYOUT_CONFIG = 'PAYOUT_CONFIG';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`env ${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function loadPayoutConfig(): PayoutConfig {
  return {
    maxAttempts: positiveInt('PAYOUT_MAX_ATTEMPTS', 5),
    publishingLagMs: positiveInt('PAYOUT_PUBLISHING_LAG_MS', 30 * 60_000),
    reconcileSpanMs: positiveInt('PAYOUT_RECONCILE_SPAN_MS', 24 * 60 * 60_000),
    bankApiBaseUrl: (process.env.BANK_API_BASE_URL ?? '').replace(/\/+$/, ''),
    bankApiToken: process.env.BANK_API_TOKEN ?? '',
    bankRequestTimeoutMs: positiveInt('BANK_REQUEST_TIMEOUT_MS', 15_000),
  };
}
