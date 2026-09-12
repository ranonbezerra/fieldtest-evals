import { Injectable } from '@nestjs/common';

export type BankSendResult =
  | { status: 'accepted' }
  | { status: 'duplicate' }
  | { status: 'transient_error' }
  | { status: 'permanent_rejection' };

export type BankSettlement = {
  txid: string;
  amount: number;
  settledAt: Date;
};

@Injectable()
export class BankService {
  /**
   * Sends a payment instruction to the bank.
   *
   * @param payload The payment payload.
   * @returns The bank's classification of the request.
   *
   * ASSUMPTION: The real implementation would perform an HTTP request to the
   * bank's API. Here it throws to signal that a concrete implementation is
   * required in production.
   */
  async send(payload: {
    txid: string;
    amount: number;
    key: string;
  }): Promise<BankSendResult> {
    throw new Error('BankService.send not implemented');
  }

  /**
   * Retrieves the settlement statement for a given date.
   *
   * @param date The date for which the bank's statement is requested.
   * @returns An array of settlements (txids) the bank has recorded for that date.
   *
   * ASSUMPTION: The real implementation would query the bank's statement API.
   */
  async getStatement(date: Date): Promise<BankSettlement[]> {
    throw new Error('BankService.getStatement not implemented');
  }
}
