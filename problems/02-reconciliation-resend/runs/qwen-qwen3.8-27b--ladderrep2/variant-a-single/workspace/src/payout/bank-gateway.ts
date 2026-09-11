/**
 * Contract for the bank's instant-payment API.
 *
 * The bank is assumed to expose exactly two operations:
 *   send({txid, amount, key})  — submit an instant-payment instruction
 *   getStatement(date)         — settlements published for a UTC date
 *
 * How they are transported is an implementation detail of a BankGateway
 * provider; everything else in the system depends only on this contract.
 */
export const BANK_GATEWAY = 'BANK_GATEWAY';

/** A payment instruction as submitted to the bank. */
export interface BankSendRequest {
  /** Deterministically derived transaction id (same order + date => same txid). */
  txid: string;
  /** Amount in minor units (integer). */
  amount: number;
  /** Beneficiary key (the supplier's account). */
  key: string;
}

/** The bank's acknowledgement for an instruction it has. */
export type BankAck = { outcome: 'accepted' } | { outcome: 'duplicate' };

/** A published settlement entry as returned by getStatement. */
export interface Settlement {
  /** The txid we submitted with the instruction. */
  txid: string;
  // ASSUMPTION: each settlement carries the settled amount in minor units;
  // the spec only guarantees the txid. The amount is cross-checked, and a
  // mismatch blocks settlement rather than being silently accepted.
  amount: number;
}

/**
 * Outcome unknown: network failure, timeout, 5xx. The bank may or may not
 * have received the instruction. The only correct reaction is to record
 * "unknown" and wait for statement evidence.
 */
export class BankTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankTransientError';
  }
}

/**
 * The bank definitively rejected the instruction (malformed, blocked
 * account, closed beneficiary). Re-sending the same instruction cannot
 * succeed; the order goes to a human.
 */
export class BankPermanentError extends Error {
  constructor(
    message: string,
    readonly bankCode: string,
  ) {
    super(message);
    this.name = 'BankPermanentError';
  }
}

export interface BankGateway {
  /**
   * Submit an instruction. Resolves with an acknowledgement
   * (accepted | duplicate) when the bank has it. Rejects with
   * BankTransientError (outcome unknown) or BankPermanentError
   * (definitive rejection).
   */
  send(request: BankSendRequest): Promise<BankAck>;

  /**
   * Published settlements for a UTC date (yyyy-mm-dd). The bank publishes
   * with up to ~30 minutes of lag, so entries appear later. Must reject
   * with BankTransientError on failure: a failed fetch must never be read
   * as "empty statement".
   */
  getStatement(date: string): Promise<Settlement[]>;
}
