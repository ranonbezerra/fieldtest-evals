import { Injectable } from '@nestjs/common';
import { BankGateway, BankSendRequest, BankSendResponse, BankSettlement } from './bank.types';

/**
 * Concrete bank gateway — placeholder for the real bank API integration.
 * In production this would make HTTP calls to the bank's instant-payment API.
 */
@Injectable()
export class BankGatewayService implements BankGateway {
  async send(request: BankSendRequest): Promise<BankSendResponse> {
    // ASSUMPTION: Real implementation would call bank HTTP API here.
    // Placeholder returns a generic accepted response.
    return { outcome: SendOutcome.ACCEPTED, code: 'ACCEPTED', message: 'Payment accepted' };
  }

  async getStatement(date: string): Promise<BankSettlement[]> {
    // ASSUMPTION: Real implementation would call bank statement API here.
    return [];
  }
}
