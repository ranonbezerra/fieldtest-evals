export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type LedgerType = 'reserve' | 'release' | 'settle_out';

export type MessageStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutView {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
}

export interface ProviderResult {
  txHash: string;
}
