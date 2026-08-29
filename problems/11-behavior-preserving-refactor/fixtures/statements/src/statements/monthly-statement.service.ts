import type { Entry, EntryRepository, StatementRow } from './types.js';

export interface MonthlyStatement {
  accountId: string;
  period: string; // YYYY-MM
  rows: StatementRow[];
  totalNetMinor: number;
}

export class MonthlyStatementService {
  constructor(private readonly entries: EntryRepository) {}

  async generate(accountId: string, year: number, month: number): Promise<MonthlyStatement> {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const entries = await this.entries.findByAccountBetween(accountId, from, to);

    const byCategory = new Map<string, Entry[]>();
    for (const e of entries) {
      const bucket = byCategory.get(e.category);
      if (bucket) bucket.push(e);
      else byCategory.set(e.category, [e]);
    }

    const rows: StatementRow[] = [];
    for (const [category, group] of [...byCategory.entries()].sort()) {
      let gross = 0;
      let tax = 0;
      for (const e of group) {
        gross += e.amountMinor;
        // rounded per entry
        tax += Math.round((e.amountMinor * e.taxRatePct) / 100);
      }
      rows.push({ category, grossMinor: gross, taxMinor: tax, netMinor: gross - tax });
    }

    return {
      accountId,
      period: `${year}-${String(month).padStart(2, '0')}`,
      rows,
      totalNetMinor: rows.reduce((s, r) => s + r.netMinor, 0),
    };
  }
}
