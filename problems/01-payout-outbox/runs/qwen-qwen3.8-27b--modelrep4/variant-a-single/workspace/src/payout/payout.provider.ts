/**
 * The external blockchain provider seam.
 *
 * ASSUMPTION: the concrete provider SDK is not part of this repository; the
 * task assumes `provider.transfer({ to, amount }) -> { txHash }`, which may
 * throw, time out, or succeed slowly. Everything downstream is written against
 * exactly that contract — swap `UnconfiguredPayoutProvider` in
 * payout.module.ts for an adapter around the real SDK.
 */
export interface TransferArgs {
  to: string;
  /** amount in minor units */
  amount: bigint;
}

export interface PayoutProvider {
  transfer(args: TransferArgs): Promise<{ txHash: string }>;
}

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

/**
 * Error classification. Only errors marked definitive mean the transfer is
 * known NOT to have happened (safe to release funds). Anything else —
 * timeouts, network failures, unknown errors — is transient, i.e. the outcome
 * is unknown, and must be retried and then parked, never auto-released.
 *
 * ASSUMPTION: the SDK's error taxonomy is unspecified; we honor an explicit
 * `definitive: true` marker or a known definitive error `code`, and treat
 * everything else (including all timeouts) as transient.
 */
const DEFINITIVE_ERROR_CODES = new Set([
  'INVALID_ADDRESS',
  'UNSUPPORTED_ADDRESS',
  'FROZEN_ADDRESS',
  'PROVIDER_BALANCE_INSUFFICIENT',
]);

export function isDefinitiveProviderError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { definitive?: unknown; code?: unknown };
  if (candidate.definitive === true) {
    return true;
  }
  return typeof candidate.code === 'string' && DEFINITIVE_ERROR_CODES.has(candidate.code.toUpperCase());
}

/**
 * Fails closed: every attempt fails transiently, so a payout is retried and
 * then parked in needs_review with the funds still reserved. It can never
 * fabricate a success, which is the safe failure mode for money movement.
 */
export class UnconfiguredPayoutProvider implements PayoutProvider {
  async transfer(): Promise<{ txHash: string }> {
    throw new Error('payout provider is not configured');
  }
}
