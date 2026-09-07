import { Injectable } from '@nestjs/common';

export type BankSendPayload = {
  txid: string;
  amount: number; // minor units
  key: string;
};

export enum BankSendResult {
  ACCEPTED = 'accepted',
  DUPLICATE = 'duplicate',
  TRANSIENT_ERROR = 'transient_error',
  PERMANENT_REJECTION = 'permanent_rejection',
}

/**
 * Simulated external bank client.
 * In production this would perform HTTP calls.
 */
@Injectable()
export class BankService {
  /**
   * Sends a payment to the bank.
   * Returns one of the BankSendResult values.
   */
  async send(payload: BankSendPayload): Promise<BankSendResult> {
    // Placeholder implementation – real implementation will call the bank API.
    // For unit tests this method will be mocked.
    return BankSendResult.ACCEPTED;
  }

  /**
   * Retrieves the settlement statement for a given date (UTC, date only).
   * Returns an array of settlements, each containing the txid that the bank
   * has settled.
   */
  async getStatement(date: Date): Promise<{ txid: string }[]> {
    // Placeholder – mocked in tests.
    return [];
  }
}
