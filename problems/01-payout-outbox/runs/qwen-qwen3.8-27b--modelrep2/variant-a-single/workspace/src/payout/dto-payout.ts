import { PayoutStatus } from '@prisma/client';

export interface LedgerEntryDto {
  batchId: string;
  entryType: 'debit' | 'credit';
  accountId: string;
  amount: bigint; // debits positive, credits negative
  memo?: string;
}

export interface PayoutDto {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  sentAt: Date | null;
}
