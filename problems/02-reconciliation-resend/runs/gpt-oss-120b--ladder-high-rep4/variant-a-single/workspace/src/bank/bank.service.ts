import { Injectable } from '@nestjs/common';

export enum BankSendResult {
  ACCEPTED = 'accepted',
  DUPLICATE = 'duplicate',
  TRANSIENT_ERROR = 'transient_error',
  PERMANENT_REJECTION = 'permanent_rejection',
}

export interface BankSendPayload {
  txid: string;
  amount: number;
  key: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  date: Date;
}

@Injectable()
export class BankService {
  // In production this would call the real bank API.
  async send(payload: BankSendPayload): Promise<BankSendResult> {
    throw new Error('BankService.send not implemented');
  }

  async getStatement(from: Date, to: Date): Promise<Settlement[]> {
    throw new Error('BankService.getStatement not implemented');
  }
}
