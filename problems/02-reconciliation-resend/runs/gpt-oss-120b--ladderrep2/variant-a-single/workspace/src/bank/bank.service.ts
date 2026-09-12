import { Injectable } from '@nestjs/common';

export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient_error' }
  | { outcome: 'permanent_rejection' };

export type Settlement = {
  txid: string;
  amount: number;
  settledAt: Date;
};

@Injectable()
export class BankService {
  /**
   * Sends a payment to the bank.
   *
   * @param payload { txid, amount, key }
   * @returns a classification of the bank response
   *
   * NOTE: In production this would be an HTTP call.
   * For the purpose of the exercise the implementation is left empty – it will be mocked in tests.
   */
  async send(payload: {
    txid: string;
    amount: number;
    key: string;
  }): Promise<BankSendResult> {
    // ASSUMPTION: real implementation is external; tests will mock this method.
    throw new Error('BankService.send not implemented');
  }

  /**
   * Retrieves the bank statement for a given date.
   *
   * @param date The date (UTC) for which the statement is requested.
   * @returns an array of settlement entries.
   *
   * NOTE: Real implementation omitted – will be mocked in tests.
   */
  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: real implementation is external; tests will mock this method.
    throw new Error('BankService.getStatement not implemented');
  }
}
