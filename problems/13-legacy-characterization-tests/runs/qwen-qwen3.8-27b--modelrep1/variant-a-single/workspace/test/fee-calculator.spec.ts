// test/fee-calculator.spec.ts
//
// Characterization suite for feeCalculator.ts (in production since 2019;
// its outputs are stored and audited by billing).
//
// Goal: pin the module's CURRENT behavior -- quirks and bugs included -- so
// the planned modifications next month cannot silently change audited fee
// history. Quirks and bugs are pinned AS THEY ARE and are flagged in the
// test name with a `QUIRK:` or `BUG:` prefix. For each one, see FINDINGS.md:
// reproducing input, likely blast radius, and the proposed (deliberately NOT
// applied) fix.
//
// Determinism:
//   * The fake clock is injected ONLY through the module's existing optional
//     `now` parameter. Every call below passes it; the real wall clock never
//     runs in this suite.
//   * All dates are fixed ISO date-only strings, which the ES spec parses as
//     UTC -- the suite has no timezone or environment dependence.
//   * No randomness anywhere.
//
// Production code is untouched by this suite.

import { describe, expect, it } from 'vitest';

import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

/** Fixed reference clock used unless a test states otherwise. */
const NOW = '2021-05-10';

/** Default case: 2021 schedule (opened 2021-06-15), STANDARD band 1. */
function makeCase(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-06-15',
    ...overrides,
  };
}

/** Always inject the clock -- never rely on the wall clock. */
function fee(input: CaseInput, now: string = NOW): FeeBreakdown {
  return calculateFee(input, now);
}

/**
 * Every case type x complexity band x rate table.
 * Row: [openedAt, type, complexity, table, expectedBandFee (cents)]
 */
const BASE_ROWS: Array<[string, string, number, '2019' | '2021' | '2022', number]> = [
  // 2019 schedule -- opened before 2021-01-01
  ['2020-06-15', 'STANDARD', 1, '2019', 12000],
  ['2020-06-15', 'STANDARD', 2, '2019', 18500],
  ['2020-06-15', 'STANDARD', 3, '2019', 27000],
  ['2020-06-15', 'STANDARD', 4, '2019', 41000],
  ['2020-06-15', 'COMMERCIAL', 1, '2019', 22000],
  ['2020-06-15', 'COMMERCIAL', 2, '2019', 31500],
  ['2020-06-15', 'COMMERCIAL', 3, '2019', 45000],
  ['2020-06-15', 'COMMERCIAL', 4, '2019', 68000],
  ['2020-06-15', 'ESTATE', 1, '2019', 18000],
  ['2020-06-15', 'ESTATE', 2, '2019', 26000],
  ['2020-06-15', 'ESTATE', 3, '2019', 39500],
  ['2020-06-15', 'ESTATE', 4, '2019', 60000],
  ['2020-06-15', 'APPEAL', 1, '2019', 30000],
  ['2020-06-15', 'APPEAL', 2, '2019', 42000],
  ['2020-06-15', 'APPEAL', 3, '2019', 61000],
  ['2020-06-15', 'APPEAL', 4, '2019', 92000],
  // 2021 schedule -- opened 2021-01-01 .. 2022-06-30
  // (and, by BUG #1 in FINDINGS.md, also on 2022-07-01 itself)
  ['2021-06-15', 'STANDARD', 1, '2021', 13500],
  ['2021-06-15', 'STANDARD', 2, '2021', 20500],
  ['2021-06-15', 'STANDARD', 3, '2021', 29500],
  ['2021-06-15', 'STANDARD', 4, '2021', 44500],
  ['2021-06-15', 'COMMERCIAL', 1, '2021', 24000],
  ['2021-06-15', 'COMMERCIAL', 2, '2021', 34000],
  ['2021-06-15', 'COMMERCIAL', 3, '2021', 48500],
  ['2021-06-15', 'COMMERCIAL', 4, '2021', 73000],
  ['2021-06-15', 'ESTATE', 1, '2021', 19500],
  ['2021-06-15', 'ESTATE', 2, '2021', 28000],
  ['2021-06-15', 'ESTATE', 3, '2021', 42500],
  ['2021-06-15', 'ESTATE', 4, '2021', 64500],
  ['2021-06-15', 'APPEAL', 1, '2021', 32500],
  ['2021-06-15', 'APPEAL', 2, '2021', 45500],
  ['2021-06-15', 'APPEAL', 3, '2021', 66000],
  ['2021-06-15', 'APPEAL', 4, '2021', 99000],
  // 2022 schedule -- opened after 2022-07-01
  ['2023-03-15', 'STANDARD', 1, '2022', 15000],
  ['2023-03-15', 'STANDARD', 2, '2022', 22500],
  ['2023-03-15', 'STANDARD', 3, '2022', 32500],
  ['2023-03-15', 'STANDARD', 4, '2022', 49000],
  ['2023-03-15', 'COMMERCIAL', 1, '2022', 26500],
  ['2023-03-15', 'COMMERCIAL', 2, '2022', 37500],
  ['2023-03-15', 'COMMERCIAL', 3, '2022', 53500],
  ['2023-03-15', 'COMMERCIAL', 4, '2022', 80500],
  ['2023-03-15', 'ESTATE', 1, '2022', 21500],
  ['2023-03-15', 'ESTATE', 2, '2022', 31000],
  ['2023-03-15', 'ESTATE', 3, '2022', 47000],
  ['2023-03-15', 'ESTATE', 4, '2022', 71000],
  ['2023-03-15', 'APPEAL', 1, '2022', 36000],
  ['2023-03-15', 'APPEAL', 2, '2022', 50000],
  ['2023-03-15', 'APPEAL', 3, '2022', 72500],
  ['2023-03-15', 'APPEAL', 4, '2022', 109000],
];

describe('base fee: every case type x complexity band x rate table', () => {
  it.each(BASE_ROWS)('$1/$2/$3/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => {
    expect(fee(makeCase({ openedAt, type, complexity }))).toEqual({
      table,
      bandFee,
      urgencyFee: 0,
      expeditedFee: 0,
      total: bandFee,
    });
  });
});

describe('rate table selection: revision date boundaries (inclusive/exclusive edges)', () => {
  it('opened 2019-01-01 (earliest plausible date) -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2019-01-01' }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 12000,
    });
  });

  it('opened 2020-12-31 (day before first revision) -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2020-12-31' }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 12000,
    });
  });

  it('opened 2021-01-01 (first revision effective date, INCLUSIVE edge) -> 2021 schedule', () => {
    expect(fee(makeCase({ openedAt: '2021-01-01' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('opened 2022-06-30 (day before second revision) -> 2021 schedule', () => {
    expect(fee(makeCase({ openedAt: '2022-06-30' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('BUG: opened 2022-07-01 (second revision effective date) still gets the 2021 schedule', () => {
    // Pinned as-is: tableFor() uses `openedAt > REVISION_2022` (strict), so
    // the 2022 rates only kick in from 2022-07-02 -- one day late compared
    // to the inclusive 2021 cut. See FINDINGS.md #1.
    expect(fee(makeCase({ openedAt: '2022-07-01' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('opened 2022-07-02 (day after second revision) -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: '2022-07-02' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('opened 2023-11-30 (no later revision exists) -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: '2023-11-30' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });
});

describe('QUIRK: openedAt is compared as a raw string, not parsed as a date', () => {
  it('QUIRK: the same instant as "2022-07-01" but with a time part gets the 2022 schedule', () => {
    // '2022-07-01T00:00:00Z' > '2022-07-01' lexicographically (longer string,
    // same prefix), so a datetime-stamped copy of the "buggy day" (FINDINGS.md
    // #1) bills 2022 rates while the bare date bills 2021 rates.
    expect(fee(makeCase({ openedAt: '2022-07-01T00:00:00Z' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('QUIRK: non-ISO openedAt "garbage" sorts after both revisions -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: 'garbage' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('QUIRK: slash-separated openedAt "2021/05/10" lands in 2021 by string accident', () => {
    expect(fee(makeCase({ openedAt: '2021/05/10' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });
});

describe('urgency surcharge: deadline within 7 days of now', () => {
  it('deadline exactly 7 days ahead of now -> urgency applies (inclusive edge)', () => {
    // 2021 schedule, STANDARD band 1: 15% of 13500 = 2025.
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('deadline 8 days ahead of now -> no urgency (exclusive edge)', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-18' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('deadline on the day of now (0 days) -> urgency applies', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-10' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('QUIRK: a PAST deadline (7 days before now) still earns the urgency surcharge', () => {
    // daysBetween(now, deadline) = -7, and -7 <= 7. FINDINGS.md #7.
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-03' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('urgency percentage per table: 15% (2019), 15% (2021), 18% (2022)', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17' }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 1800,
      expeditedFee: 0,
      total: 13800,
    });
    expect(fee(makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22' }), '2023-03-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });

  it('QUIRK: urgency is measured against now (calculation time), not openedAt', () => {
    // Same stored case; only the injected clock moves. FINDINGS.md #6.
    const input = makeCase({ openedAt: '2021-05-10', deadline: '2021-05-18' });
    expect(fee(input, '2021-05-10')).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    }); // 8 days out at that moment -> no urgency
    expect(fee(input, '2021-05-16')).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    }); // 2 days out at that moment -> urgency
  });

  it('no deadline -> no urgency, even when expedited', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 1620,
      total: 15120,
    });
  });
});

describe('expedited surcharge: percentage on (bandFee + urgencyFee)', () => {
  it('not urgent: 2019 -> 10% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', expedited: true }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 1200,
      total: 13200,
    });
  });

  it('not urgent: 2021 -> 12% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 1620,
      total: 15120,
    });
  });

  it('not urgent: 2022 -> 12% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 1800,
      total: 16800,
    });
  });

  it('compounds on the urgency fee: pct is applied to bandFee + urgencyFee', () => {
    // 2019: (12000 + 1800) * 10% = 1380
    expect(
      fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 1800,
      expeditedFee: 1380,
      total: 15180,
    });
    // 2021: (13500 + 2025) * 12% = 1863
    expect(
      fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 1863,
      total: 17388,
    });
    // 2022: (15000 + 2700) * 12% = 2124
    expect(
      fee(
        makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22', expedited: true }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 2124,
      total: 19824,
    });
  });
});

describe('rounding: Math.round (half-up) at each step; expedited compounds on the rounded urgency', () => {
  it('half-cent rounds UP: 2019 STANDARD band 2, urgent+expedited -> 2127.5 -> 2128', () => {
    expect(
      fee(makeCase({ openedAt: '2020-05-01', complexity: 2, deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2019',
      bandFee: 18500,
      urgencyFee: 2775,
      expeditedFee: 2128,
      total: 23403,
    });
  });

  it('fractional cents round DOWN: 2022 STANDARD band 4 -> 6938.4 -> 6938', () => {
    expect(
      fee(
        makeCase({ openedAt: '2023-03-01', complexity: 4, deadline: '2023-03-22', expedited: true }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 49000,
      urgencyFee: 8820,
      expeditedFee: 6938,
      total: 64758,
    });
  });

  it('fractional cents round DOWN: 2022 COMMERCIAL band 1 -> 3752.4 -> 3752', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'COMMERCIAL',
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 26500,
      urgencyFee: 4770,
      expeditedFee: 3752,
      total: 35022,
    });
  });

  it('fractional cents round UP: 2022 COMMERCIAL band 3 -> 7575.6 -> 7576', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'COMMERCIAL',
          complexity: 3,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 53500,
      urgencyFee: 9630,
      expeditedFee: 7576,
      total: 70706,
    });
  });

  it('fractional cents round UP: 2022 COMMERCIAL band 4 -> 11398.8 -> 11399', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'COMMERCIAL',
          complexity: 4,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 80500,
      urgencyFee: 14490,
      expeditedFee: 11399,
      total: 106389,
    });
  });

  it('fractional cents round UP: 2022 ESTATE band 2 -> 4389.6 -> 4390', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'ESTATE',
          complexity: 2,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 31000,
      urgencyFee: 5580,
      expeditedFee: 4390,
      total: 40970,
    });
  });

  it('exact sum needs no rounding: 2021 APPEAL band 4 -> 13662', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2021-05-01',
          type: 'APPEAL',
          complexity: 4,
          deadline: '2021-05-17',
          expedited: true,
        }),
      ),
    ).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 14850,
      expeditedFee: 13662,
      total: 127512,
    });
  });

  it('urgency step (step one) loses no cents on any current band fee', () => {
    // Every band fee is a multiple of 100 and both urgency percentages are
    // integers, so 15%/18% of any of them is exact. If the rate tables ever
    // change, this is where the "round at each step" contract shows up at
    // step one. FINDINGS.md #8.
    const urgencyPct: Record<'2019' | '2021' | '2022', number> = { '2019': 15, '2021': 15, '2022': 18 };
    for (const [openedAt, type, complexity, table, bandFee] of BASE_ROWS) {
      const r = fee(makeCase({ openedAt, type, complexity, deadline: '2021-05-17' }));
      expect(r.urgencyFee).toBe((bandFee * urgencyPct[table]) / 100);
      expect(Number.isInteger(r.urgencyFee)).toBe(true);
    }
  });
});

describe('degenerate inputs', () => {
  it('complexity null -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: null }))).toThrow('complexity is required');
  });

  it('complexity undefined -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: undefined }))).toThrow('complexity is required');
  });

  describe('QUIRK: out-of-band complexity is silently clamped, not rejected', () => {
    it('complexity 0 -> band 1 fee (2021 STANDARD: 13500)', () => {
      expect(fee(makeCase({ complexity: 0 }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('complexity -2 -> band 1 fee', () => {
      expect(fee(makeCase({ complexity: -2 }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('complexity NaN -> band 1 fee (NaN is falsy, takes the same branch as 0)', () => {
      expect(fee(makeCase({ complexity: NaN }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('complexity 5 -> band 4 fee (44500)', () => {
      expect(fee(makeCase({ complexity: 5 }))).toEqual({
        table: '2021',
        bandFee: 44500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 44500,
      });
    });

    it('complexity 99 -> band 4 fee (44500)', () => {
      expect(fee(makeCase({ complexity: 99 }))).toEqual({
        table: '2021',
        bandFee: 44500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 44500,
      });
    });
  });

  describe('BUG: fractional complexity produces NaN fees', () => {
    it('complexity 2.5 -> bandFee undefined, total NaN (array index 1.5 misses)', () => {
      const r = fee(makeCase({ complexity: 2.5 }));
      expect(r.table).toBe('2021');
      expect(r.bandFee).toBeUndefined();
      expect(r.urgencyFee).toBe(0);
      expect(r.expeditedFee).toBe(0);
      expect(Number.isNaN(r.total)).toBe(true);
    });

    it('complexity 2.5 + expedited -> expeditedFee is NaN too', () => {
      const r = fee(makeCase({ complexity: 2.5, expedited: true }));
      expect(Number.isNaN(r.expeditedFee)).toBe(true);
      expect(Number.isNaN(r.total)).toBe(true);
    });
  });

  describe('QUIRK: unknown case type silently falls back to STANDARD rates', () => {
    it('type "MARITIME" (2021 table) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: 'MARITIME' }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('type "" (empty) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: '' }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('type "standard" (lowercase) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: 'standard' }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('fallback is per-table: type "MARITIME" (2022 table) -> STANDARD 2022 band 1: 15000', () => {
      expect(fee(makeCase({ openedAt: '2023-03-15', type: 'MARITIME' }))).toEqual({
        table: '2022',
        bandFee: 15000,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 15000,
      });
    });
  });
});

describe('breakdown invariants', () => {
  it('total is always bandFee + urgencyFee + expeditedFee (no hidden components)', () => {
    const samples: Array<[CaseInput, string]> = [
      [makeCase({ openedAt: '2021-05-01' }), '2021-05-10'],
      [makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17' }), '2021-05-10'],
      [makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15'],
      [
        makeCase({
          openedAt: '2023-03-01',
          type: 'APPEAL',
          complexity: 4,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ],
    ];
    for (const [input, now] of samples) {
      const r = fee(input, now);
      expect(r.total).toBe(r.bandFee + r.urgencyFee + r.expeditedFee);
    }
  });
});
