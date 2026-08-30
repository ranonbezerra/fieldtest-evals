export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';
