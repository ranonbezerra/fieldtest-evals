export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}

export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}

export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}

export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
