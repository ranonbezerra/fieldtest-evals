import { BankSendRequest, BankSendResponse, BankSettlement } from '../bank/bank.types';

export enum PayoutStatus {
  PENDING = 'PENDING',
  AWAITING_EVIDENCE = 'AWAITING_EVIDENCE',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  PARKED_FOR_REVIEW = 'PARKED_FOR_REVIEW',
}

export interface PayoutRecord {
  id: string;
  orderRef: string;
  effectiveDate: string;
  amount: number;
  txid: string;
  bankKey: string;
  status: PayoutStatus;
  sendAttempts: number;
  lastAttemptAt: Date | null;
  lastSendOutcome: string | null;
  bankResponseCode: string | null;
  bankResponseMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePayoutInput {
  orderRef: string;
  effectiveDate: string;
  amount: number;
  bankKey: string;
}

export interface ReconcileWindow {
  start: Date;
  end: Date;
}

export interface ReconcileResult {
  settled: string[];
  resent: Array<{ payoutId: string; txid: string; outcome: string }>;
  parked: string[];
  skipped: string[];
}

// Re-export bank types for convenience
export { BankSendRequest, BankSendResponse, BankSettlement };
