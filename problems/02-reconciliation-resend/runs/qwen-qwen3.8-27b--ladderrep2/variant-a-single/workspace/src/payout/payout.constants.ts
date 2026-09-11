/** DI token for the clock; tests inject a controlled one. */
export const CLOCK = 'CLOCK';

export interface Clock {
  now(): Date;
}

/** DI token for payout runtime configuration (built from environment variables only). */
export const PAYOUT_CONFIG = 'PAYOUT_CONFIG';

export interface PayoutConfig {
  /**
   * Bank publishing lag: absence from the statement is only proof of a
   * failed send once this has elapsed since the attempt. Keep a safety
   * margin over the bank's stated maximum (~30 minutes).
   */
  publishingLagMs: number;
  /** Total number of bank.send calls allowed per order before it is parked. */
  maxAttempts: number;
  /** How often the reconcile job runs (default: every 15 minutes). */
  reconcileIntervalMs: number;
  /** Length of each reconcile window; consecutive windows overlap. */
  reconcileWindowMs: number;
}

export function createPayoutConfig(env: Record<string, string | undefined> = process.env): PayoutConfig {
  return {
    publishingLagMs: positiveIntEnv(env, 'PAYOUT_PUBLISHING_LAG_MS', 30 * 60 * 1000),
    maxAttempts: positiveIntEnv(env, 'PAYOUT_MAX_ATTEMPTS', 5),
    reconcileIntervalMs: positiveIntEnv(env, 'PAYOUT_RECONCILE_INTERVAL_MS', 15 * 60 * 1000),
    reconcileWindowMs: positiveIntEnv(env, 'PAYOUT_RECONCILE_WINDOW_MS', 45 * 60 * 1000),
  };
}

/** Read a positive integer from the environment; the fallback applies when unset. */
export function positiveIntEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`environment variable ${name} must be a positive integer`);
  }
  return value;
}
