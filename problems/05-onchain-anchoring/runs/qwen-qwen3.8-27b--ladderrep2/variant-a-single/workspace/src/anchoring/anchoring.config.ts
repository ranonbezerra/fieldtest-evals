export interface AnchoringConfig {
  /** Master switch for the in-process workers. */
  enabled: boolean;
  /** Poll interval for the confirmation worker. */
  confirmationPollMs: number;
  /** Poll interval for the recovery sweep. */
  recoveryPollMs: number;
  /** A broadcast-sent anchor older than this is considered stuck. */
  staleAfterMs: number;
  /** Maximum anchors handled per polling pass. */
  batchSize: number;
}

/** DI token for the anchoring config. */
export const ANCHORING_CONFIG = Symbol('ANCHORING_CONFIG');

function envBool(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

function envInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Configuration comes from environment variables only. */
export function loadAnchoringConfig(env: Record<string, string | undefined> = process.env): AnchoringConfig {
  return {
    enabled: envBool(env, 'ANCHOR_WORKER_ENABLED', true),
    confirmationPollMs: envInt(env, 'CONFIRMATION_POLL_MS', 2000),
    recoveryPollMs: envInt(env, 'RECOVERY_POLL_MS', 10000),
    staleAfterMs: envInt(env, 'ANCHOR_STALE_AFTER_MS', 300000),
    batchSize: envInt(env, 'WORKER_BATCH_SIZE', 25),
  };
}
