import { Injectable } from '@nestjs/common';

export type BankSendResult = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

export interface Settlement {
  txid: string;
  amount: number;
  date: Date;
}

@Injectable()
export class BankService {
  // In production this would call the real bank API.
  // Here the methods are deliberately simple so they can be mocked in tests.

  async send(payload: {
    txid: string;
    amount: number;
    key: string;
  }): Promise<BankSendResult> {
    // ASSUMPTION: Real implementation omitted; tests will mock.
    throw new Error('BankService.send not implemented');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Real implementation omitted; tests will mock.
    throw new Error('BankService.getStatement not implemented');
  }
}
