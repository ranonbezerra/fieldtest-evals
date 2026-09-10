import type { MessageStatus, PayoutStatus } from '@prisma/client';

export type { MessageStatus, PayoutStatus };

/** Outbox message type for payout transfers. */
export const MESSAGE_TYPE_PAYOUT_TRANSFER = 'payout.transfer';

/**
 * Ledger accounts. custody.* are per-account liabilities (what we owe sellers);
 * treasury.usdc is the platform asset that pays out on-chain.
 */
export type LedgerAccountName = 'custody.available' | 'custody.reserved' | 'treasury.usdc';
export type LedgerDirection = 'debit' | 'credit';
export type LedgerEntryKind = 'reservation' | 'settlement' | 'release';

/** A payout as stored. amount is in minor units (3000n = 30.00). */
export interface PayoutRecord {
  id: string;
  accountId: string;
  idempotencyKey: string;
  amount: bigint;
  destinationAddress: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface MessageRecord {
  id: string;
  type: string;
  payload: unknown;
  status: MessageStatus;
  attempts: number;
  nextAttemptAt: Date;
  processedAt: Date | null;
}

export interface CreatePayoutInput {
  accountId: string;
  /** Minor units, end to end. */
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

/** Wire shape. amount is a string because BigInt is not JSON-safe. */
export interface PayoutDto {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
