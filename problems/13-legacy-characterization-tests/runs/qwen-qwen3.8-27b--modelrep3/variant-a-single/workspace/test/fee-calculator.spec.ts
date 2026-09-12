// Characterization suite for feeCalculator.ts (in production since 2019).
//
// Pins CURRENT behavior exactly, quirks included, so the planned modification
// has a regression baseline. Test names flagged (BUG-n) / (QUIRK-n) map 1:1
// to FINDINGS.md; the fixes documented there are NOT applied here.
//
// Determinism: no real dates, no randomness. Every clock-sensitive call
// injects an explicit `now` (the module's existing optional parameter).
// Production code is untouched.

import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput } from '../feeCalculator';

type TableName = '2019' | '2021' | '2022';

// Base fees per table, copied as the pinned contract (cents).
const BASE_FEES: Record<TableName, Record<string, [number, number, number, number]>> = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  '2021': {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  '2022': {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
};

// Non-boundary opening date per table, used to exercise one table at a time.
const TABLE_OPENED_AT: Record<TableName, string> = {
  '2019': '2020-06-15',
  '2021': '2021-06-15',
  '2022': '2023-03-01',
};

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt: '2020-01-15', ...overrides };
}

// A breakdown with no urgency and no expedited surcharge.
function plain(table: TableName, bandFee: number) {
  return { table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee };
}

describe('base fee: every case type x complexity band in every rate table', () => {
  for (const table of ['2019', '2021', '2022'] as const) {
    for (const [type, bands] of Object.entries(BASE_FEES[table])) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = bands[band - 1];
        it(`${table} table / ${type} / band ${band} -> ${expected}c`, () => {
          const r = calculateFee(
            input({ type, complexity: band, openedAt: TABLE_OPENED_AT[table] }),
            '2024-01-15',
          );
          expect(r).toEqual(plain(table, expected));
        });
      }
    }
  }
});

describe('rate table selection: opening-date boundaries (STANDARD band 1 probe: 12000 / 13500 / 15000c)', () => {
  const probe = (openedAt: string) =>
    calculateFee(input({ type: 'STANDARD', complexity: 1, openedAt }), '2024-01-15');

  it('opened before 2019 still gets the 2019 table (no lower bound)', () => {
    expect(probe('2018-06-15')).toEqual(plain('2019', 12000));
  });

  it('2019-01-01 -> 2019 table', () => {
    expect(probe('2019-01-01')).toEqual(plain('2019', 12000));
  });

  it('2020-12-31 -> 2019 table', () => {
    expect(probe('2020-12-31')).toEqual(plain('2019', 12000));
  });

  it('2021-01-01 (2021 transition, lower edge) -> 2021 table: edge is INCLUSIVE', () => {
    expect(probe('2021-01-01')).toEqual(plain('2021', 13500));
  });

  it('2021-01-02 -> 2021 table', () => {
    expect(probe('2021-01-02')).toEqual(plain('2021', 13500));
  });

  it('2022-06-30 (day before the 2022 transition) -> 2021 table', () => {
    expect(probe('2022-06-30')).toEqual(plain('2021', 13500));
  });

  it('(BUG-1) 2022-07-01 (boundary day of the 2022 transition) -> 2021 table: edge is EXCLUSIVE', () => {
    expect(probe('2022-07-01')).toEqual(plain('2021', 13500));
  });

  it('2022-07-02 (day after the boundary) -> 2022 table', () => {
    expect(probe('2022-07-02')).toEqual(plain('2022', 15000));
  });

  it('2024-12-31 -> 2022 table', () => {
    expect(probe('2024-12-31')).toEqual(plain('2022', 15000));
  });

  it('(QUIRK-4) a datetime string for the boundary moment selects a different table than the date-only string', () => {
    // Lexicographic string compare: '2022-07-01T00:00:00Z' > '2022-07-01'.
    expect(probe('2022-07-01T00:00:00Z')).toEqual(plain('2022', 15000));
    expect(probe('2022-07-01')).toEqual(plain('2021', 13500));
  });
});

describe('urgency surcharge: deadline within 7 days of the injected `now`', () => {
  it('2019 table (+15%): deadline exactly 7 days out applies (inclusive edge)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });

  it('2019 table: deadline 8 days out does NOT apply (exclusive edge)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-18' }),
      '2020-06-10',
    );
    expect(r).toEqual(plain('2019', 18500));
  });

  it('2019 table: deadline on the same day as `now` (0 days) applies', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-10' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });

  it('2021 table (+15%): deadline 7 days out applies', () => {
    const r = calculateFee(
      input({ type: 'APPEAL', complexity: 1, openedAt: '2021-06-15', deadline: '2021-06-27' }),
      '2021-06-20',
    );
    expect(r).toEqual({ table: '2021', bandFee: 32500, urgencyFee: 4875, expeditedFee: 0, total: 37375 });
  });

  it('2022 table (+18%: the 2022 revision raised the urgency pct too): deadline 7 days out applies', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-03-17' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('2022 table: deadline 8 days out does NOT apply', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-03-18' }),
      '2023-03-10',
    );
    expect(r).toEqual(plain('2022', 53500));
  });

  it('no deadline -> no surcharge', () => {
    const r = calculateFee(input({ complexity: 2, openedAt: '2020-01-15' }), '2020-06-10');
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(QUIRK-6) empty-string deadline is falsy -> no surcharge', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '' }),
      '2020-06-10',
    );
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(BUG-2) a deadline 13 days in the PAST still earns the surcharge (days <= 7 is true for negatives)', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-02-25' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('(BUG-2) a deadline years in the past still earns the surcharge', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2020-01-01' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('`now` moves the urgency window but never the rate table (table follows openedAt)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2024-05-07' }),
      '2024-05-01',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });
});

describe('expedited surcharge (pct of the band fee when not urgent)', () => {
  it('2019 table: +10%', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2020-01-15', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200 });
  });

  it('2021 table: +12%', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2021-06-15', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120 });
  });

  it('2022 table: +12%', () => {
    const r = calculateFee(input({ complexity: 3, openedAt: '2023-03-01', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2022', bandFee: 32500, urgencyFee: 0, expeditedFee: 3900, total: 36400 });
  });

  it('expedited: false is the same as omitting it', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2020-01-15', expedited: false }), '2024-01-15');
    expect(r).toEqual(plain('2019', 12000));
  });
});

describe('rounding per step (Math.round, half up) and the expedited base', () => {
  it('(QUIRK-3) urgent + expedited: 10% of (18500 + 2775) = 2127.5c rounds UP to 2128c', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('(QUIRK-3) urgent + expedited (2022 table): 12% of (36000 + 6480) = 5097.6c rounds to 5098c', () => {
    const r = calculateFee(
      input({ type: 'APPEAL', complexity: 1, openedAt: '2023-03-01', deadline: '2023-03-17', expedited: true }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 36000, urgencyFee: 6480, expeditedFee: 5098, total: 47578 });
  });

  it('(QUIRK-3) the expedited base INCLUDES the urgency fee (compounding): 2128c, not the 1850c a band-fee-only base would give', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }),
      '2020-06-10',
    );
    expect(r.urgencyFee).toBe(2775); // urgency step is exact here; the per-step rounding is observable on the expedited step
    expect(r.expeditedFee).toBe(Math.round((18500 + 2775) * 10 / 100)); // 2128
    expect(r.expeditedFee).not.toBe(Math.round(18500 * 10 / 100)); // not 1850
    expect(r.total).toBe(18500 + 2775 + 2128);
  });

  it('expedited fee is computed on the already-rounded urgency fee (2021 table, exact values)', () => {
    const r = calculateFee(
      input({ type: 'ESTATE', complexity: 3, openedAt: '2021-06-15', deadline: '2021-06-27', expedited: true }),
      '2021-06-20',
    );
    expect(r).toEqual({ table: '2021', bandFee: 42500, urgencyFee: 6375, expeditedFee: 5865, total: 54740 });
  });
});

describe('complexity: required, clamped into bands 1..4', () => {
  it('complexity 0 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: 0 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity -1 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: -1 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity -42 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: -42 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity 5 clamps to band 4', () => {
    expect(calculateFee(input({ complexity: 5 }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('complexity 100 clamps to band 4', () => {
    expect(calculateFee(input({ complexity: 100 }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('Infinity clamps to band 4', () => {
    expect(calculateFee(input({ complexity: Infinity }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('null throws "complexity is required"', () => {
    expect(() => calculateFee(input({ complexity: null }), '2024-01-15')).toThrow('complexity is required');
  });

  it('missing (undefined) complexity throws "complexity is required"', () => {
    // The declared type is number | null, but the code checks undefined too.
    const bare = { type: 'STANDARD', openedAt: '2020-01-15' };
    expect(() => calculateFee(bare as CaseInput, '2024-01-15')).toThrow('complexity is required');
  });

  it('(QUIRK-2) fractional complexity 2.5 escapes the band guard -> undefined band fee, NaN total', () => {
    const r = calculateFee(input({ complexity: 2.5 }), '2024-01-15');
    expect(r.table).toBe('2019');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN();
  });

  it('(QUIRK-2) fractional complexity 2.5 with expedited propagates NaN into expeditedFee', () => {
    const r = calculateFee(input({ complexity: 2.5, expedited: true }), '2024-01-15');
    expect(r.expeditedFee).toBeNaN();
    expect(r.total).toBeNaN();
  });

  it('(QUIRK-2) NaN complexity is silently treated as band 1 (no error)', () => {
    expect(calculateFee(input({ complexity: NaN }), '2024-01-15')).toEqual(plain('2019', 12000));
  });
});

describe('case type: silent fallback to STANDARD for unrecognized types', () => {
  it('(QUIRK-1) unknown type "BANKRUPTCY" is billed at STANDARD rates (2019 table, band 2)', () => {
    const r = calculateFee(input({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(QUIRK-1) the lookup is case-sensitive: lowercase "standard" falls back to STANDARD (2022 table, band 4)', () => {
    const r = calculateFee(input({ type: 'standard', complexity: 4, openedAt: '2023-03-01' }), '2024-01-15');
    expect(r).toEqual(plain('2022', 49000));
  });

  it('(QUIRK-1) empty-string type falls back to STANDARD (2021 table, band 1)', () => {
    const r = calculateFee(input({ type: '', complexity: 1, openedAt: '2021-06-15' }), '2024-01-15');
    expect(r).toEqual(plain('2021', 13500));
  });

  it('contrast: a known type uses its own column (COMMERCIAL band 2, 2019 -> 31500c, not STANDARD 18500c)', () => {
    const r = calculateFee(input({ type: 'COMMERCIAL', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual(plain('2019', 31500));
  });
});
