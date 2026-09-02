// ── Enums (string-union, not TS enum, to keep Prisma happy) ──
export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type OutboxStatus = 'pending' | 'processing' | 'done';

// ── DTOs ──
export interface CreatePayoutDto {
  accountId: string;
  amount: string; // decimal-string of minor units; parsed to BigInt in service
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  status: PayoutStatus;
  amount: string; // minor units as string
}

// ── Provider interface ──
export interface BlockchainProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

// ── Error codes (module-level consts) ──
export const ERROR_INSUFFICIENT_FUNDS = 'insufficient_funds';
export const ERROR_IDEMPOTENCY_CONFLICT = 'idempotency_conflict';
export const ERROR_ACCOUNT_NOT_FOUND = 'resource_not_found';
export const ERROR_VALIDATION = 'validation_failed';
