// Contract for the bank's instant-payment API, injected as a dependency.
// The concrete transport (HTTP, etc.) lives outside this repository.

/** A single payout instruction sent to the bank. */
export interface BankSendRequest {
  /** Deterministic transaction id derived from order + effective date. */
  txid: string;
  /** Payout amount in minor units (integers only). */
  amount_minor_units: number;
  /** Bank account identifier of the supplier (IBAN/SP number). */
  key: string;
}

/** Outcome categories for a bank.send response. */
export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

/** A settlement entry as reported by bank.getStatement(date). */
export interface Settlement {
  /** The txid we sent with the original payout. */
  txid: string;
  amount_minor_units: number;
  /** The bank's settlement timestamp. */
  settled_at: Date;
}

export interface BankClient {
  /**
   * Sends a payout instruction. May throw BankTransientError on transient
   * failures (network, 5xx) or BankPermanentError on permanent rejection (4xx).
   */
  send(req: BankSendRequest): Promise<BankSendResponse>;

  /**
   * Fetches the settlement statement for a calendar date. Publishes with up to
   * ~30 min of lag, so the caller must treat a statement as complete only after
   * the publishing lag has passed.
   */
  getStatement(date: Date): Promise<Settlement[]>;
}

/** Raised by BankClient.send() on transient failures (network, 5xx). */
export class BankTransientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankTransientError';
  }
}

/** Raised by BankClient.send() on permanent rejection (4xx). */
export class BankPermanentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankPermanentError';
  }
}
