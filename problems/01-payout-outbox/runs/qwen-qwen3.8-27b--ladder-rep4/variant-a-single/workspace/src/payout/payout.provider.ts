/**
 * Minimal contract for the blockchain provider SDK.
 * The real SDK only returns a tx hash, which is not confirmation of
 * settlement; see DESIGN.md.
 */
export interface TransferOutcome {
  /** Transfer is on chain and has a transaction hash. */
  txHash?: string;
  /**
   * true when the provider said definitively the transfer did NOT happen.
   * false when the outcome is unknown (e.g. timeout): the transfer may
   * still land on chain.
   */
  definitive?: boolean;
  /** Human-readable provider error, when one was reported. */
  message?: string;
}

export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<TransferOutcome>;
}

/** DI token resolved by the process environment; the SDK constructor is not part of this exercise. */
export const PayoutProviderToken = 'PAYOUT_PROVIDER';
