export interface AppConfig {
  /** How often the confirmation worker polls receipts. */
  confirmationIntervalMs: number;
  /** How often the recovery sweep runs. */
  sweepIntervalMs: number;
  /** Maximum number of anchors processed per tick. */
  batchSize: number;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got '${raw}'`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    confirmationIntervalMs: readPositiveInt('ANCHOR_CONFIRMATION_INTERVAL_MS', 1000),
    sweepIntervalMs: readPositiveInt('ANCHOR_SWEEP_INTERVAL_MS', 5000),
    batchSize: readPositiveInt('ANCHOR_BATCH_SIZE', 25),
  };
}
