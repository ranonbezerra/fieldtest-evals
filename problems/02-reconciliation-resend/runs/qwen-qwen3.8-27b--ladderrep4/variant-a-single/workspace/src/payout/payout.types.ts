/**
 * Domain types shared by the payout feature. Deliberately free of Prisma/Nest
 * imports so tests can use them without a generated client.
 */

/**
 * State of a payment order. Values mirror the PaymentOrderState enum in the
 * Prisma schema. Transitions are one-way; the three terminal states are never
 * auto-reverted.
 */
export type OrderState =
  | 'PENDING' // eligible to be sent (initial, or released by reconcile)
  | 'IN_FLIGHT' // bank accepted (or confirmed duplicate); awaiting the statement
  | 'OUTCOME_UNKNOWN' // last send timed out / transient failure; outcome unknown
  | 'SETTLED' // matched on the bank's statement (terminal)
  | 'REJECTED' // bank permanently rejected it (terminal, human review)
  | 'NEEDS_REVIEW'; // send attempts exhausted (terminal, human review)

/** The view of a payment order the service works with. */
export interface PaymentOrderRecord {
  id: string;
  supplierKey: string;
  /** Money in minor units (cents). Integers only. */
  amountCents: number;
  /** UTC date the payment applies to; together with the id it derives the txid. */
  effectiveDate: Date;
  state: OrderState;
  /** Number of bank.send calls made for this order. */
  attemptCount: number;
  lastAttemptAt: Date | null;
}

/**
 * The port the service uses to read and advance orders. Every mark* method is a
 * guarded, one-way transition that can apply at most once.
 */
export interface PayoutOrderStore {
  findPending(): Promise<PaymentOrderRecord[]>;
  findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]>;
  markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean>;
  markOutcomeUnknown(id: string, at: Date): Promise<boolean>;
  markRejected(id: string, at: Date, reason: string): Promise<boolean>;
  markSettled(id: string, txid: string, at: Date): Promise<boolean>;
  markPendingForResend(id: string): Promise<boolean>;
  markNeedsReview(id: string, reason: string): Promise<boolean>;
}

/** DI token for the order store port. */
export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE';

/** Input to bank.send. Amount is in minor units, integers only. */
export interface BankSendInput {
  txid: string;
  amount: number;
  key: string;
}

/** The four classified outcomes of bank.send. */
export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; reason: string };

// ASSUMPTION: the task only guarantees a settlement carries the txid we sent;
// the beneficiary key is included because bank.send takes it and it aids manual review.
export interface Settlement {
  txid: string;
  key: string;
}

/** Inclusive range of statement dates (UTC midnights). */
export interface DateWindow {
  from: Date;
  to: Date;
}

export interface ExecuteSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  rescheduled: number;
  parked: number;
}
