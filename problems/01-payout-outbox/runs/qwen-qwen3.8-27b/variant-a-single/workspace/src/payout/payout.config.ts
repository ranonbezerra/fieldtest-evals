export const PAYOUT_CONFIG = 'PAYOUT_CONFIG';
export const WORKER_CONFIG = 'WORKER_CONFIG';

export interface PayoutConfig {
  /** Total provider attempts per payout before failing closed (default 3). */
  maxAttempts: number;
  /** Base delay for exponential retry backoff in ms (default 30000). */
  retryBaseMs: number;
}

export interface WorkerConfig {
  /** Poll interval in ms ("every N seconds"). */
  intervalMs: number;
  /** A message stuck in 'processing' longer than this is re-claimable (crashed worker). */
  leaseMs: number;
  /** Messages processed per poll pass. */
  batchSize: number;
}

export function payoutConfigFromEnv(env: NodeJS.ProcessEnv): PayoutConfig {
  return {
    maxAttempts: positiveInt(env.PAYOUT_MAX_ATTEMPTS, 3),
    retryBaseMs: nonNegativeInt(env.PAYOUT_RETRY_BASE_MS, 30_000),
  };
}

export function workerConfigFromEnv(env: NodeJS.ProcessEnv): WorkerConfig {
  return {
    intervalMs: positiveInt(env.WORKER_INTERVAL_MS, 5_000),
    leaseMs: positiveInt(env.WORKER_LEASE_MS, 30_000),
    batchSize: positiveInt(env.WORKER_BATCH_SIZE, 25),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
