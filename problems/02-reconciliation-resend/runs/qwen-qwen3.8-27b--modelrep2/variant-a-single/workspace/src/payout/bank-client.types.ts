/**
 * Adapter contract for the bank's instant-payment API.
 * All amounts are integers in minor units (cents).
 */

export type BankSendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

/** A send request: txid is the idempotency key the bank de-duplicates on. */
export interface BankSendRequest {
  txid: string;
  amountMinor: bigint;
  key: string;
}

/** Raw wire shape of a send response; see classifyBankSend. */
export interface BankSendResponse {
  ok: boolean;
  /** Transport status: HTTP code, or 'timeout' / 'network' when no reply arrived. */
  status?: number | string;
  statusText?: string;
  /** Bank error code, e.g. 'INVALID_KEY', 'INSUFFICIENT_FUNDS'. */
  code?: string;
  /** Human-readable detail from the bank. */
  message?: string;
  /** Present when the bank accepted (or already has) the payment. */
  bankRef?: string;
}

/** One row of the bank's statement. */
export interface StatementEntry {
  txid: string;
  amountMinor: bigint;
  settledAt: string; // ISO 8601
}

/** Statement publishing lag: entries appear no earlier than this after settlement. */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  /** Bank exposes statements per calendar date (UTC), with up to 30 min of lag. */
  getStatement(date: string): Promise<StatementEntry[]>;
}

const TRANSIENT_CODES = new Set([
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'TRY_AGAIN',
]);

const PERMANENT_CODES = new Set([
  'INVALID_KEY',
  'KEY_NOT_FOUND',
  'INVALID_TXID',
  'INVALID_AMOUNT',
  'UNSUPPORTED_CURRENCY',
  'FRAUD_DECLINE',
  'COMPLIANCE_DECLINE',
  'NOT_FOUND',
  'ALREADY_SETTLED',
  'AMBIGUOUS',
]);

/**
 * Classify a raw bank send response.
 * Conservative rule: anything not proven permanent is treated as transient,
 * so we never drop a payment that the bank might actually have settled.
 */
export function classifyBankSend(res: BankSendResponse): BankSendOutcome {
  if (res.ok) {
    // The bank's own status distinguishes a fresh acceptance from an
    // idempotent duplicate hit on the same txid.
    return res.statusText === 'duplicate' ? 'duplicate' : 'accepted';
  }

  const code = res.code;
  if (code && PERMANENT_CODES.has(code)) {
    return 'permanent';
  }
  if (code && TRANSIENT_CODES.has(code)) {
    return 'transient';
  }

  const status = res.status;
  if (status === 'timeout' || status === 'network' || status === 'socket_hang_up') {
    return 'transient';
  }
  if (typeof status === 'number') {
    if (status === 401 || status === 403 || status === 404 || status === 422) {
      return 'permanent';
    }
    if (status >= 400 && status < 500) {
      // Unrecognised 4xx: unknown whether the bank will ever accept it.
      // Park for humans instead of burning retries or re-sending blindly.
      return 'permanent';
    }
    if (status >= 500) {
      return 'transient';
    }
  }

  return 'transient';
}
