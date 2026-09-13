export enum PayoutStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

export enum MessageStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

export enum LedgerType {
  HOLD = 'HOLD',
  SETTLEMENT = 'SETTLEMENT',
  RELEASE = 'RELEASE',
}

export const MAX_RETRIES = 3;
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}
