/** Runtime configuration, from environment variables only. */
export interface AnchoringConfig {
  /** Give up waiting for broadcast() after this long; the outcome is then unknown. */
  broadcastTimeoutMs: number;
  /** How often the confirmation worker polls receipts (0 disables the timer). */
  confirmationPollMs: number;
  /** How often the recovery sweep runs (0 disables the timer). */
  recoverySweepMs: number;
  /** A limbo row must be at least this old before the sweep touches it, so the sweep never races in-flight work. */
  stuckAfterMs: number;
}

export const ANCHORING_CONFIG = 'ANCHORING_CONFIG';

function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function anchoringConfigFromEnv(): AnchoringConfig {
  return {
    broadcastTimeoutMs: nonNegativeInt('BROADCAST_TIMEOUT_MS', 30_000),
    confirmationPollMs: nonNegativeInt('ANCHORING_CONFIRMATION_POLL_MS', 5_000),
    recoverySweepMs: nonNegativeInt('ANCHORING_RECOVERY_SWEEP_MS', 60_000),
    stuckAfterMs: nonNegativeInt('ANCHORING_STUCK_AFTER_MS', 60_000),
  };
}
