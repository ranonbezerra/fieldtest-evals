/**
 * Port for the bank's instant-payment API.
 *
 * Nothing is assumed about the bank beyond the two operations
 * `send({ txid, amount, key })` and `getStatement(date) -> Settlement[]`.
 * The HTTP shape of those operations lives in BankHttpClient.
 */

/** One entry in the bank's daily statement: the txid we submitted. */
export interface Settlement {
  txid: string;
}

export interface BankSendRequest {
  txid: string;
  /** Amount in the currency's minor units, an integer. */
  amount: number;
  /** Beneficiary account key. */
  key: string;
}

/**
 * Normalised transport result of a send. `statusCode` is 0 when no HTTP
 * response was received at all (network failure, timeout): the outcome is
 * unknown, not a rejection.
 */
export interface BankSendResponse {
  statusCode: number;
  reason: string;
}

export abstract class BankClient {
  abstract send(request: BankSendRequest): Promise<BankSendResponse>;
  abstract getStatement(date: Date): Promise<Settlement[]>;
}
