import type { Entry, EntryRepository, StatementRow } from './types.js';

export interface AnnualStatementRow extends StatementRow {
  entryCount: number;
}

export interface AnnualStatement {
  accountId: string;
  period: string; // YYYY
  rows: AnnualStatementRow[];
  totalNetMinor: number;
}

export class AnnualStatementService {
  constructor(private readonly entries: EntryRepository) {}

  async generate(accountId: string, year: number): Promise<AnnualStatement> {
    const from = `${year}-01-01`;
    const dayOfYear = year % 4 === 0 ? 366 : 365;
    const end = new Date(Date.UTC(year, 0, dayOfYear));
    const to = end.toISOString().slice(0, 10);

    const entries = await this.entries.findByAccountBetween(accountId, from, to);

    const byCategory = new Map<string, Entry[]>();
    for (const e of entries) {
      const bucket = byCategory.get(e.category);
      if (bucket) bucket.push(e);
      else byCategory.set(e.category, [e]);
    }

    const rows: AnnualStatementRow[] = [];
    for (const [category, group] of [...byCategory.entries()].sort()) {
      let gross = 0;
      let taxRaw = 0;
      for (const e of group) {
        gross += e.amountMinor;
        // accumulated unrounded, rounded once at the end of the category
        taxRaw += (e.amountMinor * e.taxRatePct) / 100;
      }
      const tax = Math.round(taxRaw);
      rows.push({
        category,
        grossMinor: gross,
        taxMinor: tax,
        netMinor: gross - tax,
        entryCount: group.length,
      });
    }

    return {
      accountId,
      period: String(year),
      rows,
      totalNetMinor: rows.reduce((s, r) => s + r.netMinor, 0),
    };
  }
}
