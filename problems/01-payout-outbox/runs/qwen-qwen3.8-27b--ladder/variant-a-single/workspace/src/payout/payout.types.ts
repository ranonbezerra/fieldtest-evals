import { PayoutStatus } from '@prisma/client';
import type { Payout } from '@prisma/client';

/** Ledger account names used in balanced debit/credit pairs. */
export const LEDGER_ACCOUNTS = {
  sellerAvailable: 'seller_available',
  deposits: 'deposits',
  payoutsInFlight: 'payouts_in_flight',
  payoutsSent: 'payouts_sent',
} as const;

export interface CreatePayoutRequest {
  accountId: string;
  amount: bigint; // minor units
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutDto {
  id: string;
  accountId: string;
  amount: string; // minor units; string so JSON transport stays integer-exact
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
}

export function toPayoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    accountId: payout.accountId,
    amount: payout.amount.toString(),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status,
    txHash: payout.txHash,
    createdAt: payout.createdAt,
  };
}

export function isTerminalPayout(status: PayoutStatus): boolean {
  return (
    status === PayoutStatus.COMPLETED ||
    status === PayoutStatus.FAILED ||
    status === PayoutStatus.NEEDS_REVIEW
  );
}
