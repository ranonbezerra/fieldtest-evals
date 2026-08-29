import { describe, expect, it } from 'vitest';
import { MonthlyStatementService } from '../src/statements/monthly-statement.service.js';
import type { Entry, EntryRepository } from '../src/statements/types.js';

function repo(entries: Entry[]): EntryRepository {
  return {
    async findByAccountBetween() {
      return entries;
    },
  };
}

const e = (category: string, amountMinor: number, taxRatePct: number, day = 5): Entry => ({
  id: `${category}-${amountMinor}-${day}`,
  accountId: 'acc-1',
  occurredAt: `2024-03-${String(day).padStart(2, '0')}`,
  category,
  amountMinor,
  taxRatePct,
});

describe('MonthlyStatementService', () => {
  it('groups by category and sorts the rows', async () => {
    const svc = new MonthlyStatementService(repo([e('travel', 1000, 10), e('food', 500, 10)]));
    const s = await svc.generate('acc-1', 2024, 3);
    expect(s.rows.map((r) => r.category)).toEqual(['food', 'travel']);
  });

  it('reports the period as YYYY-MM', async () => {
    const svc = new MonthlyStatementService(repo([]));
    const s = await svc.generate('acc-1', 2024, 3);
    expect(s.period).toBe('2024-03');
  });

  it('totals net across rows', async () => {
    const svc = new MonthlyStatementService(repo([e('travel', 1000, 10), e('food', 500, 10)]));
    const s = await svc.generate('acc-1', 2024, 3);
    expect(s.totalNetMinor).toBe(1350);
  });

  it('rounds tax per entry', async () => {
    // 333 * 7.5% = 24.975 -> 25 each, three entries -> 75
    const svc = new MonthlyStatementService(repo([e('food', 333, 7.5, 1), e('food', 333, 7.5, 2), e('food', 333, 7.5, 3)]));
    const s = await svc.generate('acc-1', 2024, 3);
    expect(s.rows[0].taxMinor).toBe(75);
  });
});
