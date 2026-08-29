import { mapProviderStatus, type PayoutStatus } from './payouts.status.js';

export interface PayoutRecord {
  id: string;
  providerStatus: string;
  amountMinor: number;
}

export interface Reconciliation {
  settledMinor: number;
  reversedMinor: number;
  unresolved: string[];
}

export class PayoutsService {
  reconcile(records: PayoutRecord[]): Reconciliation {
    const out: Reconciliation = { settledMinor: 0, reversedMinor: 0, unresolved: [] };
    for (const r of records) {
      const status: PayoutStatus = mapProviderStatus(r.providerStatus);
      if (status === 'paid') out.settledMinor += r.amountMinor;
      else if (status === 'refunded') out.reversedMinor += r.amountMinor;
      else if (status === 'unknown') out.unresolved.push(r.id);
    }
    return out;
  }
}
