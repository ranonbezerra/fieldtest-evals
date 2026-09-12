import { Injectable } from '@nestjs/common';

export interface BankSendPayload {
  txid: string;
  amount: number;
  key: string;
}

/**
 * Possible outcomes of a bank send request.
 */
export type BankSendResult =
  | { status: 'accepted' }
  | { status: 'duplicate' }
  | { status: 'transient_error'; error: string }
  | { status: 'permanent_rejection'; reason: string };

export interface Settlement {
  txid: string;
  amount: number;
  settledAt: Date;
}

/**
 * BankService abstracts the external bank API.
 * In production this would perform HTTP calls; for tests it can be mocked.
 */
@Injectable()
export class BankService {
  async send(payload: BankSendPayload): Promise<BankSendResult> {
    // ASSUMPTION: Real implementation would perform an HTTP request.
    throw new Error('BankService.send not implemented');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Real implementation would fetch the statement for the given date.
    throw new Error('BankService.getStatement not implemented');
  }
}
