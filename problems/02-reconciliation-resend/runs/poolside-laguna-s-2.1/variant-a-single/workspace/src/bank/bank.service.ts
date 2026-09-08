import { Injectable } from '@nestjs/common';
import { BankClient, BankSendResult, Settlement } from './bank.types';

@Injectable()
export class BankService implements BankClient {
  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls to
    // the bank's instant-payment API.
    throw new Error('BankService.send not implemented: configure BANK_API_URL');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls to
    // the bank's statement endpoint.
    throw new Error('BankService.getStatement not implemented: configure BANK_API_URL');
  }
}
