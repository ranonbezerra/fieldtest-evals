import { createHash } from 'node:crypto';

/**
 * Boundary for the bank's instant-payment API. Nothing is assumed about the
 * bank beyond the two operations:
 *   send({txid, amount, key})  — submit a payment instruction
 *   getStatement(date)         — the settlements published for a date
 *
 * ASSUMPTION: send resolves with a response carrying a string status code
 * (the BankCode values below); transport-level failures (network, timeout,
 * 5xx) surface as a `failure` result, which means the outcome is unknown.
 * The bank adapter owns the wire format and must normalise to this port.
 */

export interface BankSendRequest {
  /** deterministic instruction id — see deriveTxid */
  txid: string;
  /** amount in minor units, integer */
  amount: number;
  /** beneficiary key */
  key: string;
}

/** Raw result of a send. A `failure` means the outcome is unknown. */
export type BankSendResult =
  | { type: 'response'; code: string; message: string }
  | { type: 'failure'; message: string };

/** A settled payment as published in the bank's statement. */
export interface Settlement {
  /** the txid we submitted */
  txid: string;
  /** amount in minor units, integer */
  amount: number;
  /** statement date this entry came from (YYYY-MM-DD, UTC) */
  date: string;
  /** when the bank settled the instruction, if it reports one */
  settledAt?: string;
}

export const BankCode = {
  Accepted: 'accepted',
  Duplicate: 'duplicate',
  RejectedMalformed: 'rejected_malformed',
  RejectedBlockedAccount: 'rejected_blocked_account',
  RejectedClosedBeneficiary: 'rejected_closed_beneficiary',
} as const;

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

/** The four-way classification of a bank.send result. */
export function classifySendResult(result: BankSendResult): SendOutcome {
  if (result.type === 'failure') return 'transient';
  switch (result.code) {
    case BankCode.Accepted:
      return 'accepted';
    case BankCode.Duplicate:
      return 'duplicate';
    case BankCode.RejectedMalformed:
    case BankCode.RejectedBlockedAccount:
    case BankCode.RejectedClosedBeneficiary:
      return 'permanent';
    default:
      // A code we do not recognise: we cannot conclude the instruction did
      // not land, so the outcome stays unknown.
      return 'transient';
  }
}

export interface BankClient {
  send(request: BankSendRequest): Promise<BankSendResult>;
  getStatement(date: string): Promise<Settlement[]>;
}

/** DI token for the bank adapter. */
export const BANK_CLIENT: unique symbol = Symbol('BANK_CLIENT');

/**
 * Normalise a value to a UTC calendar date key (YYYY-MM-DD).
 *
 * ASSUMPTION: the bank's statements are keyed by UTC calendar date, and a
 * send that lands is published in the statement for the date it was sent.
 */
export function toUtcDateKey(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return (typeof value === 'string' ? new Date(value) : value).toISOString().slice(0, 10);
}

/** The UTC calendar dates covered by [from, to], inclusive. */
export function statementDatesInRange(from: Date, to: Date): string[] {
  if (from.getTime() > to.getTime()) return [];
  const dates: string[] = [];
  let cursor = new Date(`${toUtcDateKey(from)}T00:00:00.000Z`);
  const end = new Date(`${toUtcDateKey(to)}T00:00:00.000Z`).getTime();
  while (cursor.getTime() <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

/**
 * Derive the instruction txid from stable order attributes and the
 * effective date. The same order on the same date always produces the same
 * txid — that is what makes a statement entry matchable to an order, and
 * what makes a re-send recognisable to the bank as the same instruction
 * (a `duplicate`) rather than a new payment.
 *
 * ASSUMPTION: the bank accepts our derived opaque id (prefixed sha256 hex)
 * as the instruction txid; no txid format was specified.
 */
export function deriveTxid(order: {
  id: string;
  effectiveDate: Date | string;
  amountMinor: number;
  supplierKey: string;
}): string {
  const raw = `${order.id}|${toUtcDateKey(order.effectiveDate)}|${order.amountMinor}|${order.supplierKey}`;
  return `pay_${createHash('sha256').update(raw).digest('hex')}`;
}
