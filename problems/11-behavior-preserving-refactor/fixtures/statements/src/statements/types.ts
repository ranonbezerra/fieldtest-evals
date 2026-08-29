export interface Entry {
  id: string;
  accountId: string;
  occurredAt: string; // ISO date
  category: string;
  amountMinor: number;
  taxRatePct: number;
}

export interface StatementRow {
  category: string;
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
}

export interface EntryRepository {
  findByAccountBetween(accountId: string, from: string, to: string): Promise<Entry[]>;
}
