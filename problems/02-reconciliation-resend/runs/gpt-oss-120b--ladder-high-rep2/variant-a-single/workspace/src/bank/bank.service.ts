import { Injectable } from '@nestjs/common';

export type BankSendResult = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

export interface BankSendInput {
  txid: string;
  amount: number;
  key: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  timestamp: Date;
}

@Injectable()
export class BankService {
  async send(input: BankSendInput): Promise<BankSendResult> {
    // ASSUMPTION: Real implementation omitted. In production this would call the
    // bank's instant‑payment HTTP API.
    throw new Error('BankService.send not implemented');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Real implementation omitted. In production this would call the
    // bank's statement endpoint.
    throw new Error('BankService.getStatement not implemented');
  }
}
