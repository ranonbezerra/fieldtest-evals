// test/fee-calculator.spec.ts
//
// Characterization suite for feeCalculator.ts (in production since 2019, zero
// prior tests). It pins WHAT THE CODE DOES, not what it should do:
//
//   - every case type x every complexity band, across all three rate tables
//   - both rate-table transition edges, inclusive/exclusive on each side
//   - the urgency boundary (7 vs 8 days) and the urgency percentage per table
//   - the expedited percentage per table and its compounding on the urgency fee
//   - rounding at each surcharge step (exact rounding mode, double rounding)
//   - degenerate inputs (null/undefined/zero/negative/fractional complexity,
//     unknown case type, malformed opening dates)
//
// Surprising or wrong behaviours are asserted exactly as the code produces
// them. Those tests carry the prefix [PINNED BUG] or [PINNED QUIRK] and are
// documented in FINDINGS.md. No fix is applied anywhere in this file.
//
// Determinism: every call injects a fixed `now` through the module's existing
// optional parameter. The suite contains no new Date(), no randomness, and no
// wall-clock or timezone dependence (all dates are ISO date-only strings,
// which parse as UTC in every environment, so day arithmetic is exact).

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput } from '../feeCalculator';

// Fixed reference "today" for every call in this file.
const NOW = '2026-01-15';

const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
type CaseTypeName = (typeof CASE_TYPES)[number];

const BANDS = [1, 2, 3, 4] as const;

const TABLE_NAMES = ['2019', '2021', '2022'] as const;
type TableName = (typeof TABLE_NAMES)[number];

// Base fees in cents, transcribed from RATE_TABLE_2019 / _2021 / _2022 in
// feeCalculator.ts. These literals are the pinned expectations: any change to
// the production tables must surface here as a failure.
const BASE_FEES: Record<TableName, Record<CaseTypeName, readonly [number, number, number, number]>> = {
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

// One opening date known to select each table. The edge tests below prove the
// boundaries; these dates sit comfortably inside their table's range.
const SAMPLE_OPENED_AT: Record<TableName, string> = {
  '2019': '2020-05-01',
  '2021': '2021-06-01',
  '2022': '2023-01-15',
};

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: SAMPLE_OPENED_AT['2019'],
    ...overrides,
  };
}

describe('full matrix: every case type x every complexity band, per rate table', () => {
  for (const table of TABLE_NAMES) {
    for (const type of CASE_TYPES) {
      for (const band of BANDS) {
        const fee = BASE_FEES[table][type][band - 1];
        it(`${type} / band ${band} / ${table} table (opened ${SAMPLE_OPENED_AT[table]}): base ${fee}, no surcharges`, () => {
          expect(
            calculateFee(input({ type, complexity: band, openedAt: SAMPLE_OPENED_AT[table] }), NOW),
          ).toEqual({
            table,
            bandFee: fee,
            urgencyFee: 0,
            expeditedFee: 0,
            total: fee,
          });
        });
      }
    }
  }
});

describe('rate table selection: both transition edges, inclusive/exclusive', () => {
  // APPEAL band 4 is used because its base fee differs in all three tables:
  // 92000 (2019) / 99000 (2021) / 109000 (2022).
  const appeal4 = (openedAt: string) =>
    calculateFee(input({ type: 'APPEAL', complexity: 4, openedAt }), NOW);

  it('2020-12-31 (one day before the 2021-01-01 revision) -> 2019 table', () => {
    expect(appeal4('2020-12-31')).toEqual({
      table: '2019',
      bandFee: 92000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 92000,
    });
  });

  it('2021-01-01 (exactly on the 2021 revision) -> 2021 table: first transition is INCLUSIVE', () => {
    expect(appeal4('2021-01-01')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('2021-01-02 (just after the 2021 revision) -> 2021 table', () => {
    expect(appeal4('2021-01-02')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('2022-06-30 (one day before the 2022-07-01 revision) -> 2021 table', () => {
    expect(appeal4('2022-06-30')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('[PINNED BUG] 2022-07-01 (exactly on the 2022 revision) -> STILL the 2021 table: second transition is EXCLUSIVE (FINDINGS.md F-1)', () => {
    // tableFor() uses `openedAt > REVISION_2022` (strictly greater), so a case
    // opened exactly on the revision date is billed at the superseded 2021
    // rate (99000) instead of the 2022 rate (109000). Pinned as-is on purpose;
    // the fix is proposed in FINDINGS.md and deliberately not applied here.
    expect(appeal4('2022-07-01')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('2022-07-02 (one day after the 2022 revision) -> 2022 table', () => {
    expect(appeal4('2022-07-02')).toEqual({
      table: '2022',
      bandFee: 109000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 109000,
    });
  });
});

describe('urgency: the 7-day boundary and the percentage per table', () => {
  // now = 2026-01-15. Date-only ISO deadlines give exact UTC day differences.

  it('deadline 7 days out (2026-01-22) -> URGENT (boundary: daysBetween <= 7)', () => {
    // 2022 ESTATE band 1: 21500, urgency 18% -> 3870.
    expect(
      calculateFee(
        input({ type: 'ESTATE', complexity: 1, openedAt: SAMPLE_OPENED_AT['2022'], deadline: '2026-01-22' }),
        NOW,
      ),
    ).toEqual({ table: '2022', bandFee: 21500, urgencyFee: 3870, expeditedFee: 0, total: 25370 });
  });

  it('deadline 8 days out (2026-01-23) -> not urgent (8 > 7)', () => {
    expect(
      calculateFee(
        input({ type: 'ESTATE', complexity: 1, openedAt: SAMPLE_OPENED_AT['2022'], deadline: '2026-01-23' }),
        NOW,
      ),
    ).toEqual({ table: '2022', bandFee: 21500, urgencyFee: 0, expeditedFee: 0, total: 21500 });
  });

  it('deadline the same day as now (2026-01-15, 0 days) -> urgent', () => {
    // 2021 STANDARD band 2: 20500, urgency 15% -> 3075.
    expect(
      calculateFee(
        input({ complexity: 2, openedAt: SAMPLE_OPENED_AT['2021'], deadline: '2026-01-15' }),
        NOW,
      ),
    ).toEqual({ table: '2021', bandFee: 20500, urgencyFee: 3075, expeditedFee: 0, total: 23575 });
  });

  it('[PINNED QUIRK] deadline 9 days in the PAST (2026-01-06) -> still urgent: a negative day count passes the <= 7 check (FINDINGS.md F-2)', () => {
    // daysBetween('2026-01-15', '2026-01-06') = -9, and -9 <= 7.
    // 2022 APPEAL band 3: 72500, urgency 18% -> 13050.
    expect(
      calculateFee(
        input({ type: 'APPEAL', complexity: 3, openedAt: SAMPLE_OPENED_AT['2022'], deadline: '2026-01-06' }),
        NOW,
      ),
    ).toEqual({ table: '2022', bandFee: 72500, urgencyFee: 13050, expeditedFee: 0, total: 85550 });
  });

  it('no deadline -> urgencyFee stays 0', () => {
    expect(
      calculateFee(input({ complexity: 2, openedAt: SAMPLE_OPENED_AT['2022'] }), NOW),
    ).toEqual({ table: '2022', bandFee: 22500, urgencyFee: 0, expeditedFee: 0, total: 22500 });
  });

  const perTable: Array<{ table: TableName; bandFee: number; urgencyFee: number }> = [
    { table: '2019', bandFee: 18500, urgencyFee: 2775 }, // 15%
    { table: '2021', bandFee: 20500, urgencyFee: 3075 }, // 15%
    { table: '2022', bandFee: 22500, urgencyFee: 4050 }, // 18%
  ];
  for (const c of perTable) {
    it(`urgency percentage in the ${c.table} table: ${c.urgencyFee} on base ${c.bandFee} (STANDARD band 2)`, () => {
      expect(
        calculateFee(
          input({ complexity: 2, openedAt: SAMPLE_OPENED_AT[c.table], deadline: '2026-01-20' }),
          NOW,
        ),
      ).toEqual({
        table: c.table,
        bandFee: c.bandFee,
        urgencyFee: c.urgencyFee,
        expeditedFee: 0,
        total: c.bandFee + c.urgencyFee,
      });
    });
  }
});

describe('expedited: the percentage per table, applied to bandFee alone', () => {
  const perTable: Array<{ table: TableName; bandFee: number; expeditedFee: number }> = [
    { table: '2019', bandFee: 12000, expeditedFee: 1200 }, // 10%
    { table: '2021', bandFee: 13500, expeditedFee: 1620 }, // 12%
    { table: '2022', bandFee: 15000, expeditedFee: 1800 }, // 12%
  ];
  for (const c of perTable) {
    it(`expedited percentage in the ${c.table} table: ${c.expeditedFee} on base ${c.bandFee} (STANDARD band 1)`, () => {
      expect(
        calculateFee(
          input({ complexity: 1, openedAt: SAMPLE_OPENED_AT[c.table], expedited: true }),
          NOW,
        ),
      ).toEqual({
        table: c.table,
        bandFee: c.bandFee,
        urgencyFee: 0,
        expeditedFee: c.expeditedFee,
        total: c.bandFee + c.expeditedFee,
      });
    });
  }

  it('expedited: false is the same as no expedited flag', () => {
    expect(
      calculateFee(input({ openedAt: SAMPLE_OPENED_AT['2021'], expedited: false }), NOW),
    ).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
});

describe('rounding: Math.round per surcharge step, and the expedited step compounds on the rounded urgency fee', () => {
  it('half-cent rounds UP in the expedited step: (18500 + 2775) x 10% = 2127.5 -> 2128', () => {
    // 2019 table, STANDARD band 2, urgent, expedited. The expedited base is
    // bandFee + urgencyFee (not bandFee alone: 10% of 18500 would be 1850),
    // and Math.round(2127.5) is 2128 -- halves round up.
    expect(
      calculateFee(
        input({ complexity: 2, openedAt: SAMPLE_OPENED_AT['2019'], deadline: '2026-01-18', expedited: true }),
        NOW,
      ),
    ).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('non-half fraction rounds to the nearer cent: (21500 + 3870) x 12% = 3044.4 -> 3044', () => {
    // 2022 table, ESTATE band 1, urgent, expedited.
    // Note the urgency step itself never produces a fraction with the current
    // tables (every base fee is a multiple of 500 cents; 15%/18% of those are
    // whole cents) -- the rounding that actually bites is this one. See
    // FINDINGS.md F-6.
    expect(
      calculateFee(
        input({ type: 'ESTATE', complexity: 1, openedAt: SAMPLE_OPENED_AT['2022'], deadline: '2026-01-18', expedited: true }),
        NOW,
      ),
    ).toEqual({ table: '2022', bandFee: 21500, urgencyFee: 3870, expeditedFee: 3044, total: 28414 });
  });
});

describe('degenerate inputs (pinned as currently handled)', () => {
  it('complexity: null -> throws "complexity is required"', () => {
    expect(() => calculateFee(input({ complexity: null }), NOW)).toThrow('complexity is required');
  });

  it('complexity: undefined -> throws "complexity is required"', () => {
    expect(() => calculateFee(input({ complexity: undefined }), NOW)).toThrow('complexity is required');
  });

  it('[PINNED QUIRK] complexity: 0 is not rejected; it is silently billed as band 1 (FINDINGS.md F-5)', () => {
    // 2022 STANDARD: band 1 = 15000 (band 2 would be 22500).
    expect(calculateFee(input({ complexity: 0, openedAt: SAMPLE_OPENED_AT['2022'] }), NOW)).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('[PINNED QUIRK] complexity: -3 is silently billed as band 1', () => {
    // 2021 APPEAL band 1 = 32500.
    expect(
      calculateFee(input({ type: 'APPEAL', complexity: -3, openedAt: SAMPLE_OPENED_AT['2021'] }), NOW),
    ).toEqual({ table: '2021', bandFee: 32500, urgencyFee: 0, expeditedFee: 0, total: 32500 });
  });

  it('[PINNED QUIRK] complexity: 0.5 (fraction below 1) is silently billed as band 1', () => {
    // 2019 ESTATE band 1 = 18000.
    expect(
      calculateFee(input({ type: 'ESTATE', complexity: 0.5, openedAt: SAMPLE_OPENED_AT['2019'] }), NOW),
    ).toEqual({ table: '2019', bandFee: 18000, urgencyFee: 0, expeditedFee: 0, total: 18000 });
  });

  it('complexity: 9 is clamped down to band 4', () => {
    // 2022 APPEAL band 4 = 109000.
    expect(
      calculateFee(input({ type: 'APPEAL', complexity: 9, openedAt: SAMPLE_OPENED_AT['2022'] }), NOW),
    ).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 0, expeditedFee: 0, total: 109000 });
  });

  it('[PINNED QUIRK] complexity: 2.5 (fraction inside 1..4) -> bandFee undefined, total NaN (FINDINGS.md F-3)', () => {
    // bands[2.5 - 1] is bands[1.5] -> undefined; undefined + 0 + 0 -> NaN.
    const r = calculateFee(input({ complexity: 2.5, openedAt: SAMPLE_OPENED_AT['2019'] }), NOW);
    expect(r.table).toBe('2019');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN();
  });

  it('[PINNED QUIRK] complexity: 2.5 with an urgent deadline and expedited -> NaN propagates to every fee field', () => {
    // pctOf(undefined, 15) -> Math.round(NaN) -> NaN.
    const r = calculateFee(
      input({ complexity: 2.5, openedAt: SAMPLE_OPENED_AT['2019'], deadline: '2026-01-15', expedited: true }),
      NOW,
    );
    expect(r.table).toBe('2019');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBeNaN();
    expect(r.expeditedFee).toBeNaN();
    expect(r.total).toBeNaN();
  });

  it('[PINNED QUIRK] unknown case type "FAMILY_LAW" falls back to STANDARD rates (FINDINGS.md F-4)', () => {
    // 29500 is STANDARD band 3 in the 2021 table.
    expect(
      calculateFee(input({ type: 'FAMILY_LAW', complexity: 3, openedAt: SAMPLE_OPENED_AT['2021'] }), NOW),
    ).toEqual({ table: '2021', bandFee: 29500, urgencyFee: 0, expeditedFee: 0, total: 29500 });
  });

  it('[PINNED QUIRK] empty-string case type falls back to STANDARD rates as well', () => {
    // 2019 STANDARD band 1 = 12000.
    expect(calculateFee(input({ type: '' }), NOW)).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 12000,
    });
  });

  it('[PINNED QUIRK] openedAt is compared as a string, not parsed: "garbage" sorts after both revisions -> 2022 table (FINDINGS.md F-7)', () => {
    expect(calculateFee(input({ openedAt: 'garbage' }), NOW)).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('[PINNED QUIRK] a datetime openedAt sorts after its bare date: "2022-07-01T00:00:00" -> 2022 table (the bare date gets 2021)', () => {
    // Same calendar instant as the F-1 edge, but the longer string makes the
    // lexicographic comparison true: this is string comparison, not date parsing.
    expect(calculateFee(input({ openedAt: '2022-07-01T00:00:00' }), NOW)).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });
});
