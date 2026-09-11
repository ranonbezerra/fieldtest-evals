import { Injectable } from '@nestjs/common';
import type { BankSendInput, BankSendResult, Settlement } from './payout.types.js';

/**
 * Port to the bank's instant-payment API: send({txid, amount, key}) and
 * getStatement(date) -> Settlement[].
 *
 * ASSUMPTION: the task specifies no transport for the bank (endpoints, auth,
 * vendor SDK), so this default adapter is a stub. A deployment must override the
 * provider (e.g. `{ provide: BankGateway, useValue: vendorClient }`) with a
 * client whose `send` maps the raw response onto the four classified outcomes
 * and whose `getStatement(dateKey)` returns the day's published settlements.
 */
@Injectable()
export class BankGateway {
  async send(_input: BankSendInput): Promise<BankSendResult> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }

  async getStatement(_date: string): Promise<Settlement[]> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }
}
